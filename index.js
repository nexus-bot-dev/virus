 // index.js - TeamNexusDev Cloudflare Worker (Versi 1.1 Beta Full)
// Features:
// - Product listing "ALL PRODUCT" UI (like screenshots)
// - Product detail UI with qty control, TAKE ALL, BUY QRIS
// - QRIS creation & pending payments stored in KV
// - Confirm payment -> deliver account, decrement stock, send SVG receipt to user & group
// - Admin /nexus panel, add stock multi-step, ban/unban, setnotif, anti-spam
// KV binding expected: BOT_DB
// ENV required: BOT_TOKEN, ADMIN_ID, ADMIN_USERNAME, API_CREATE_URL, API_CHECK_PAYMENT, MIN_AMOUNT, RANDOM_AMOUNT_MIN, RANDOM_AMOUNT_MAX
// Optional: IMAGE_CONVERT_URL (svg -> png converter)

import { Router } from 'itty-router';
const router = Router();

// ---------------------------
// In-memory
// ---------------------------
const sessions = new Map(); // admin multi-step sessions
const messageTimes = new Map(); // anti-spam per user
const START = Date.now();

// ---------------------------
// KV Helpers
// ---------------------------
async function kvGet(env, key) {
  try {
    const v = await env.BOT_DB.get(key, { type: 'json' });
    return v || {};
  } catch (e) {
    console.error('kvGet', key, e);
    return {};
  }
}
async function kvPut(env, key, value) {
  try {
    await env.BOT_DB.put(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('kvPut', key, e);
    return false;
  }
}

// DB namespaces
async function loadAccounts(env) { return await kvGet(env, 'accounts'); } // object: key -> { name, price, description, items: [{user:..., pass:...}], note }
async function saveAccounts(env, accounts) { return await kvPut(env, 'accounts', accounts); }
async function loadUsers(env) { return await kvGet(env, 'users'); } // userId -> { saldo maybe unused }
async function saveUsers(env, users) { return await kvPut(env, 'users', users); }
async function loadPending(env) { return await kvGet(env, 'pending_payments'); }
async function savePending(env, pending) { return await kvPut(env, 'pending_payments', pending); }
async function loadConfig(env) { const cfg = await kvGet(env, 'bot_config'); return { bonus: cfg.bonus || { mode: 'percent', percent: 0, ranges: [] }, spam: cfg.spam || { limit: 10, window: 10 }, logGroupId: cfg.logGroupId || null, ...cfg }; }
async function saveConfig(env, cfg) { return await kvPut(env, 'bot_config', cfg); }
async function loadStats(env) { return await kvGet(env, 'stats'); }
async function saveStats(env, s) { return await kvPut(env, 'stats', s); }
async function loadBans(env) { return await kvGet(env, 'banned_users'); }
async function saveBans(env, bans) { return await kvPut(env, 'banned_users', bans); }

// ---------------------------
// Utils / Format
// ---------------------------
function formatNumber(n=0){ return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function niceTime(d=new Date()){
  const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} WIB`;
}
function uptimeStr(){ return formatUptime(Date.now()-START); }
function formatUptime(ms){ const s=Math.floor(ms/1000); const days=Math.floor(s/86400); const hours=Math.floor((s%86400)/3600); const mins=Math.floor((s%3600)/60); const secs=s%60; return `${days}d ${hours}h ${mins}m ${secs}s`; }
function randFee(env){ const min=parseInt(env.RANDOM_AMOUNT_MIN)||1; const max=parseInt(env.RANDOM_AMOUNT_MAX)||50; return Math.floor(Math.random()*(max-min+1))+min; }
function escapeXml(s){ return String(s).replace(/[&<>'"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;' })[c]); }

// ---------------------------
// Telegram Helpers
// ---------------------------
async function tg(method, env, payload){ const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`; try{ const res = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) }); return await res.json(); } catch(e){ console.error('tg err', method, e); return null; } }
async function sendMessage(env, chatId, text, replyMarkup=null){ const payload={ chat_id: chatId, text, parse_mode: 'HTML' }; if(replyMarkup) payload.reply_markup = replyMarkup; return await tg('sendMessage', env, payload); }
async function sendPhoto(env, chatId, photoUrl, caption='', replyMarkup=null){ const payload={ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' }; if(replyMarkup) payload.reply_markup=replyMarkup; return await tg('sendPhoto', env, payload); }
async function editText(env, chatId, messageId, text, replyMarkup=null){ const payload={ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }; if(replyMarkup) payload.reply_markup=replyMarkup; return await tg('editMessageText', env, payload); }
async function editCaption(env, chatId, messageId, caption, replyMarkup=null){ const payload={ chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML' }; if(replyMarkup) payload.reply_markup=replyMarkup; return await tg('editMessageCaption', env, payload); }
async function answerCallback(env, callbackQueryId, text=null, showAlert=false){ const payload={ callback_query_id: callbackQueryId }; if(text) { payload.text=text; payload.show_alert=showAlert; } return await tg('answerCallbackQuery', env, payload); }

// send document (file) via multipart/form-data (Workers support fetch with FormData)
async function sendDocumentBuffer(env, chatId, filename, arrayBuffer, caption=''){
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`;
  const form = new FormData();
  const blob = new Blob([arrayBuffer], { type: filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' });
  form.append('chat_id', String(chatId));
  form.append('document', blob, filename);
  if(caption) form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  try{ const r = await fetch(url, { method: 'POST', body: form }); return await r.json(); } catch(e){ console.error('sendDocumentBuffer', e); return null; }
}

// ---------------------------
// Logging (to group) - quoted style
// ---------------------------
async function sendLog(env, title, items=[]){
  try{
    const cfg = await loadConfig(env);
    const gid = cfg.logGroupId;
    if(!gid) return;
    let text = `${title}\n`;
    for(const it of items) text += `> ${it}\n`;
    const tags=[];
    if(/deposit/i.test(title)) tags.push('#DEPOSIT');
    if(/pembelian|pembeli/i.test(title)) tags.push('#TRANSACTION','#SUCCESS');
    if(/pending/i.test(title)) tags.push('#PENDING');
    if(/ban/i.test(title)) tags.push('#SECURITY');
    if(tags.length) text += tags.join(' ');
    await sendMessage(env, gid, text);
  }catch(e){ console.error('sendLog', e); }
}

// ---------------------------
// Bans
// ---------------------------
async function isBanned(env, userId){ const bans = await loadBans(env); return !!bans[userId]; }
async function addBan(env, userId, reason='banned'){ const bans = await loadBans(env); bans[userId] = { reason, ts: new Date().toISOString() }; await saveBans(env, bans); }
async function removeBan(env, userId){ const bans = await loadBans(env); if(bans[userId]){ delete bans[userId]; await saveBans(env, bans); } }

// ---------------------------
// Anti-spam (auto-ban) - sliding window
// ---------------------------
async function checkSpam(env, userId, username){
  const cfg = await loadConfig(env);
  const limit = cfg.spam.limit || 10;
  const windowSec = cfg.spam.window || 10;
  const now = Date.now();
  const arr = messageTimes.get(userId) || [];
  const pruned = arr.filter(t => now - t <= windowSec*1000);
  pruned.push(now);
  messageTimes.set(userId, pruned);
  if(pruned.length > limit){
    await addBan(env, userId, 'auto-spam');
    await sendMessage(env, env.ADMIN_ID, `<b>🚫 Auto-Ban (Anti-Spam)</b>\n> 👤 User: @${username||'N/A'} (ID: ${userId})\n> 🧠 Alasan: Spam\n> ⏰ ${niceTime(new Date())}`);
    await sendLog(env, '🚫 Auto-Ban (Anti-Spam)', [`👤 User: @${username||'N/A'} (ID: ${userId})`, `Alasan: Spam`, `Waktu: ${niceTime(new Date())}`]);
    messageTimes.delete(userId);
    return true;
  }
  return false;
}

// ---------------------------
// Receipt (SVG) generator
// ---------------------------
function genReceiptSVG(tx){
  // tx: { type, username, userId, transactionId, nominal, fee, total, productName, date, admin }
  const username = tx.username || 'Pengguna';
  const userId = tx.userId || 'N/A';
  const trans = tx.transactionId || `TX${Date.now()}`;
  const nominal = formatNumber(tx.nominal||0);
  const fee = formatNumber(tx.fee||0);
  const total = formatNumber(tx.total|| (tx.nominal + (tx.fee||0)));
  const product = tx.productName || '-';
  const date = tx.date || niceTime(new Date());
  const admin = tx.admin || (process?.env?.ADMIN_USERNAME || 'TeamNexusDev');

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="700" height="420">
    <style>
      .bg{fill:#fff;}
      .h{font:24px "Segoe UI", Roboto, Arial; font-weight:700; fill:#111;}
      .s{font:14px "Segoe UI", Roboto, Arial; fill:#333;}
      .mono{font-family:"Courier New", monospace; font-size:14px; fill:#111;}
      .small{font-size:12px; fill:#555;}
      .line{stroke:#e6e6e6; stroke-width:1;}
      .water{font-size:18px; fill:rgba(0,0,0,0.06);}
      .thanks{font-size:16px; font-weight:600; fill:#111;}
    </style>
    <rect x="0" y="0" width="700" height="420" rx="12" ry="12" fill="#fff"/>
    <text x="30" y="50" class="h">TeamNexusDev</text>
    <text x="30" y="76" class="s">Nota Transaksi Digital</text>
    <line x1="30" y1="90" x2="670" y2="90" class="line"/>
    <text x="30" y="120" class="mono">Username: ${escapeXml(username)}</text>
    <text x="30" y="145" class="mono">User ID: ${escapeXml(String(userId))}</text>
    <text x="30" y="170" class="mono">ID Transaksi: ${escapeXml(trans)}</text>
    <text x="380" y="120" class="mono">Produk: ${escapeXml(product)}</text>
    <text x="380" y="145" class="mono">Nominal: Rp ${nominal}</text>
    <text x="380" y="170" class="mono">Fee Random: Rp ${fee}</text>
    <text x="380" y="195" class="mono">Total Bayar: Rp ${total}</text>
    <text x="30" y="240" class="small">Waktu: ${escapeXml(date)}</text>
    <line x1="30" y1="260" x2="670" y2="260" class="line"/>
    <text x="30" y="300" class="thanks">Terima kasih telah bertransaksi 💎</text>
    <text x="30" y="330" class="small">Jika ada kendala, hubungi admin: ${escapeXml(admin)}</text>
    <g transform="translate(360,340) rotate(-30)"><text class="water">by NEXUS</text></g>
    <text x="30" y="390" class="small">Nota digital. Simpan sebagai bukti transaksi.</text>
  </svg>`;
  return svg;
}

// send receipt to user & group (svg or converted png)
async function sendReceipt(env, tx){
  try{
    const svg = genReceiptSVG(tx);
    const filename = `struk_${tx.transactionId||Date.now()}.svg`;
    const caption = tx.type === 'purchase' ? `✅ Pembelian Berhasil\n> Produk: ${tx.productName}\n> Total: Rp ${formatNumber(tx.total||tx.nominal)}` : `✅ Pembayaran Dikonfirmasi\n> Nominal: Rp ${formatNumber(tx.nominal)}\n> Total: Rp ${formatNumber(tx.total||tx.nominal)}`;
    // if IMAGE_CONVERT_URL provided, try convert -> png
    if(env.IMAGE_CONVERT_URL){
      try{
        const conv = await fetch(env.IMAGE_CONVERT_URL, { method:'POST', headers: { 'Content-Type':'image/svg+xml' }, body: svg });
        if(conv.ok){
          const buf = await conv.arrayBuffer();
          await sendDocumentBuffer(env, tx.userId||tx.user, `struk_${tx.transactionId||Date.now()}.png`, buf, caption);
          const cfg = await loadConfig(env);
          if(cfg.logGroupId) await sendDocumentBuffer(env, cfg.logGroupId, `struk_${tx.transactionId||Date.now()}.png`, buf, caption);
          return;
        }
      }catch(e){ console.warn('convert fail', e); }
    }
    // fallback: send SVG document
    await sendDocumentBuffer(env, tx.userId||tx.user, filename, new TextEncoder().encode(svg), caption);
    const cfg = await loadConfig(env);
    if(cfg.logGroupId) await sendDocumentBuffer(env, cfg.logGroupId, filename, new TextEncoder().encode(svg), caption);
  }catch(e){ console.error('sendReceipt', e); }
}

// ---------------------------
// Product UI builders
// ---------------------------
function buildAllProductsMessage(accounts){
  // accounts: key -> { name, price, description, items: [...] }
  const lines = [];
  lines.push(`<b>👑 ALL PRODUCT 👑</b>`);
  lines.push(`Silahkan tekan tombol dibawah ini sesuai stok yang Anda cari 🛍️\n`);
  const keys = Object.keys(accounts);
  if(keys.length === 0){
    lines.push(`⚠️ Belum ada produk tersedia.`);
    return lines.join('\n');
  }
  let idx=1;
  for(const key of keys){
    const p = accounts[key];
    const stock = Array.isArray(p.items) ? p.items.length : (p.items?1:0);
    const ok = stock>0 ? '✅' : '❌';
    lines.push(`<b>[ ${idx} ] ${escapeXml(p.name)}</b>`);
    lines.push(`Stock Tersedia : ${stock} ${ok}`);
    lines.push('──────────────────────────');
    idx++;
  }
  lines.push(`\nJika stok yang Anda cari kosong,\nsilahkan hubungi CS di bio bot ini 💬`);
  return lines.join('\n');
}
function buildAllProductsKeyboard(accounts){
  const keys = Object.keys(accounts);
  const kb = [];
  let idx=1;
  for(const key of keys){
    const p = accounts[key];
    const stock = Array.isArray(p.items) ? p.items.length : (p.items?1:0);
    // each button payload: prod_<key>
    kb.push([ { text: `${idx}`, callback_data: `prod_${key}` }, { text: `${p.name} (${stock})`, callback_data: `prod_${key}` } ]);
    idx++;
  }
  kb.push([ { text: '🔙 Kembali', callback_data: 'back_main' } ]);
  return { inline_keyboard: kb };
}

// product detail text
function buildProductDetail(p, qty=1){
  const stock = Array.isArray(p.items) ? p.items.length : (p.items?1:0);
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
  // callback_data encoding: buy_qr_<key>_<qty>, inc_<key>_<qty>, dec_<key>_<qty>, takeall_<key>
  const kb = [
    [ { text: '➖', callback_data: `dec_${key}_${qty}` }, { text: `${qty}`, callback_data: 'noop' }, { text: '➕', callback_data: `inc_${key}_${qty}` } ],
    [ { text: '📦 TAKE ALL', callback_data: `takeall_${key}` } ],
    [ { text: '🔙 Kembali', callback_data: 'beli_akun' }, { text: '💳 BUY QRIS', callback_data: `buy_qr_${key}_${qty}` } ]
  ];
  return { inline_keyboard: kb };
}

// ---------------------------
// QRIS creation helper (calls external API_CREATE_URL)
// Expected response: { status: 'success', data: { download_url, transactionId } }
// Adjust parsing according to your API.
async function createQris(env, amount){
  try{
    const url = `${env.API_CREATE_URL}?amount=${amount}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    if(!data || data.status !== 'success') return null;
    return data.data;
  }catch(e){ console.error('createQris', e); return null; }
}

// check payments helper (calls API_CHECK_PAYMENT)
// Expected response shape depends on provider. This function should be adapted.
async function checkPayments(env){
  try{
    const res = await fetch(env.API_CHECK_PAYMENT);
    if(!res.ok) return null;
    const data = await res.json();
    return data;
  }catch(e){ console.error('checkPayments', e); return null; }
}

// ---------------------------
// Core Flows
// ---------------------------

// /start
async function handleStart(update, env){
  const user = update.message.from;
  const uid = String(user.id);
  const users = await loadUsers(env);
  if(!users[uid]) { users[uid] = { createdAt: new Date().toISOString() }; await saveUsers(env, users); }
  if(await isBanned(env, uid)) return await sendMessage(env, user.id, `❌ <b>Akses Ditolak</b>\nAnda telah diblokir.`);
  const accounts = await loadAccounts(env);
  const stats = await loadStats(env);
  const totalUsers = Object.keys(users).length;
  const successCount = (stats && stats.success) ? stats.success : 0;
  const stokCount = Object.keys(accounts).length;
  const uptime = formatUptime(Date.now()-START);
  const userView = { id: user.id, username: user.username, first_name: user.first_name, saldo: users[uid].saldo || 0 };
  const msg = `
<b>🧩 Versi 1.1 Beta</b>

<b>Halo, ${user.username ? '@'+user.username : (user.first_name || 'Pengguna')}! 👋</b>
Selamat datang di <b>𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃</b>.
Solusi digital otomatis Anda.

<b>┌ INFORMASI AKUN ANDA</b>
├ 🆔 <b>User ID:</b> <code>${user.id}</code>
└ 💰 <b>Saldo:</b> <code>Rp ${formatNumber(userView.saldo || 0)}</code>

<b>┌ STATISTIK BOT</b>
├ 👥 <b>Total Pengguna:</b> <code>${totalUsers}</code>
├ ✅ <b>Transaksi Sukses:</b> <code>${successCount}</code>
├ 📦 <b>Stok Tersedia:</b> <code>${stokCount} Produk</code>
└ ⏱️ <b>Bot Aktif Sejak:</b> <code>${uptime}</code>

<b>┌ BANTUAN</b>
└ 👨‍💼 <b>Admin:</b> ${env.ADMIN_USERNAME ? env.ADMIN_USERNAME : env.ADMIN_ID}

👇 <b>Silakan pilih menu di bawah ini:</b>`.trim();

  const kb = { inline_keyboard: [ [{ text: '🛒 Beli Akun', callback_data: 'beli_akun' }], [{ text: '💳 Deposit Saldo', callback_data: 'deposit' }], [{ text: '📞 Bantuan', callback_data: 'help' }] ] };
  return await sendMessage(env, user.id, msg, kb);
}

// command /beli_akun (show all products)
async function handleAllProducts(update, env, edit=false){
  const from = update.message ? update.message.from : update.callback_query.from;
  const chatId = from.id;
  const accounts = await loadAccounts(env);
  const msg = buildAllProductsMessage(accounts);
  const kb = buildAllProductsKeyboard(accounts);
  if(edit && update.callback_query) {
    await answerCallback(env, update.callback_query.id);
    return await editText(env, chatId, update.callback_query.message.message_id, msg, kb);
  }
  return await sendMessage(env, chatId, msg, kb);
}

// when user presses a product button: show detail
async function handleProductDetail(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  await answerCallback(env, cb.id);
  const data = cb.data; // prod_<key>
  const key = data.split('_').slice(1).join('_');
  const accounts = await loadAccounts(env);
  const p = accounts[key];
  if(!p) return await editText(env, from.id, cb.message.message_id, '⚠️ Produk tidak ditemukan.', { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'beli_akun' }]] });
  const stock = Array.isArray(p.items) ? p.items.length : (p.items?1:0);
  const qty = 1;
  const text = buildProductDetail(p, qty);
  const kb = productDetailKeyboard(key, qty, stock);
  return await editText(env, from.id, cb.message.message_id, text, kb);
}

// quantity increment/decrement/takeall handlers
async function handleQtyChange(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  const arr = cb.data.split('_'); // e.g., inc_key_qty or dec_key_qty or takeall_key
  const action = arr[0];
  const key = arr[1];
  let qty = parseInt(arr[2]||'1');
  const accounts = await loadAccounts(env);
  const p = accounts[key];
  if(!p){ await answerCallback(env, cb.id, 'Produk tidak ditemukan', true); return; }
  const stock = Array.isArray(p.items)?p.items.length:(p.items?1:0);
  if(action === 'inc'){ qty = Math.min(stock, qty+1); }
  else if(action === 'dec'){ qty = Math.max(1, qty-1); }
  else if(action === 'takeall'){ qty = Math.max(1, stock); }
  // update buttons: we need to edit message
  await answerCallback(env, cb.id);
  const text = buildProductDetail(p, qty);
  const kb = productDetailKeyboard(key, qty, stock);
  return await editText(env, from.id, cb.message.message_id, text, kb);
}

// buy QRIS flow: create QR, store pending
async function handleBuyQris(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  await answerCallback(env, cb.id);
  // data: buy_qr_<key>_<qty>
  const parts = cb.data.split('_');
  const key = parts[2];
  let qty = parseInt(parts[3]||'1');
  if(qty < 1) qty = 1;
  const accounts = await loadAccounts(env);
  const p = accounts[key];
  if(!p){ return await editText(env, from.id, cb.message.message_id, '⚠️ Produk tidak ditemukan.', { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'beli_akun' }]] }); }
  const stock = Array.isArray(p.items)?p.items.length:(p.items?1:0);
  if(stock < qty) return await answerCallback(env, cb.id, '⚠️ Stok tidak mencukupi.', true);

  const nominal = p.price * qty;
  const feeRandom = randFee(env);
  const total = nominal + feeRandom;

  // create QRIS via API
  const qris = await createQris(env, total);
  if(!qris){
    await sendMessage(env, from.id, '❌ Gagal membuat QRIS. Coba lagi nanti.');
    return;
  }
  const qrisUrl = qris.download_url || qris.qr || qris.qr_url || qris.image || qris.url;
  const transId = qris.transactionId || qris.kode || (`TX${Date.now()}`);

  // save pending
  const pending = await loadPending(env);
  pending[String(from.id)] = {
    type: 'purchase',
    userId: String(from.id),
    username: from.username ? `@${from.username}` : (from.first_name || 'Pengguna'),
    transactionId: transId,
    productKey: key,
    qty,
    nominal,
    feeRandom,
    total,
    timestamp: new Date().toISOString(),
    messageId: null
  };
  await savePending(env, pending);

  // caption and keyboard: confirm / cancel
  const caption = `
🧾 <b>PEMBELIAN PRODUK</b>
🎁 <b>Nama:</b> ${escapeXml(p.name)}
🏷️ <b>Kode:</b> ${escapeXml(key)}
🔢 <b>Jumlah:</b> ${qty}
💰 <b>Harga Satuan:</b> Rp ${formatNumber(p.price)}
🧾 <b>Admin Fee:</b> ${feeRandom}
💳 <b>Total Bayar:</b> Rp ${formatNumber(total)}
⏳ <b>Timeout:</b> 10 menit

📌 Scan QR ini & bayar Total Bayar.
`.trim();

  const kb = { inline_keyboard: [[ { text: '✅ Konfirmasi Pembayaran', callback_data: `confirm_${transId}` }, { text: '❌ Cancel', callback_data: `cancel_${transId}` }]] };

  // send photo (qris) to user
  let sent = null;
  if(qrisUrl){
    sent = await sendPhoto(env, from.id, qrisUrl, caption, kb);
    if(sent && sent.ok){
      pending[String(from.id)].messageId = sent.result.message_id;
      await savePending(env, pending);
    }
  } else {
    // fallback: send message with link
    const m = await sendMessage(env, from.id, caption + `\n\nLink: ${qrisUrl || '—'}`, kb);
    if(m && m.ok){
      pending[String(from.id)].messageId = m.result.message_id;
      await savePending(env, pending);
    }
  }

  // notify admin & log
  await sendMessage(env, env.ADMIN_ID, `<b>⏳ Pembayaran Pending</b>\n> 👤 Username: ${pending[String(from.id)].username}\n> 🆔 User ID: ${from.id}\n> 🧾 Id Transaksi: ${transId}\n> 💳 Total Bayar: Rp ${formatNumber(total)}`);
  await sendLog(env, '⏳ Pembayaran Pending', [
    `👤 Username: ${pending[String(from.id)].username} (ID: ${from.id})`,
    `Id Transaksi: ${transId}`,
    `Nominal: Rp ${formatNumber(nominal)}`,
    `Fee Random: Rp ${formatNumber(feeRandom)}`,
    `Total Bayar: Rp ${formatNumber(total)}`,
    `Waktu: ${niceTime(new Date())}`
  ]);

  return;
}

// cancel pending (user or admin)
async function handleCancel(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  const parts = cb.data.split('_');
  const trans = parts[1];
  await answerCallback(env, cb.id);
  const pending = await loadPending(env);
  // find pending by trans id
  const entryKey = Object.keys(pending).find(k => pending[k].transactionId === trans);
  if(!entryKey){
    return await answerCallback(env, cb.id, '❌ Pending tidak ditemukan', true);
  }
  const ent = pending[entryKey];
  if(ent.messageId){
    try{ await editCaption(env, parseInt(entryKey), ent.messageId, `❌ <b>Pembayaran Dibatalkan</b>\nID: <code>${trans}</code>`); } catch(e){}
  }
  delete pending[entryKey];
  await savePending(env, pending);
  await sendMessage(env, env.ADMIN_ID, `<b>❌ Pembayaran Dibatalkan</b>\n> User: ${entryKey}\n> Trans: ${trans}`);
  await sendLog(env, '❌ Pembayaran Dibatalkan', [`User: ${entryKey}`, `Trans: ${trans}`, `Waktu: ${niceTime(new Date())}`]);
  return await answerCallback(env, cb.id, '✅ Pembayaran dibatalkan', true);
}

// confirm payment: check external API, deliver product, decrement stock, send receipt
async function handleConfirm(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  const trans = cb.data.split('_')[1];
  await answerCallback(env, cb.id);
  const pending = await loadPending(env);
  const entryKey = Object.keys(pending).find(k => pending[k].transactionId === trans);
  if(!entryKey) return await answerCallback(env, cb.id, '❌ Pending tidak ditemukan', true);
  const ent = pending[entryKey];

  // check timeout 10 min
  const created = new Date(ent.timestamp);
  if((Date.now() - created.getTime()) / (1000*60) > 10){
    // expired
    if(ent.messageId){ try{ await editCaption(env, parseInt(entryKey), ent.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${trans}</code>`); }catch(e){} }
    delete pending[entryKey];
    await savePending(env, pending);
    await sendLog(env, '⏰ Pending Expired', [`User: ${entryKey}`, `Trans: ${trans}`, `Waktu: ${niceTime(new Date())}`]);
    return await answerCallback(env, cb.id, '❌ Pembayaran expired', true);
  }

  // call API_CHECK_PAYMENT to verify. Implementation depends on provider.
  const check = await checkPayments(env);
  // try to find a payment that matches amount and transaction id (adapt to your API)
  let found = false;
  if(check && check.status === 'success' && Array.isArray(check.data)){
    for(const pay of check.data){
      // This is heuristic: compare amount or id. Adjust according to your provider
      if(String(pay.transactionId) === String(trans) || Number(pay.amount) === Number(ent.total)) { found = true; break; }
    }
  } else if(check && check.status === 'success' && check.data && (check.data.transactionId === trans || Number(check.data.amount) === Number(ent.total))) {
    found = true;
  }

  if(!found){
    return await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi.', true);
  }

  // payment verified: deliver product(s)
  const accounts = await loadAccounts(env);
  const key = ent.productKey;
  const prod = accounts[key];
  if(!prod){ return await answerCallback(env, cb.id, '⚠️ Produk tidak ditemukan (admin).', true); }

  const stock = Array.isArray(prod.items) ? prod.items.length : (prod.items?1:0);
  if(stock < ent.qty){
    return await answerCallback(env, cb.id, '⚠️ Stok tidak mencukupi.', true);
  }

  // take qty items and prepare message
  const delivered = [];
  for(let i=0;i<ent.qty;i++){
    const item = prod.items.shift(); // remove from front
    delivered.push(item);
  }
  // save accounts back
  await saveAccounts(env, accounts);

  // edit original message to mark confirmed
  if(ent.messageId){
    try{
      await editCaption(env, parseInt(entryKey), ent.messageId, `✅ <b>Pembayaran Terkonfirmasi</b>\nID: <code>${trans}</code>\nTerima kasih!`);
    }catch(e){}
  }

  // send delivered account details to user (neat)
  let deliverText = `✅ <b>Pembelian Berhasil</b>\n<b>Produk:</b> ${escapeXml(prod.name)}\n<b>Jumlah:</b> ${ent.qty}\n\n<b>Detail Akun:</b>\n`;
  delivered.forEach((it, idx) => {
    deliverText += `\n— Akun ${idx+1} —\n`;
    if(it.user) deliverText += `<b>Username/Email:</b> <code>${escapeXml(it.user)}</code>\n`;
    if(it.pass) deliverText += `<b>Password:</b> <code>${escapeXml(it.pass)}</code>\n`;
    if(it.note) deliverText += `<b>Note:</b> ${escapeXml(it.note)}\n`;
  });
  await sendMessage(env, ent.userId, deliverText);

  // send receipt to user & group
  await sendReceipt(env, {
    type: 'purchase',
    username: ent.username,
    userId: ent.userId,
    transactionId: ent.transactionId,
    nominal: ent.nominal,
    fee: ent.feeRandom,
    total: ent.total,
    productName: prod.name,
    date: niceTime(new Date()),
    admin: env.ADMIN_USERNAME || 'TeamNexusDev'
  });

  // notify admin & log
  await sendMessage(env, env.ADMIN_ID, `<b>🔔 Pembelian Sukses</b>\n> 👤 User: ${ent.username} (ID: ${ent.userId})\n> 🛒 Produk: ${prod.name}\n> 💰 Harga: Rp ${formatNumber(ent.total)}\n> 🕒 ${niceTime(new Date())}`);
  await sendLog(env, '📦 Transaksi Sukses', [
    `👤 User: ${ent.username} (ID: ${ent.userId})`,
    `Produk: ${prod.name}`,
    `Jumlah: ${ent.qty}`,
    `Harga (total): Rp ${formatNumber(ent.total)}`,
    `Waktu: ${niceTime(new Date())}`
  ]);

  // increment stats
  const stats = await loadStats(env); stats.success = (stats.success || 0) + 1; await saveStats(env, stats);

  // remove pending
  delete pending[entryKey];
  await savePending(env, pending);

  return await answerCallback(env, cb.id, '✅ Pembayaran terkonfirmasi dan akun terkirim', true);
}

// ---------------------------
// Admin: add stock multi-step (tambah_akun session)
// ---------------------------
async function handleAdminSession(update, env){
  // triggered when admin has an active session in sessions Map
  const msg = update.message;
  const user = msg.from;
  if(String(user.id) !== String(env.ADMIN_ID)) return;
  const s = sessions.get(user.id);
  if(!s) return;
  const text = (msg.text||'').trim();
  const accounts = await loadAccounts(env);

  try{
    switch(s.action){
      case 'tambah_akun': {
        const step = s.step || 'nama';
        const data = s.data || {};
        if(step === 'nama'){
          if(!text) { await sendMessage(env, user.id, '❌ Ketik nama produk'); sessions.delete(user.id); return; }
          data.name = text; s.step='key'; s.data = data; sessions.set(user.id, s);
          await sendMessage(env, user.id, '<b>Masukkan key/email unik (kunci penyimpanan)</b>\nContoh: do10cc');
          return;
        }
        if(step === 'key'){
          if(!text) { await sendMessage(env, user.id, '❌ Ketik key'); sessions.delete(user.id); return; }
          data.key = text; s.step='password'; s.data=data; sessions.set(user.id,s);
          await sendMessage(env, user.id, '<b>Masukkan password / akun (jika multiple, pisahkan dengan | )</b>\nContoh single: user@mail|pass\nContoh multiple: acc1@mail|pass1;acc2@mail|pass2 (gunakan ; untuk pisah akun)');
          return;
        }
        if(step === 'password'){
          if(!text) { await sendMessage(env, user.id, '❌ Ketik password/akun'); sessions.delete(user.id); return; }
          // parse items: support ; separated pairs user|pass or single text saved as user only
          const raw = text;
          const items = [];
          // if semicolon separated
          const parts = raw.split(';').map(s=>s.trim()).filter(Boolean);
          for(const p of parts){
            if(p.includes('|')){
              const [u, pw] = p.split('|').map(s=>s.trim());
              items.push({ user: u, pass: pw });
            } else {
              // store as single string (user) with empty pass
              items.push({ user: p, pass: '' });
            }
          }
          data.items = items;
          s.step='harga'; s.data=data; sessions.set(user.id,s);
          await sendMessage(env, user.id, '<b>Masukkan harga (angka)</b>\nContoh: 85000');
          return;
        }
        if(step === 'harga'){
          const price = parseInt(text.replace(/\D/g,'')); if(isNaN(price)){ await sendMessage(env, user.id, '❌ Harga harus angka'); sessions.delete(user.id); return; }
          data.price = price; s.step='deskripsi'; s.data=data; sessions.set(user.id,s);
          await sendMessage(env, user.id, '<b>Masukkan deskripsi produk</b>\n(atau ketik: tidak ada)');
          return;
        }
        if(step === 'deskripsi'){
          data.description = (text.toLowerCase() === 'tidak ada') ? '' : text;
          s.step='note'; s.data=data; sessions.set(user.id,s);
          await sendMessage(env, user.id, '<b>Masukkan catatan singkat (opsional)</b>\n(ketik tidak ada jika kosong)');
          return;
        }
        if(step === 'note'){
          data.note = (text.toLowerCase() === 'tidak ada') ? '' : text;
          // confirmation summary
          const preview = `🔎 <b>Konfirmasi Tambah Stok</b>\nNama: ${escapeXml(data.name)}\nKey: ${escapeXml(data.key)}\nHarga: Rp ${formatNumber(data.price)}\nJumlah akun: ${data.items.length}\nDeskripsi: ${escapeXml(data.description)}\nNote: ${escapeXml(data.note)}\n\n✅ Ketik "ya" untuk simpan atau "tidak" untuk batal.`;
          s.step='confirm'; s.data=data; sessions.set(user.id,s);
          await sendMessage(env, user.id, preview);
          return;
        }
        if(step === 'confirm'){
          if(text.toLowerCase() === 'ya' || text.toLowerCase() === 'y'){
            const d = s.data;
            // save into accounts KV using key (ensure uniqueness)
            let key = d.key;
            if(accounts[key]) key = `${key}_${Date.now()}`;
            accounts[key] = {
              name: d.name,
              price: d.price,
              description: d.description,
              note: d.note,
              items: d.items,
              createdAt: new Date().toISOString()
            };
            await saveAccounts(env, accounts);
            await sendMessage(env, user.id, `<b>✅ Stok ditambahkan</b>\nKey: <code>${key}</code>\nNama: ${escapeXml(d.name)}\nJumlah akun: ${d.items.length}`);
            await sendLog(env, '➕ Stok Ditambah', [`Admin: ${env.ADMIN_ID}`, `Produk: ${d.name}`, `Key: ${key}`, `Harga: Rp ${formatNumber(d.price)}`, `Jumlah: ${d.items.length}`, `Waktu: ${niceTime(new Date())}`]);
            sessions.delete(user.id);
            return;
          } else {
            await sendMessage(env, user.id, '✖️ Penambahan stok dibatalkan.'); sessions.delete(user.id); return;
          }
        }
        break;
      }
      default:
        sessions.delete(user.id);
        return;
    }
  }catch(e){ console.error('admin session err', e); sessions.delete(user.id); await sendMessage(env, user.id, '❌ Terjadi kesalahan.'); }
}

// ---------------------------
// Cleanup expired pending payments (run on incoming webhook)
async function cleanupExpired(env){
  try{
    const pending = await loadPending(env);
    const now = Date.now();
    for(const uid of Object.keys(pending)){
      const p = pending[uid];
      if(!p) continue;
      const created = new Date(p.timestamp);
      if((now - created.getTime()) / (1000*60) > 10){
        // expired
        if(p.messageId){
          try{ await editCaption(env, parseInt(uid), p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${p.transactionId}</code>`); }catch(e){}
        }
        delete pending[uid];
        await savePending(env, pending);
        await sendMessage(env, env.ADMIN_ID, `<b>⏰ Pending payment expired</b>\n> User: ${uid}\n> Trans: ${p.transactionId}`);
        await sendLog(env, '⏰ Pending Expired', [`User: ${uid}`, `Trans: ${p.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
      }
    }
  }catch(e){ console.error('cleanupExpired', e); }
}

// ---------------------------
// Router: webhook entry
// ---------------------------
router.post('/', async (request, env) => {
  try{
    const update = await request.json();

    // cleanup
    await cleanupExpired(env);

    // callback_query handling
    if(update.callback_query){
      const cb = update.callback_query;
      const data = cb.data || '';
      // nexus admin callbacks etc handled below
      // simple mapping:
      if(data === 'beli_akun') return new Response(JSON.stringify(await handleAllProducts(update, env, true)));
      if(data.startsWith('prod_')) return new Response(JSON.stringify(await handleProductDetail(update, env)));
      if(data.startsWith('inc_') || data.startsWith('dec_') || data.startsWith('takeall_')) return new Response(JSON.stringify(await handleQtyChange(update, env)));
      if(data.startsWith('buy_qr_')) return new Response(JSON.stringify(await handleBuyQris(update, env)));
      if(data.startsWith('cancel_')) return new Response(JSON.stringify(await handleCancel(update, env)));
      if(data.startsWith('confirm_')) return new Response(JSON.stringify(await handleConfirm(update, env)));
      // admin nexus callbacks & other callbacks below:
      if(data && data.startsWith('nexus')) return new Response(JSON.stringify(await handleNexusCallback(update, env)));
      // noop to prevent errors
      if(data === 'noop'){ await answerCallback(env, cb.id); return new Response(JSON.stringify({ ok:true })); }
      return new Response('OK');
    }

    // message handling
    if(update.message){
      const text = update.message.text || '';
      const user = update.message.from;

      // admin session handler
      if(String(user.id) === String(env.ADMIN_ID) && sessions.has(user.id)){
        await handleAdminSession(update, env);
        return new Response(JSON.stringify({ ok:true }));
      }

      // commands
      if(text.startsWith('/start')) return new Response(JSON.stringify(await handleStart(update, env)));
      if(text.startsWith('/beli') || text.startsWith('/beli_akun')) return new Response(JSON.stringify(await handleAllProducts(update, env)));
      if(text.startsWith('/setnotif')){
        if(String(user.id) !== String(env.ADMIN_ID)) return new Response(JSON.stringify(await sendMessage(env, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/);
        const gid = parts[1];
        if(!gid) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /setnotif <groupId>')));
        const cfg = await loadConfig(env); cfg.logGroupId = gid; await saveConfig(env, cfg);
        await sendMessage(env, user.id, `✅ ID grup log disimpan: ${gid}`);
        return new Response(JSON.stringify({ ok:true }));
      }
      if(text.startsWith('/nexus')) return new Response(JSON.stringify(await handleNexusCommand(update, env)));

      // anti-spam for non-admin
      if(!text.startsWith('/') && String(user.id) !== String(env.ADMIN_ID)){
        const banned = await checkSpam(env, String(user.id), user.username);
        if(banned){ await sendMessage(env, user.id, '❌ Anda diblokir sementara karena spam. Hubungi admin.'); return new Response(JSON.stringify({ ok:true })); }
      }

      // broadcast /admin quick commands (ban/unban) - for admin only
      if(String(user.id) === String(env.ADMIN_ID)){
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        if(cmd === '/ban'){ const target = parts[1]; const reason = parts.slice(2).join(' ')||'Dibanned oleh admin'; if(!target) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /ban <userId>'))); await addBan(env, target, reason); await sendMessage(env, user.id, `✅ User ${target} dibanned.`); try{ await sendMessage(env, parseInt(target), `❌ Anda diblokir: ${reason}`); }catch(e){} await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]); return new Response(JSON.stringify({ ok:true })); }
        if(cmd === '/unban'){ const target = parts[1]; if(!target) return new Response(JSON.stringify(await sendMessage(env, user.id, 'Usage: /unban <userId>'))); await removeBan(env, target); await sendMessage(env, user.id, `✅ User ${target} di-unban.`); try{ await sendMessage(env, parseInt(target), `✅ Akun Anda dibuka kembali oleh admin.`); }catch(e){} await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]); return new Response(JSON.stringify({ ok:true })); }
        if(cmd === '/addstok'){ // quick helper: not necessary if using UI
          return new Response(JSON.stringify(await sendMessage(env, user.id, 'Gunakan panel /nexus -> Stok -> Tambah Akun')));
        }
      }

      // free text fallback: if user sends number while in product detail? We keep deposit msg handling out (not using balance).
      // If not matched, respond OK
      return new Response(JSON.stringify({ ok:true }));
    }

    return new Response('OK');
  }catch(e){ console.error('main router', e); return new Response('Error', { status:500 }); }
});

// ---------------------------
// Admin Nexus Command & Callbacks
// ---------------------------

function nexusKeyboard(){
  return { inline_keyboard: [
    [ { text: '👥 Kontrol User', callback_data: 'nexus_user' }, { text: '💰 Saldo', callback_data: 'nexus_saldo' } ],
    [ { text: '📦 Stok', callback_data: 'nexus_stok' }, { text: '🧾 Transaksi', callback_data: 'nexus_transaksi' } ],
    [ { text: '🎁 Bonus', callback_data: 'nexus_bonus' }, { text: '🚫 Anti-Spam', callback_data: 'nexus_spam' } ],
    [ { text: '📢 Broadcast', callback_data: 'nexus_broadcast' }, { text: '🔧 Konfigurasi', callback_data: 'nexus_config' } ],
    [ { text: '📊 Pending Payments', callback_data: 'nexus_pending' }, { text: '⏱️ Uptime', callback_data: 'nexus_uptime' } ]
  ]};
}
function backButton(data='nexus_main'){ return { inline_keyboard: [ [ { text: '🔙 Kembali', callback_data: data } ] ] }; }

async function handleNexusCommand(update, env){
  const from = update.message.from;
  if(String(from.id) !== String(env.ADMIN_ID)) return await sendMessage(env, from.id, '❌ Akses ditolak. Hanya admin.');
  const users = await loadUsers(env);
  const total = Object.keys(users).length;
  const msg = `<b>👑 NEXUS — Admin Console</b>\nMembers: <code>${total}</code>\nPilih tindakan:`;
  return await sendMessage(env, from.id, msg, nexusKeyboard());
}

async function handleNexusCallback(update, env){
  const cb = update.callback_query;
  const from = cb.from;
  if(String(from.id) !== String(env.ADMIN_ID)){ await answerCallback(env, cb.id, '❌ Akses ditolak', true); return; }
  await answerCallback(env, cb.id);
  const data = cb.data;
  if(data === 'nexus_main') return await editText(env, from.id, cb.message.message_id, `<b>👑 NEXUS — Admin Console</b>`, nexusKeyboard());
  if(data === 'nexus_stok'){
    // show stok submenu
    const kb = { inline_keyboard: [ [ { text: '➕ Tambah Akun', callback_data: 'nexus_stok_add' }, { text: '🗑️ Hapus Akun', callback_data: 'nexus_stok_del' } ], [ { text: '🔙 Kembali', callback_data: 'nexus_main' } ] ] };
    return await editText(env, from.id, cb.message.message_id, `<b>📦 Manajemen Stok</b>\nPilih tindakan:`, kb);
  }
  if(data === 'nexus_stok_add'){
    sessions.set(from.id, { action: 'tambah_akun', step: 'nama', data: {} });
    return await editText(env, from.id, cb.message.message_id, `<b>➕ Tambah Akun (Stok)</b>\nLangkah 1/6 — Ketik <b>nama produk</b> (contoh: Netflix Premium)`, backButton('nexus_main'));
  }
  if(data === 'nexus_pending'){
    const pending = await loadPending(env);
    const keys = Object.keys(pending);
    if(keys.length === 0) return await editText(env, from.id, cb.message.message_id, `<b>⏰ Pending Payments</b>\nTidak ada pending saat ini.`, backButton('nexus_main'));
    const now = Date.now();
    let lines = [];
    for(const k of keys){
      const p = pending[k];
      const created = new Date(p.timestamp);
      const diff = Math.floor((now - created.getTime())/(1000*60));
      const left = Math.max(0, 10 - diff);
      lines.push(`> ${k} - ${p.transactionId} - Rp ${formatNumber(p.total)} (${left}m left)`);
    }
    return await editText(env, from.id, cb.message.message_id, `<b>⏰ Pending Payments</b>\n${lines.join('\n')}`, backButton('nexus_main'));
  }
  if(data === 'nexus_spam'){
    const cfg = await loadConfig(env);
    const spam = cfg.spam || { limit:10, window:10 };
    const kb = { inline_keyboard: [ [ { text: 'Ubah Batas Anti-Spam', callback_data: 'nexus_spam_set' } ], [ { text: '🔙 Kembali', callback_data: 'nexus_main' } ] ] };
    return await editText(env, from.id, cb.message.message_id, `<b>🚫 Anti-Spam</b>\nLimit: <code>${spam.limit}</code> pesan / <code>${spam.window}</code> detik\n\nTekan tombol untuk mengubah.`, kb);
  }
  if(data === 'nexus_spam_set'){
    sessions.set(from.id, { action: 'set_spam' });
    return await editText(env, from.id, cb.message.message_id, `<b>Set Anti-Spam</b>\nKirim: <code>limit windowSeconds</code>\nContoh: <code>10 10</code>`, backButton('nexus_main'));
  }
  // other nexus features (user ban/unban, saldo management, broadcast) can be added similarly (kept out for brevity)
  return await editText(env, from.id, cb.message.message_id, `<b>Command belum diimplementasikan</b>`, backButton('nexus_main'));
}

// ---------------------------
// Start page for GET
// ---------------------------
router.get('/', () => new Response('TeamNexusDev Bot Worker is running'));

// ---------------------------
// Export
// ---------------------------
export default {
  fetch: router.handle
};
