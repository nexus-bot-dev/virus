 // index.js - TeamNexusDev Cloudflare Worker (Simple Stable Edition)
// - Full Cloudflare Worker code
// - KV binding: BOT_DB
// - Required env vars (in wrangler.toml): BOT_TOKEN, ADMIN_ID, ADMIN_USERNAME, API_CREATE_URL, API_CHECK_PAYMENT, MERCHANT_ID, API_KEY, QRIS_CODE, MIN_AMOUNT, RANDOM_AMOUNT_MIN, RANDOM_AMOUNT_MAX
// - This version uses text-only QR links (no images) and sends receipts as text.

import { Router } from 'itty-router';
const router = Router();

// -----------------------------
// In-memory maps
// -----------------------------
const adminSessions = new Map();
const messageTimes = new Map();
const START_TIME = Date.now();

// -----------------------------
// KV helpers (BOT_DB)
// -----------------------------
async function kvGet(env, key) {
  try {
    const v = await env.BOT_DB.get(key, { type: 'json' });
    return v || {};
  } catch (e) {
    console.error('kvGet error', key, e);
    return {};
  }
}
async function kvPut(env, key, value) {
  try {
    await env.BOT_DB.put(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('kvPut error', key, e);
    return false;
  }
}

// convenience DB accessors
async function loadAccounts(env) { return await kvGet(env, 'accounts'); }
async function saveAccounts(env, accounts) { return await kvPut(env, 'accounts', accounts); }
async function loadPending(env) { return await kvGet(env, 'pending_payments'); }
async function savePending(env, pending) { return await kvPut(env, 'pending_payments', pending); }
async function loadConfig(env) { const cfg = await kvGet(env, 'bot_config'); return { spam: cfg.spam || { limit: 10, window: 10 }, logGroupId: cfg.logGroupId || null, ...cfg }; }
async function saveConfig(env, cfg) { return await kvPut(env, 'bot_config', cfg); }
async function loadUsers(env) { return await kvGet(env, 'users'); }
async function saveUsers(env, u) { return await kvPut(env, 'users', u); }
async function loadBans(env) { return await kvGet(env, 'banned_users'); }
async function saveBans(env, b) { return await kvPut(env, 'banned_users', b); }

// -----------------------------
// Utils / formatting
// -----------------------------
function formatNumber(n=0){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function niceTime(d=new Date()){
  const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} WIB`;
}
function formatUptime(ms){
  const s=Math.floor(ms/1000); const days=Math.floor(s/86400); const hours=Math.floor((s%86400)/3600); const mins=Math.floor((s%3600)/60); const secs=s%60;
  return `${days}d ${hours}h ${mins}m ${secs}s`;
}
function escapeXml(s=''){ return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c])); }
function randFee(env){ const min=parseInt(env.RANDOM_AMOUNT_MIN)||1; const max=parseInt(env.RANDOM_AMOUNT_MAX)||50; return Math.floor(Math.random()*(max-min+1))+min; }

// -----------------------------
// Telegram helpers
// -----------------------------
async function tg(method, env, payload){
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await res.json();
  } catch (e) {
    console.error('tg error', method, e);
    return null;
  }
}
async function sendMessage(env, chatId, text, replyMarkup=null){
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await tg('sendMessage', env, payload);
}
async function sendPhoto(env, chatId, photoUrl, caption='', replyMarkup=null){
  const payload = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await tg('sendPhoto', env, payload);
}
async function editText(env, chatId, messageId, text, replyMarkup=null){
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await tg('editMessageText', env, payload);
}
async function editCaption(env, chatId, messageId, caption, replyMarkup=null){
  const payload = { chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await tg('editMessageCaption', env, payload);
}
async function answerCallback(env, callbackQueryId, text=null, showAlert=false){
  const payload = { callback_query_id: callbackQueryId };
  if (text) { payload.text = text; payload.show_alert = showAlert; }
  return await tg('answerCallbackQuery', env, payload);
}

// -----------------------------
// Logging to group (quote format)
// -----------------------------
async function sendLog(env, title, items=[]){
  try {
    const cfg = await loadConfig(env);
    const gid = cfg.logGroupId;
    if (!gid) return;
    let text = `${title}\n`;
    for (const it of items) text += `> ${it}\n`;
    await sendMessage(env, gid, text);
  } catch (e) { console.error('sendLog error', e); }
}

// -----------------------------
// Bans and anti-spam
// -----------------------------
async function isBanned(env, userId){
  const bans = await loadBans(env);
  return !!bans[userId];
}
async function addBan(env, userId, reason='banned'){ const bans = await loadBans(env); bans[userId] = { reason, ts: new Date().toISOString() }; await saveBans(env, bans); }
async function removeBan(env, userId){ const bans = await loadBans(env); if (bans[userId]) { delete bans[userId]; await saveBans(env, bans); } }

async function checkAntiSpam(env, userId, username){
  try {
    const cfg = await loadConfig(env);
    const limit = (cfg.spam && cfg.spam.limit) || 10;
    const windowSec = (cfg.spam && cfg.spam.window) || 10;
    const now = Date.now();
    const arr = messageTimes.get(userId) || [];
    const pruned = arr.filter(t => now - t <= windowSec * 1000);
    pruned.push(now);
    messageTimes.set(userId, pruned);
    if (pruned.length > limit) {
      await addBan(env, userId, 'auto-spam');
      await sendMessage(env, env.ADMIN_ID, `<b>🚫 Auto-Ban (Anti-Spam)</b>\n> 👤 User: @${username || 'N/A'} (ID: ${userId})\n> 🧠 Alasan: Spam terlalu banyak\n> ⏰ ${niceTime(new Date())}`);
      await sendLog(env, '🚫 Auto-Ban (Anti-Spam)', [`👤 User: @${username || 'N/A'} (ID: ${userId})`, `Alasan: Spam terlalu banyak`, `Waktu: ${niceTime(new Date())}`]);
      messageTimes.delete(userId);
      return true;
    }
    return false;
  } catch (e) { console.error('checkAntiSpam', e); return false; }
}

// -----------------------------
// QRIS API helper (robust parsing)
// - tries different payload formats and parses many response shapes
// -----------------------------
async function createQris(env, amount, note = ''){
  try {
    // Try sending JSON body with merchant and api key (common)
    const bodies = [
      { merchant_id: env.MERCHANT_ID, api_key: env.API_KEY, amount, note },
      { merchant: env.MERCHANT_ID, key: env.API_KEY, amount, note },
      { amount, merchant_id: env.MERCHANT_ID, api_key: env.API_KEY, note },
      { amount, note } // minimal
    ];
    let resJson = null;
    for (const b of bodies) {
      try {
        const r = await fetch(env.API_CREATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), timeout: 15000 });
        if (!r.ok) continue;
        const j = await r.json().catch(()=>null);
        if (!j) continue;
        resJson = { body: b, resp: j };
        break;
      } catch (e) { /* try next */ }
    }
    if (!resJson) return null;

    const data = resJson.resp;
    // Several possible fields for QR link or reference
    const qrLink = data.qr_link || data.qr_url || data.download_url || data.url || (data.data && (data.data.qr_link || data.data.qr_url || data.data.url)) || null;
    const ref = data.reference || data.transactionId || data.id || data.data && (data.data.reference || data.data.transactionId || data.data.id) || (data.ref || null);

    // If API returns only a token, build a fallback link if possible (user-provided base)
    if (!qrLink && ref) {
      // try common pattern (you may adjust if provider uses other pattern)
      return { reference: ref, qr_link: null };
    }
    if (!qrLink && !ref) return null;
    return { qr_link: qrLink, reference: ref || `TX${Date.now()}` };
  } catch (e) {
    console.error('createQris error', e);
    return null;
  }
}

// Generic check payment helper (tries GET with transid param)
async function checkPaymentByReference(env, reference){
  try {
    // try common query param ?reference= or ?transactionId=
    const urls = [
      `${env.API_CHECK_PAYMENT}?reference=${encodeURIComponent(reference)}`,
      `${env.API_CHECK_PAYMENT}?transactionId=${encodeURIComponent(reference)}`,
      `${env.API_CHECK_PAYMENT}?id=${encodeURIComponent(reference)}`,
      `${env.API_CHECK_PAYMENT}?trx=${encodeURIComponent(reference)}`
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json().catch(()=>null);
        if (!j) continue;
        // If provider returns array in data, try to find matching reference
        if (j.status === true || j.status === 'success' || j.success === true || j.result === true) {
          return { ok: true, raw: j };
        }
        // Some APIs return list of payments and status field
        if (Array.isArray(j.data) || Array.isArray(j.payments)) {
          return { ok: true, raw: j };
        }
        // fallback: if j has amount or paid flag
        if (j.paid === true || j.is_paid === true || j.payment_status === 'PAID') return { ok: true, raw: j };
      } catch (e) { /* ignore and try next */ }
    }
    return { ok: false };
  } catch (e) { console.error('checkPaymentByReference error', e); return { ok: false }; }
}

// -----------------------------
// Build UI messages & keyboards
// -----------------------------
function startMessageTemplate(env, user, totalUsers=0, successCount=0, productCount=0){
  const name = user.username ? `@${user.username}` : (user.first_name || 'Pengguna');
  return `
<b>🎁 WELCOME IN ${env.ADMIN_USERNAME ? env.ADMIN_USERNAME.replace('@','').toUpperCase() + ' SHOP' : 'TEAMNEXUSDEV SHOP'} 🎁</b>

Selamat datang, <b>${name}</b>!
Cari cloud panel / VPS terbaik? Kamu berada di tempat yang tepat.

Silakan pilih:
`.trim();
}
function startKeyboard(env){
  return { inline_keyboard: [ [ { text: '🛍️ BUY PRODUCT', callback_data: 'beli_akun' } ], [ { text: '📞 CHAT ADMIN', url: env.ADMIN_USERNAME ? `https://t.me/${env.ADMIN_USERNAME.replace('@','')}` : `https://t.me/${env.ADMIN_ID}` } ] ] };
}

function buildAllProductsText(accounts){
  const lines = [];
  lines.push(`<b>👑 ALL PRODUCT 👑</b>`);
  lines.push(`Silahkan tekan tombol dibawah ini sesuai stok yang Anda cari 🛍️\n`);
  const keys = Object.keys(accounts);
  if (keys.length === 0) {
    lines.push(`⚠️ Belum ada produk tersedia.`);
    return lines.join('\n');
  }
  let idx = 1;
  for (const key of keys) {
    const p = accounts[key];
    const stock = Array.isArray(p.items) ? p.items.length : (p.items ? 1 : 0);
    const ok = stock > 0 ? '✅' : '❌';
    lines.push(`<b>[ ${idx} ] ${escapeXml(p.name)}</b>`);
    lines.push(`Stock Tersedia : ${stock} ${ok}`);
    lines.push('────────────────────────────');
    idx++;
  }
  lines.push(`\nJika stok yang Anda cari kosong,\nsilahkan hubungi admin di tombol "Chat Admin" 💬`);
  return lines.join('\n');
}
function buildAllProductsKeyboard(accounts){
  const keys = Object.keys(accounts);
  const kb = [];
  let idx = 1;
  for (const key of keys) {
    const p = accounts[key];
    const stock = Array.isArray(p.items) ? p.items.length : (p.items ? 1 : 0);
    kb.push([ { text: `${idx}`, callback_data: `prod_${key}` }, { text: `${p.name} (${stock})`, callback_data: `prod_${key}` } ]);
    idx++;
  }
  kb.push([ { text: '🔙 Kembali', callback_data: 'back_start' } ]);
  return { inline_keyboard: kb };
}
function buildProductDetailText(p, qty=1){
  const stock = Array.isArray(p.items) ? p.items.length : (p.items ? 1 : 0);
  const total = p.price * qty;
  const lines = [];
  lines.push(`🧾 <b>DESKRIPSI :</b> ${p.description ? escapeXml(p.description) : '-'}`);
  lines.push(`💰 <b>HARGA :</b> Rp ${formatNumber(p.price)}`);
  lines.push(`📦 <b>STOCK :</b> ${stock}`);
  lines.push(`#️⃣ <b>JUMLAH :</b> ${qty}`);
  lines.push(`💳 <b>TOTAL :</b> Rp ${formatNumber(total)}`);
  lines.push(`\n⚠️ <b>INFORMASI :</b> Sebelum membeli silahkan baca deskripsi produk tersebut sampai paham!\nMembeli = Telah membaca deskripsi produk.`);
  return lines.join('\n');
}
function productDetailKeyboard(key, qty, stock){
  return { inline_keyboard: [
    [ { text: '➖', callback_data: `dec_${key}_${qty}` }, { text: `${qty}`, callback_data: 'noop' }, { text: '➕', callback_data: `inc_${key}_${qty}` } ],
    [ { text: '📦 TAKE ALL', callback_data: `takeall_${key}` } ],
    [ { text: '🔙 Kembali', callback_data: 'beli_akun' }, { text: '💳 BUY QRIS', callback_data: `buy_qr_${key}_${qty}` } ]
  ]};
}

// -----------------------------
// Flow handlers
// -----------------------------

// /start
async function handleStart(update, env){
  const user = update.message.from;
  const uid = String(user.id);
  const users = await loadUsers(env);
  if (!users[uid]) { users[uid] = { createdAt: new Date().toISOString() }; await saveUsers(env, users); }
  if (await isBanned(env, uid)) return await sendMessage(env, user.id, `❌ <b>Akses Ditolak</b>\nAnda diblokir.`);
  const accounts = await loadAccounts(env);
  const stats = await kvGet(env, 'stats');
  const totalUsers = Object.keys(users).length;
  const successCount = (stats && stats.success) ? stats.success : 0;
  const productCount = Object.keys(accounts).length;
  const msg = startMessageTemplate(env, user, totalUsers, successCount, productCount);
  const kb = startKeyboard(env);
  return await sendMessage(env, user.id, msg, kb);
}

// show all products
async function handleAllProducts(update, env, edit=false){
  const from = update.message ? update.message.from : update.callback_query.from;
  const accounts = await loadAccounts(env);
  const text = buildAllProductsText(accounts);
  const kb = buildAllProductsKeyboard(accounts);
  if (edit && update.callback_query) {
    await answerCallback(env, update.callback_query.id);
    return await editText(env, from.id, update.callback_query.message.message_id, text, kb);
  }
  return await sendMessage(env, from.id, text, kb);
}

// show product detail when user press product button
async function handleProductDetail(update, env){
  const cb = update.callback_query;
  await answerCallback(env, cb.id);
  const data = cb.data; // prod_<key>
  const key = data.split('_').slice(1).join('_');
  const accounts = await loadAccounts(env);
  const p = accounts[key];
  if (!p) return await editText(env, cb.from.id, cb.message.message_id, '⚠️ Produk tidak ditemukan.', { inline_keyboard: [ [ { text: '🔙 Kembali', callback_data: 'beli_akun' } ] ] });
  const qty = 1;
  const text = buildProductDetailText(p, qty);
  const kb = productDetailKeyboard(key, qty, Array.isArray(p.items)?p.items.length: (p.items?1:0));
  return await editText(env, cb.from.id, cb.message.message_id, text, kb);
}

// qty handlers
async function handleQty(update, env){
  const cb = update.callback_query;
  await answerCallback(env, cb.id);
  const parts = cb.data.split('_');
  const action = parts[0]; // inc/dec/takeall
  const key = parts[1];
  let qty = parseInt(parts[2]||'1');
  const accounts = await loadAccounts(env);
  const p = accounts[key];
  if (!p) return await answerCallback(env, cb.id, 'Produk tidak ditemukan', true);
  const stock = Array.isArray(p.items) ? p.items.length : (p.items ? 1 : 0);
  if (action === 'inc') qty = Math.min(stock, qty + 1);
  else if (action === 'dec') qty = Math.max(1, qty - 1);
  else if (action === 'takeall') qty = Math.max(1, stock);
  const text = buildProductDetailText(p, qty);
  const kb = productDetailKeyboard(key, qty, stock);
  return await editText(env, cb.from.id, cb.message.message_id, text, kb);
}

// buy qris
async function handleBuyQris(update, env){
  const cb = update.callback_query;
  await answerCallback(env, cb.id);
  // buy_qr_<key>_<qty>
  const parts = cb.data.split('_');
  const key = parts[2];
  let qty = parseInt(parts[3]||'1');
  if (qty < 1) qty = 1;
  const accounts = await loadAccounts(env);
  const prod = accounts[key];
  if (!prod) return await answerCallback(env, cb.id, 'Produk tidak ditemukan', true);
  const stock = Array.isArray(prod.items) ? prod.items.length : (prod.items ? 1 : 0);
  if (stock < qty) return await answerCallback(env, cb.id, 'Stok tidak mencukupi', true);

  const nominal = prod.price * qty;
  const feeRandom = randFee(env);
  const total = nominal + feeRandom;

  // create QRIS via API
  const q = await createQris(env, total, `Pembelian ${prod.name}`);
  if (!q) {
    // fallback: send text fallback with instruction
    await sendMessage(env, cb.from.id, `❌ Gagal membuat QRIS. Coba lagi nanti.\nJika pembayaran mendesak, hubungi admin: ${env.ADMIN_USERNAME || env.ADMIN_ID}`);
    // return user back to product list
    await handleAllProducts(update, env, true);
    return;
  }

  const qrLink = q.qr_link || q.qr_url || q.download_url || q.url || null;
  const reference = q.reference || q.reference || q.ref || (`TX${Date.now()}`);

  // save pending keyed by user id
  const pending = await loadPending(env);
  pending[String(cb.from.id)] = {
    transactionId: reference,
    userId: String(cb.from.id),
    username: cb.from.username ? `@${cb.from.username}` : (cb.from.first_name || 'Pengguna'),
    productKey: key,
    qty,
    nominal,
    feeRandom,
    total,
    timestamp: new Date().toISOString(),
    messageId: null,
    qr_link: qrLink
  };
  await savePending(env, pending);

  // send QR link or text
  const captionLines = [];
  captionLines.push(`🧾 <b>PEMBELIAN PRODUK</b>`);
  captionLines.push(`🎁 Nama: ${escapeXml(prod.name)}`);
  captionLines.push(`🔢 Jumlah: ${qty}`);
  captionLines.push(`💰 Harga Satuan: Rp ${formatNumber(prod.price)}`);
  captionLines.push(`🧾 Admin Fee: Rp ${formatNumber(feeRandom)}`);
  captionLines.push(`<b>💳 Total Bayar: Rp ${formatNumber(total)}</b>`);
  captionLines.push(`⏳ Timeout: 10 menit`);
  captionLines.push(`\nScan / buka link pembayaran berikut dan lakukan pembayaran:`);
  if (qrLink) captionLines.push(qrLink);
  else captionLines.push(`(Link pembayaran tidak tersedia, hubungi admin)`);

  const kb = { inline_keyboard: [ [ { text: '✅ Saya Sudah Bayar (Konfirmasi)', callback_data: `confirm_${reference}` }, { text: '❌ Cancel', callback_data: `cancel_${reference}` } ] ] };

  // send as message (text-only)
  const sent = await sendMessage(env, cb.from.id, captionLines.join('\n'), kb);
  if (sent && sent.ok) {
    pending[String(cb.from.id)].messageId = sent.result.message_id;
    await savePending(env, pending);
  }

  // notify admin (text)
  await sendMessage(env, env.ADMIN_ID, `<b>⏳ Pembayaran Pending</b>\n> 👤 ${pending[String(cb.from.id)].username} (ID: ${cb.from.id})\n> Id Transaksi: ${reference}\n> Total: Rp ${formatNumber(total)}`);
  await sendLog(env, '⏳ Pembayaran Pending', [
    `User: ${pending[String(cb.from.id)].username} (ID: ${cb.from.id})`,
    `Trans: ${reference}`,
    `Total: Rp ${formatNumber(total)}`,
    `Waktu: ${niceTime(new Date())}`
  ]);

  return;
}

// cancel pending
async function handleCancel(update, env){
  const cb = update.callback_query;
  await answerCallback(env, cb.id);
  const parts = cb.data.split('_');
  const trans = parts[1];
  const pending = await loadPending(env);
  const key = Object.keys(pending).find(k => pending[k].transactionId === trans);
  if (!key) return await answerCallback(env, cb.id, 'Pending tidak ditemukan', true);
  const ent = pending[key];
  // try edit caption if message exists
  if (ent.messageId) {
    try { await editCaption(env, parseInt(key), ent.messageId, `❌ <b>Pembayaran Dibatalkan</b>\nID: <code>${trans}</code>`); } catch (e) {}
  }
  delete pending[key];
  await savePending(env, pending);
  await sendMessage(env, env.ADMIN_ID, `<b>❌ Pembayaran Dibatalkan</b>\n> User: ${key}\n> Trans: ${trans}`);
  await sendLog(env, '❌ Pembayaran Dibatalkan', [`User: ${key}`, `Trans: ${trans}`, `Waktu: ${niceTime(new Date())}`]);
  // return to all products for user
  try { await handleAllProducts(update, env, true); } catch(e){}
  return;
}

// confirm payment (user or admin triggers)
async function handleConfirm(update, env){
  const cb = update.callback_query;
  await answerCallback(env, cb.id);
  const parts = cb.data.split('_');
  const trans = parts[1];
  const pending = await loadPending(env);
  const key = Object.keys(pending).find(k => pending[k].transactionId === trans);
  if (!key) return await answerCallback(env, cb.id, 'Pending tidak ditemukan', true);
  const ent = pending[key];

  // check timeout 10min
  const created = new Date(ent.timestamp);
  if ((Date.now() - created.getTime()) / (1000*60) > 10) {
    if (ent.messageId) {
      try { await editCaption(env, parseInt(key), ent.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${trans}</code>`); } catch(e){}
    }
    delete pending[key]; await savePending(env, pending);
    await sendLog(env, '⏰ Pending Expired', [`User: ${key}`, `Trans: ${trans}`, `Waktu: ${niceTime(new Date())}`]);
    return await answerCallback(env, cb.id, '❌ Pembayaran expired', true);
  }

  // Check payment via API_CHECK_PAYMENT (robust)
  const ck = await checkPaymentByReference(env, trans);
  if (!ck.ok) {
    return await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi. Jika sudah bayar, tunggu beberapa saat atau hubungi admin.', true);
  }

  // Payment found -> deliver product
  const accounts = await loadAccounts(env);
  const prod = accounts[ent.productKey];
  if (!prod) return await answerCallback(env, cb.id, '⚠️ Produk tidak ditemukan (admin).', true);
  const stock = Array.isArray(prod.items) ? prod.items.length : (prod.items ? 1 : 0);
  if (stock < ent.qty) return await answerCallback(env, cb.id, '⚠️ Stok tidak mencukupi.', true);

  const delivered = [];
  for (let i=0;i<ent.qty;i++){
    const it = prod.items.shift();
    delivered.push(it);
  }
  await saveAccounts(env, accounts);

  // Edit original message to confirmed if possible
  if (ent.messageId) {
    try { await editCaption(env, parseInt(key), ent.messageId, `✅ <b>Pembayaran Terkonfirmasi</b>\nID: <code>${trans}</code>\nTerima kasih!`); } catch(e){}
  }

  // deliver account details to user as text
  let deliverText = `✅ <b>Pembelian Berhasil</b>\n<b>Produk:</b> ${escapeXml(prod.name)}\n<b>Jumlah:</b> ${ent.qty}\n\n<b>Detail Akun:</b>\n`;
  delivered.forEach((it, idx) => {
    deliverText += `\n— Akun ${idx+1} —\n`;
    if (it.user) deliverText += `<b>Username/Email:</b> <code>${escapeXml(it.user)}</code>\n`;
    if (it.pass) deliverText += `<b>Password:</b> <code>${escapeXml(it.pass)}</code>\n`;
    if (it.note) deliverText += `<b>Note:</b> ${escapeXml(it.note)}\n`;
  });
  await sendMessage(env, ent.userId, deliverText);

  // send textual receipt to user & group
  const receiptLines = [];
  receiptLines.push(`🧾 <b>STRUK PEMBELIAN</b>`);
  receiptLines.push(`> Username: ${ent.username}`);
  receiptLines.push(`> User ID: ${ent.userId}`);
  receiptLines.push(`> Id Transaksi: ${ent.transactionId}`);
  receiptLines.push(`> Produk: ${escapeXml(prod.name)}`);
  receiptLines.push(`> Nominal: Rp ${formatNumber(ent.nominal)}`);
  receiptLines.push(`> Fee Random: Rp ${formatNumber(ent.feeRandom)}`);
  receiptLines.push(`> Total Bayar: Rp ${formatNumber(ent.total)}`);
  receiptLines.push(`> Waktu: ${niceTime(new Date())}`);
  await sendMessage(env, ent.userId, receiptLines.join('\n'));

  const cfg = await loadConfig(env);
  if (cfg.logGroupId) await sendMessage(env, cfg.logGroupId, receiptLines.join('\n'));

  // notify admin & log
  await sendMessage(env, env.ADMIN_ID, `<b>🔔 Pembelian Sukses</b>\n> User: ${ent.username} (ID: ${ent.userId})\n> Produk: ${escapeXml(prod.name)}\n> Total: Rp ${formatNumber(ent.total)}\n> Waktu: ${niceTime(new Date())}`);
  await sendLog(env, '📦 Transaksi Sukses', [`User: ${ent.username} (ID: ${ent.userId})`, `Produk: ${escapeXml(prod.name)}`, `Jumlah: ${ent.qty}`, `Total: Rp ${formatNumber(ent.total)}`, `Waktu: ${niceTime(new Date())}`]);

  // remove pending
  delete pending[key]; await savePending(env, pending);

  // return user to all products
  try { await handleAllProducts(update, env, true); } catch(e){}

  return await answerCallback(env, cb.id, '✅ Pembayaran terkonfirmasi dan akun sudah dikirim.', true);
}

// -----------------------------
// Admin quick add product: /addproduk name|price|desc|acc1:pass1;acc2:pass2
// -----------------------------
async function handleAddProductText(update, env, text){
  const user = update.message.from;
  if (String(user.id) !== String(env.ADMIN_ID)) return await sendMessage(env, user.id, '❌ Akses ditolak. Hanya admin.');
  const rest = text.replace('/addproduk','').trim();
  if (!rest) return await sendMessage(env, user.id, 'Usage: /addproduk <nama>|<harga>|<deskripsi>|<akun1:pass1;akun2:pass2>');
  const parts = rest.split('|').map(s=>s.trim());
  if (parts.length < 4) return await sendMessage(env, user.id, 'Format salah. Contoh: /addproduk Netflix Premium|85000|Deskripsi|user1@mail:pass1;user2@mail:pass2');
  const [name, priceRaw, desc, accountsRaw] = parts;
  const price = parseInt(priceRaw.replace(/\D/g,'')) || 0;
  const items = [];
  const pairs = accountsRaw.split(';').map(s=>s.trim()).filter(Boolean);
  for (const p of pairs){
    if (p.includes(':')){
      const [u, pw] = p.split(':').map(s=>s.trim());
      items.push({ user: u, pass: pw });
    } else items.push({ user: p, pass: '' });
  }
  const accounts = await loadAccounts(env);
  // generate unique key from name
  let key = name.toLowerCase().replace(/\s+/g,'_').replace(/[^\w\-]/g,'');
  if (!key) key = `prod_${Date.now()}`;
  if (accounts[key]) key = `${key}_${Date.now()}`;
  accounts[key] = { name, price, description: desc, items, createdAt: new Date().toISOString() };
  await saveAccounts(env, accounts);
  await sendMessage(env, user.id, `<b>✅ Produk ditambahkan</b>\nKey: <code>${key}</code>\nNama: ${escapeXml(name)}\nHarga: Rp ${formatNumber(price)}\nJumlah akun: ${items.length}`);
  await sendLog(env, '➕ Stok Ditambah', [`Admin: ${env.ADMIN_ID}`, `Produk: ${name}`, `Key: ${key}`, `Harga: Rp ${formatNumber(price)}`, `Jumlah: ${items.length}`, `Waktu: ${niceTime(new Date())}`]);
  return;
}

// -----------------------------
// Cleanup expired pending on each webhook arrival
// -----------------------------
async function cleanupExpired(env){
  try {
    const pending = await loadPending(env);
    const now = Date.now();
    for (const uid of Object.keys(pending)) {
      const p = pending[uid];
      if (!p) continue;
      const created = new Date(p.timestamp);
      if ((now - created.getTime()) / (1000*60) > 10) {
        if (p.messageId) {
          try { await editCaption(env, parseInt(uid), p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${p.transactionId}</code>`); } catch (e) {}
        }
        delete pending[uid];
        await savePending(env, pending);
        await sendMessage(env, env.ADMIN_ID, `<b>⏰ Pending expired</b>\n> User: ${uid}\n> Trans: ${p.transactionId}`);
        await sendLog(env, '⏰ Pending Expired', [`User: ${uid}`, `Trans: ${p.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
      }
    }
  } catch (e) { console.error('cleanupExpired', e); }
}

// -----------------------------
// Router main
// -----------------------------
router.post('/', async (request, env) => {
  try {
    const update = await request.json();

    // cleanup expired pending payments each incoming update
    await cleanupExpired(env);

    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';

      // product flow
      if (data === 'beli_akun') return new Response(JSON.stringify(await handleAllProducts(update, env, true)));
      if (data.startsWith('prod_')) return new Response(JSON.stringify(await handleProductDetail(update, env)));
      if (data.startsWith('inc_') || data.startsWith('dec_') || data.startsWith('takeall_')) return new Response(JSON.stringify(await handleQty(update, env)));
      if (data.startsWith('buy_qr_')) return new Response(JSON.stringify(await handleBuyQris(update, env)));
      if (data.startsWith('cancel_')) return new Response(JSON.stringify(await handleCancel(update, env)));
      if (data.startsWith('confirm_')) return new Response(JSON.stringify(await handleConfirm(update, env)));

      // admin nexus minimal handlers
      if (data && data.startsWith('nexus')) return new Response(JSON.stringify(await handleNexusCallback(update, env)));

      // noop
      if (data === 'noop') { await answerCallback(env, cb.id); return new Response(JSON.stringify({ ok: true })); }

      return new Response('OK');
    }

    if (update.message) {
      const msg = update.message;
      const text = (msg.text || '').trim();
      const user = msg.from;

      // admin session (not used in simplified flow)
      if (String(user.id) === String(env.ADMIN_ID) && adminSessions.has(user.id)) {
        // no multi-step in this simplified edition
      }

      // commands
      if (text.startsWith('/start')) return new Response(JSON.stringify(await handleStart(update, env)));
      if (text.startsWith('/beli') || text.startsWith('/beli_akun')) return new Response(JSON.stringify(await handleAllProducts(update, env)));
      if (text.startsWith('/addproduk')) return new Response(JSON.stringify(await handleAddProductText(update, env, text)));
      if (text.startsWith('/setnotif')) {
        if (String(user.id) !== String(env.ADMIN_ID)) return new Response(JSON.stringify(await sendMessage(env, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/);
        const gid = parts[1];
        if (!gid) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /setnotif <groupId>')));
        const cfg = await loadConfig(env); cfg.logGroupId = gid; await saveConfig(env, cfg);
        await sendMessage(env, user.id, `✅ ID grup log disimpan: ${gid}`);
        return new Response(JSON.stringify({ ok:true }));
      }
      if (text.startsWith('/ban')) {
        if (String(user.id) !== String(env.ADMIN_ID)) return new Response(JSON.stringify(await sendMessage(env, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/); const target = parts[1]; const reason = parts.slice(2).join(' ') || 'Dibanned oleh admin';
        if (!target) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /ban <userId>')));
        await addBan(env, target, reason); await sendMessage(env, user.id, `✅ User ${target} dibanned.`); try{ await sendMessage(env, parseInt(target), `❌ Anda diblokir: ${reason}`); }catch(e){} await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]);
        return new Response(JSON.stringify({ ok:true }));
      }
      if (text.startsWith('/unban')) {
        if (String(user.id) !== String(env.ADMIN_ID)) return new Response(JSON.stringify(await sendMessage(env, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/); const target = parts[1];
        if (!target) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /unban <userId>')));
        await removeBan(env, target); await sendMessage(env, user.id, `✅ User ${target} di-unban.`); try{ await sendMessage(env, parseInt(target), `✅ Akun Anda dibuka kembali oleh admin.`); }catch(e){} await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]);
        return new Response(JSON.stringify({ ok:true }));
      }
      if (text.startsWith('/nexus')) return new Response(JSON.stringify(await handleNexusCommand(update, env)));

      // anti-spam for non-admin plain messages
      if (!text.startsWith('/') && String(user.id) !== String(env.ADMIN_ID)) {
        const banned = await checkAntiSpam(env, String(user.id), user.username);
        if (banned) {
          await sendMessage(env, user.id, '❌ Anda diblokir sementara karena aktivitas spam. Hubungi admin jika keliru.');
          return new Response(JSON.stringify({ ok:true }));
        }
      }

      // fallback
      return new Response(JSON.stringify({ ok:true }));
    }

    return new Response('OK');
  } catch (e) {
    console.error('main error', e);
    return new Response('Error', { status: 500 });
  }
});

router.get('/', () => new Response('TeamNexusDev Worker running'));

// -----------------------------
// Minimal Nexus admin functions (start & callback)
// -----------------------------
function nexusKeyboard(){
  return { inline_keyboard: [
    [ { text: '📦 Stok', callback_data: 'nexus_stok' }, { text: '📊 Pending', callback_data: 'nexus_pending' } ],
    [ { text: '🚫 Anti-Spam', callback_data: 'nexus_spam' }, { text: '🔙 Tutup', callback_data: 'nexus_main' } ]
  ]};
}
function backButton(data='nexus_main'){ return { inline_keyboard: [ [ { text: '🔙 Kembali', callback_data: data } ] ] }; }

async function handleNexusCommand(update, env){
  const from = update.message.from;
  if (String(from.id) !== String(env.ADMIN_ID)) return await sendMessage(env, from.id, '❌ Akses ditolak. Hanya admin.');
  const users = await loadUsers(env);
  const total = Object.keys(users).length;
  const msg = `<b>👑 NEXUS — Admin Console</b>\nMembers: <code>${total}</code>\nPilih tindakan:`;
  return await sendMessage(env, from.id, msg, nexusKeyboard());
}
async function handleNexusCallback(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  if (String(from.id) !== String(env.ADMIN_ID)) { await answerCallback(env, cb.id, '❌ Akses ditolak', true); return; }
  await answerCallback(env, cb.id);
  const data = cb.data;
  if (data === 'nexus_stok') {
    // simple list stok keys
    const accounts = await loadAccounts(env);
    const keys = Object.keys(accounts);
    if (keys.length === 0) return await editText(env, from.id, cb.message.message_id, `<b>📦 Manajemen Stok</b>\nBelum ada produk.`, backButton('nexus_main'));
    let s = `<b>📦 Daftar Produk</b>\n`;
    keys.forEach(k => {
      const p = accounts[k];
      const stock = Array.isArray(p.items)?p.items.length:(p.items?1:0);
      s += `> ${k} — ${p.name} — ${stock} akun\n`;
    });
    s += `\nGunakan /addproduk untuk menambah produk cepat.`;
    return await editText(env, from.id, cb.message.message_id, s, backButton('nexus_main'));
  }
  if (data === 'nexus_pending') {
    const pending = await loadPending(env);
    const keys = Object.keys(pending);
    if (keys.length === 0) return await editText(env, from.id, cb.message.message_id, `<b>⏰ Pending Payments</b>\nTidak ada pending saat ini.`, backButton('nexus_main'));
    let s = `<b>⏰ Pending Payments</b>\n`;
    for (const k of keys) {
      const p = pending[k];
      s += `> ${k} — ${p.transactionId} — Rp ${formatNumber(p.total)}\n`;
    }
    return await editText(env, from.id, cb.message.message_id, s, backButton('nexus_main'));
  }
  if (data === 'nexus_spam') {
    const cfg = await loadConfig(env);
    const spam = cfg.spam || { limit: 10, window: 10 };
    return await editText(env, from.id, cb.message.message_id, `<b>🚫 Anti-Spam</b>\nLimit: <code>${spam.limit}</code> pesan / <code>${spam.window}</code> detik`, backButton('nexus_main'));
  }
  return await editText(env, from.id, cb.message.message_id, `<b>Command belum diimplementasikan</b>`, backButton('nexus_main'));
}

// -----------------------------
// Export
// -----------------------------
export default { fetch: router.handle };
