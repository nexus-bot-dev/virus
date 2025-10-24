 import { Router } from 'itty-router';
const router = Router();

/**
 * NexusDev — Supreme UX Edition (index.js)
 * - Premium UI/UX (Fintech Ungu)
 * - Full button-driven: Produk, Deposit, Saldo, Bantuan, Admin
 * - Produk: kategori otomatis, pagination, qty +/- per produk, Take All
 * - Notifikasi & QRIS captions use Telegram blockquote format ("> ...")
 * - All features preserved: deposit, bonus, pending, admin, anti-spam, logging
 *
 * Env required:
 * BOT_TOKEN, ADMIN_ID, BOT_DB, API_CREATE_URL, API_CHECK_PAYMENT, QRIS_CODE,
 * MERCHANT_ID, API_KEY, MIN_AMOUNT, RANDOM_AMOUNT_MIN, RANDOM_AMOUNT_MAX, BANNER_URL (optional)
 */

// -------------------------------
// In-memory & constants
const userSessions = new Map(); // { userId: { action: 'purchase', email, name, price, qty } }
const messageTimestamps = new Map();
const START_TIME = Date.now();
const PAGE_SIZE = 6;
const BRAND = 'NexusDev Supreme Bot';
const THEME_EMOJI = '💜';

// -------------------------------
// KV helpers
async function kvGet(env, key) {
  try {
    const raw = await env.BOT_DB.get(key, { type: 'json' });
    return raw || {};
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
async function loadDB(env, dbType) { return await kvGet(env, dbType); }
async function saveDB(env, data, dbType) { return await kvPut(env, dbType, data); }

// pending payments helpers
async function loadPendingPayments(env) { return await kvGet(env, 'pending_payments'); }
async function savePendingPayment(env, userId, paymentData) {
  try {
    const pending = await loadPendingPayments(env);
    pending[userId] = {
      ...paymentData,
      timestamp: paymentData.timestamp instanceof Date ? paymentData.timestamp.toISOString() : paymentData.timestamp
    };
    await kvPut(env, 'pending_payments', pending);
    return true;
  } catch (e) { console.error('savePendingPayment', e); return false; }
}
async function removePendingPayment(env, userId) {
  try {
    const pending = await loadPendingPayments(env);
    if (pending[userId]) {
      delete pending[userId];
      await kvPut(env, 'pending_payments', pending);
    }
    return true;
  } catch (e) { console.error('removePendingPayment', e); return false; }
}
async function getPendingPayment(env, userId) {
  try {
    const pending = await loadPendingPayments(env);
    const p = pending[userId];
    if (!p) return null;
    return { ...p, timestamp: new Date(p.timestamp) };
  } catch (e) { console.error('getPendingPayment', e); return null; }
}

// stats
async function loadStats(env) {
  const s = await kvGet(env, 'stats');
  return { success: s.success || 0, ...s };
}
async function incrStatSuccess(env, n = 1) {
  const s = await kvGet(env, 'stats');
  s.success = (s.success || 0) + n;
  await kvPut(env, 'stats', s);
}

// -------------------------------
// format helpers
function formatNumber(num = 0) {
  return Number(num).toLocaleString('id-ID');
}
function niceTime(d = new Date()) {
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} WIB`;
}
function getRandomAmount(env) {
  const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1;
  const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function formatUptime(ms) {
  const s = Math.floor(ms/1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// -------------------------------
// Telegram API helpers
async function apiPost(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('apiPost error', method, e);
    return null;
  }
}
async function telegramSend(env, chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await apiPost(env, 'sendMessage', payload);
}
async function telegramSendPhoto(env, chatId, photoUrl, caption = '', replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, photo: photoUrl, caption, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await apiPost(env, 'sendPhoto', payload);
}
async function telegramEditText(env, chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await apiPost(env, 'editMessageText', payload);
}
async function telegramEditCaption(env, chatId, messageId, caption, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, message_id: messageId, caption, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await apiPost(env, 'editMessageCaption', payload);
}
async function answerCallback(env, callbackQueryId, text = null, showAlert = false) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) { payload.text = text; payload.show_alert = showAlert; }
  return await apiPost(env, 'answerCallbackQuery', payload);
}

// -------------------------------
// Config & Ban helpers
async function loadConfig(env) {
  const cfg = await kvGet(env, 'bot_config');
  return {
    bonus: cfg.bonus || { mode: 'percent', percent: 0, ranges: [] },
    spam: cfg.spam || { limit: 12, window: 8 },
    logGroupId: cfg.logGroupId || null,
    ...cfg
  };
}
async function saveConfig(env, config) { return await kvPut(env, 'bot_config', config); }
async function getBans(env) { return await kvGet(env, 'banned_users'); }
async function addBan(env, userId, reason = 'banned') {
  const bans = await getBans(env);
  bans[userId] = { reason, timestamp: new Date().toISOString() };
  await kvPut(env, 'banned_users', bans);
}
async function removeBan(env, userId) {
  const bans = await getBans(env);
  if (bans[userId]) { delete bans[userId]; await kvPut(env, 'banned_users', bans); }
}
async function isBanned(env, userId) {
  const bans = await getBans(env);
  return !!bans[userId];
}

// sendLog (compact)
async function sendLog(env, title, items = []) {
  try {
    const cfg = await loadConfig(env);
    if (!cfg.logGroupId) return;
    let text = `${title}\n`;
    for (const it of items) text += `> ${it}\n`;
    await telegramSend(env, cfg.logGroupId, text);
  } catch (e) { console.error('sendLog error', e); }
}

// -------------------------------
// Anti-spam gentle
async function checkAntiSpam(env, userId, username) {
  try {
    const cfg = await loadConfig(env);
    const limit = (cfg.spam && cfg.spam.limit) || 12;
    const windowSec = (cfg.spam && cfg.spam.window) || 8;
    const now = Date.now();
    const arr = messageTimestamps.get(userId) || [];
    const windowMs = windowSec * 1000;
    const pruned = arr.filter(t => now - t <= windowMs);
    pruned.push(now);
    messageTimestamps.set(userId, pruned);
    if (pruned.length > limit) {
      await addBan(env, userId, 'auto-spam');
      await telegramSend(env, env.ADMIN_ID, `<b>🚫 Auto-Ban (Anti-Spam)</b>\n> User: ${username || userId}\n> Waktu: ${niceTime(new Date())}`);
      messageTimestamps.delete(userId);
      return true;
    }
    return false;
  } catch (e) { console.error('checkAntiSpam error', e); return false; }
}

// -------------------------------
// UI templates & keyboards (premium)
function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🛍 Produk", callback_data: "ui_products" }, { text: "💳 Deposit", callback_data: "ui_deposit" }],
      [{ text: "💰 Saldo Saya", callback_data: "ui_saldo" }, { text: "🔎 Cari", callback_data: "ui_search" }],
      [{ text: "📢 Bantuan", callback_data: "ui_help" }, { text: "👑 Admin", callback_data: "nexus_main" }]
    ]
  };
}
function bottomMenuRow() {
  // persistent-like bottom row for replies (rendered as a separate keyboard when possible)
  return { inline_keyboard: [[{ text: "🛍 Produk", callback_data: "ui_products" }, { text: "💳 Deposit", callback_data: "ui_deposit" }, { text: "💰 Saldo", callback_data: "ui_saldo" }, { text: "📢 Bantuan", callback_data: "ui_help" }]] };
}
function simpleBackKeyboard(target = 'ui_home') { return { inline_keyboard: [[{ text: "🏠 Menu Utama", callback_data: target }]] }; }
function categoryKeyboard(categories) {
  const rows = categories.map(c => [{ text: `${c.label} (${c.count})`, callback_data: `cat_${encodeURIComponent(c.key)}` }]);
  rows.push([{ text: "🏠 Menu Utama", callback_data: "ui_home" }]);
  return { inline_keyboard: rows };
}
function productsPageKeyboard(categoryKey, page, totalPages) {
  const kb = { inline_keyboard: [] };
  const row = [];
  if (page > 1) row.push({ text: "⬅️ Prev", callback_data: `prodpage_${encodeURIComponent(categoryKey)}_${page-1}` });
  if (page < totalPages) row.push({ text: "Next ➡️", callback_data: `prodpage_${encodeURIComponent(categoryKey)}_${page+1}` });
  if (row.length) kb.inline_keyboard.push(row);
  kb.inline_keyboard.push([{ text: "🏠 Menu Utama", callback_data: "ui_home" }]);
  return kb;
}
function productControlKeyboard(emailEnc, name, price, qty, stashQty) {
  // stashQty = available stock count
  return {
    inline_keyboard: [
      [
        { text: `➖`, callback_data: `dec_${emailEnc}` },
        { text: `${qty}`, callback_data: `qty_${emailEnc}_${qty}` },
        { text: `➕`, callback_data: `inc_${emailEnc}` }
      ],
      [{ text: `✅ Konfirmasi — Rp ${formatNumber(price * qty)}`, callback_data: `confirm_${emailEnc}_${qty}` }],
      [{ text: `🛒 Beli Semua (x${stashQty})`, callback_data: `takeall_${encodeURIComponent(name)}_${price}` }],
      [{ text: "🔙 Kembali", callback_data: "ui_products" }, { text: "🏠 Menu Utama", callback_data: "ui_home" }]
    ]
  };
}
function productDetailKeyboard(sampleEmail, name, price, stokCount) {
  const enc = encodeURIComponent(sampleEmail);
  return productControlKeyboard(enc, name, price, 1, stokCount);
}

// -------------------------------
// Helpers: categorize products
function categorizeProducts(accountsObj) {
  const categories = {};
  for (const [key, acc] of Object.entries(accountsObj)) {
    let cat = 'Lainnya';
    if (acc.name && typeof acc.name === 'string') {
      const parts = acc.name.split(' - ');
      cat = parts[0].trim() || 'Lainnya';
    }
    categories[cat] = categories[cat] || [];
    categories[cat].push({ id: key, ...acc });
  }
  const catList = Object.entries(categories).map(([k, v]) => ({ key: k, label: k, count: v.length, items: v }));
  catList.sort((a,b) => b.count - a.count);
  return catList;
}

// -------------------------------
// Home / Dashboard (auto)
async function sendHome(env, user) {
  const users = await loadDB(env, 'users');
  const accounts = await loadDB(env, 'accounts');
  const uid = user.id.toString();
  if (!users[uid]) { users[uid] = { saldo: 0 }; await saveDB(env, users, 'users'); }
  if (await isBanned(env, uid)) {
    const bans = await getBans(env);
    const reason = bans[uid]?.reason || 'Diblokir';
    return await telegramSend(env, uid, `❌ <b>Akses Ditolak</b>\n> Alasan: ${reason}`, simpleBackKeyboard());
  }

  const totalUsers = Object.keys(users).length;
  const stats = await loadStats(env);
  const successCount = stats.success || 0;
  const stok = Object.keys(accounts).length;
  const uptimeStr = formatUptime(Date.now() - START_TIME);
  const saldo = users[uid].saldo || 0;

  const msg = `
${THEME_EMOJI} <b>${BRAND}</b>

👋 Halo <b>${user.first_name || user.username || 'Pengguna'}</b>
💳 Saldo: <code>Rp ${formatNumber(saldo)}</code>
📦 Produk: <code>${stok}</code>
✅ Transaksi Sukses: <code>${successCount}</code>
⏱ Uptime: <code>${uptimeStr}</code>

Gunakan tombol di bawah untuk mulai.
`.trim();

  const kb = mainMenuKeyboard();
  if (env.BANNER_URL) {
    try { return await telegramSendPhoto(env, user.id, env.BANNER_URL, msg, kb); } catch (e) { console.error('banner send failed', e); }
  }
  return await telegramSend(env, user.id, msg, kb);
}

// -------------------------------
// Product menu / categories
async function handleProductsMenu(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) { await answerCallback(env, cb.id, '❌ Anda diblokir.', true); return; }

  const accounts = await loadDB(env, 'accounts');
  const cats = categorizeProducts(accounts);
  if (cats.length === 0) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Tidak ada produk saat ini.`, simpleBackKeyboard('ui_home'));
  }
  const rows = cats.map(c => ({ key: c.key, label: c.label, count: c.count }));
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, `<b>📂 Kategori Produk</b>\nPilih kategori untuk melihat produk.`, categoryKeyboard(rows));
}

// -------------------------------
// Category page with pagination
async function handleCategoryPage(update, env, categoryKey, page = 1) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) { await answerCallback(env, cb.id, '❌ Anda diblokir.', true); return; }

  const accounts = await loadDB(env, 'accounts');
  const cats = categorizeProducts(accounts);
  const cat = cats.find(c => c.key === categoryKey);
  if (!cat) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Kategori tidak ditemukan.`, simpleBackKeyboard('ui_products'));
  }

  const total = cat.items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(1, page), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = cat.items.slice(start, start + PAGE_SIZE);

  let text = `<b>📦 ${cat.label}</b>\nStok: <code>${total}</code>\n\n`;
  for (const it of pageItems) {
    text += `• <b>${it.name}</b>\n  Harga: <code>Rp ${formatNumber(it.price)}</code>\n  Stok: <code>1+</code>\n`;
    if (it.description) text += `  ${it.description}\n`;
    text += `\n`;
  }
  text += `Halaman <code>${page}/${totalPages}</code>`;

  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, text, productsPageKeyboard(cat.key, page, totalPages));
}

// -------------------------------
// Product detail (sample) + quantity controls
async function handleProductDetail(update, env, categoryKey, pickIndex = 0) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) { await answerCallback(env, cb.id, '❌ Anda diblokir.', true); return; }

  const accounts = await loadDB(env, 'accounts');
  const cats = categorizeProducts(accounts);
  const cat = cats.find(c => c.key === categoryKey);
  if (!cat) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, '⚠️ Kategori tidak ditemukan', simpleBackKeyboard('ui_products')); }

  const sample = cat.items[pickIndex] || cat.items[0];
  if (!sample) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, '⚠️ Produk tidak ditemukan', simpleBackKeyboard('ui_products')); }

  const stokCount = cat.count;
  const msg = `
<b>📦 ${sample.name}</b>
Harga: <code>Rp ${formatNumber(sample.price)}</code>
Stok: <code>${stokCount}</code>

${sample.description || ''}
  `.trim();

  const enc = encodeURIComponent(sample.id);
  // initialize session with qty 1
  userSessions.set(user.id, { action: 'purchase', email: sample.id, name: sample.name, price: sample.price, qty: 1 });
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, msg, productDetailKeyboard(sample.id, sample.name, sample.price, stokCount));
}

// -------------------------------
// Inc/Dec Qty handlers
async function handleIncQty(update, env, emailEnc) {
  const cb = update.callback_query;
  const user = cb.from;
  const sid = user.id;
  const session = userSessions.get(sid);
  if (!session || session.action !== 'purchase' || encodeURIComponent(session.email) !== emailEnc) {
    // session mismatch -> try to refresh product detail
    await answerCallback(env, cb.id, '⚠️ Session kadaluwarsa, buka produk lagi.', true);
    return;
  }
  // increase but not exceed stock
  const accounts = await loadDB(env, 'accounts');
  const totalStock = Object.values(accounts).filter(a => a.name === session.name && a.price === session.price).length;
  session.qty = Math.min(totalStock, (session.qty || 1) + 1);
  userSessions.set(sid, session);
  await answerCallback(env, cb.id);
  // edit message keyboard to show new qty & updated total
  return await telegramEditText(env, user.id, cb.message.message_id, cb.message.text, productControlKeyboard(emailEnc, session.name, session.price, session.qty, totalStock));
}
async function handleDecQty(update, env, emailEnc) {
  const cb = update.callback_query;
  const user = cb.from;
  const sid = user.id;
  const session = userSessions.get(sid);
  if (!session || session.action !== 'purchase' || encodeURIComponent(session.email) !== emailEnc) {
    await answerCallback(env, cb.id, '⚠️ Session kadaluwarsa, buka produk lagi.', true);
    return;
  }
  session.qty = Math.max(1, (session.qty || 1) - 1);
  userSessions.set(sid, session);
  await answerCallback(env, cb.id);
  const accounts = await loadDB(env, 'accounts');
  const totalStock = Object.values(accounts).filter(a => a.name === session.name && a.price === session.price).length;
  return await telegramEditText(env, user.id, cb.message.message_id, cb.message.text, productControlKeyboard(emailEnc, session.name, session.price, session.qty, totalStock));
}

// -------------------------------
// Confirm single purchase (qty)
async function handleConfirmPurchase(update, env, emailEnc, qtyStr) {
  const cb = update.callback_query;
  const user = cb.from;
  const uid = user.id.toString();
  const session = userSessions.get(user.id);
  if (!session || session.action !== 'purchase' || encodeURIComponent(session.email) !== emailEnc) {
    await answerCallback(env, cb.id, '⚠️ Session kadaluwarsa. Buka produk lagi.', true);
    return;
  }
  const qty = parseInt(qtyStr) || session.qty || 1;

  // load DBs
  const users = await loadDB(env, 'users');
  const accounts = await loadDB(env, 'accounts');
  if (!users[uid]) users[uid] = { saldo: 0 };
  // find matching accounts up to qty
  const filtered = Object.entries(accounts).filter(([k, acc]) => acc.name === session.name && acc.price === session.price).slice(0, qty);
  if (filtered.length < qty) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Stok tidak cukup. Tersedia: ${filtered.length}`, simpleBackKeyboard('ui_products'));
  }
  const totalPrice = session.price * qty;
  if (users[uid].saldo < totalPrice) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, `❌ Saldo tidak cukup.\n> Harga: Rp ${formatNumber(totalPrice)}\n> Saldo: Rp ${formatNumber(users[uid].saldo)}`, simpleBackKeyboard('ui_home'));
  }

  // deduct & assemble response
  users[uid].saldo -= totalPrice;
  await saveDB(env, users, 'users');

  let listText = '';
  for (const [k, acc] of filtered) {
    listText += `> Produk: ${acc.name}\n> Email: ${acc.email}\n> Password: ${acc.password}\n\n`;
    delete accounts[k];
  }
  await saveDB(env, accounts, 'accounts');

  // success message with blockquote style
  const header = `✅ <b>Pembelian Berhasil</b>\n`;
  const quoteLines = [
    `Produk: ${session.name}`,
    `Jumlah: ${qty}`,
    `Total: Rp ${formatNumber(totalPrice)}`,
    `Waktu: ${niceTime(new Date())}`
  ];
  let body = `${header}`;
  for (const l of quoteLines) body += `> ${l}\n`;
  body += `\n<b>Detail Akun:</b>\n${listText}`;

  await answerCallback(env, cb.id);
  await telegramEditText(env, user.id, cb.message.message_id, body, simpleBackKeyboard('ui_home'));

  // notify admin & log
  await telegramSend(env, env.ADMIN_ID, `<b>🔔 Pembelian Sukses</b>\n> User: ${user.username || uid} (ID: ${uid})\n> Produk: ${session.name}\n> Qty: ${qty}\n> Total: Rp ${formatNumber(totalPrice)}\n> Waktu: ${niceTime(new Date())}`);
  await sendLog(env, '📦 Pembelian', [`User: ${uid}`, `Produk: ${session.name}`, `Qty: ${qty}`, `Total: Rp ${formatNumber(totalPrice)}`]);
  await incrStatSuccess(env, qty);
  // clear session
  userSessions.delete(user.id);
}

// -------------------------------
// Take All (confirmation + execute)
async function handleTakeAllConfirm(update, env, raw) {
  const cb = update.callback_query;
  const user = cb.from;
  const lastUnd = raw.lastIndexOf('_');
  const nameEnc = raw.slice(0, lastUnd);
  const price = parseInt(raw.slice(lastUnd + 1));
  const name = decodeURIComponent(nameEnc);
  const accounts = await loadDB(env, 'accounts');
  const filtered = Object.entries(accounts).filter(([k, acc]) => acc.name === name && acc.price === price);
  const qty = filtered.length;
  if (qty === 0) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Stok kosong`, simpleBackKeyboard('ui_products')); }
  const total = price * qty;
  const text = `<b>🛒 Konfirmasi Beli Semua</b>\n> Produk: ${name}\n> Jumlah: ${qty}\n> Total: Rp ${formatNumber(total)}\n\nTekan konfirmasi untuk melanjutkan.`;
  const kb = { inline_keyboard: [[{ text: `✅ Konfirmasi (${qty}) — Rp ${formatNumber(total)}`, callback_data: `takeall_confirm_${encodeURIComponent(name)}_${price}` }], [{ text: "❌ Batal", callback_data: "ui_products" }, { text: "🏠 Menu Utama", callback_data: "ui_home" }]] };
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, text, kb);
}

async function handleTakeAllExecute(update, env, raw) {
  const cb = update.callback_query;
  const user = cb.from;
  const uid = user.id.toString();
  const lastUnd = raw.lastIndexOf('_');
  const nameEnc = raw.slice(0, lastUnd);
  const price = parseInt(raw.slice(lastUnd + 1));
  const name = decodeURIComponent(nameEnc);

  if (await isBanned(env, uid)) { await answerCallback(env, cb.id, '❌ Anda diblokir.', true); return; }
  const users = await loadDB(env, 'users');
  if (!users[uid]) users[uid] = { saldo: 0 };
  const accounts = await loadDB(env, 'accounts');
  const filtered = Object.entries(accounts).filter(([k, acc]) => acc.name === name && acc.price === price);
  const qty = filtered.length;
  if (qty === 0) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Stok kosong`, simpleBackKeyboard('ui_products')); }
  const total = price * qty;
  if (users[uid].saldo < total) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, `❌ Saldo tidak cukup\n> Total: Rp ${formatNumber(total)}\n> Saldo: Rp ${formatNumber(users[uid].saldo)}`, simpleBackKeyboard('ui_home'));
  }

  users[uid].saldo -= total;
  await saveDB(env, users, 'users');

  let listText = '';
  for (const [k, acc] of filtered) {
    listText += `> Produk: ${acc.name}\n> Email: ${acc.email}\n> Password: ${acc.password}\n\n`;
    delete accounts[k];
  }
  await saveDB(env, accounts, 'accounts');

  const header = `<b>✅ Pembelian Semua Berhasil</b>\n`;
  const quoteLines = [`Produk: ${name}`, `Jumlah: ${qty}`, `Total: Rp ${formatNumber(total)}`, `Waktu: ${niceTime(new Date())}`];
  let body = header;
  for (const l of quoteLines) body += `> ${l}\n`;
  body += `\n<b>Detail Akun:</b>\n${listText}`;

  await answerCallback(env, cb.id);
  await telegramEditText(env, user.id, cb.message.message_id, body, simpleBackKeyboard('ui_home'));

  await telegramSend(env, env.ADMIN_ID, `<b>🔔 Pembelian TakeAll</b>\n> User: ${user.username || uid} (ID: ${uid})\n> Produk: ${name}\n> Qty: ${qty}\n> Total: Rp ${formatNumber(total)}\n> Waktu: ${niceTime(new Date())}`);
  await sendLog(env, '📦 TakeAll', [`User: ${uid}`, `Produk: ${name}`, `Qty: ${qty}`, `Total: Rp ${formatNumber(total)}`]);
  await incrStatSuccess(env, qty);
}

// -------------------------------
// Single buy wrapper (callback 'beli_{email}')
async function handleBuySingleCallback(update, env, emailEnc) {
  // When user clicks direct 'beli_email' from grouped list, open detail and allow qty +/- flow
  const cb = update.callback_query;
  const user = cb.from;
  const email = decodeURIComponent(emailEnc);
  const accounts = await loadDB(env, 'accounts');
  const acc = accounts[email];
  if (!acc) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, '⚠️ Produk tidak tersedia', simpleBackKeyboard('ui_products')); }
  // set session
  userSessions.set(user.id, { action: 'purchase', email, name: acc.name, price: acc.price, qty: 1 });
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, `<b>📦 ${acc.name}</b>\nHarga: <code>Rp ${formatNumber(acc.price)}</code>\nStok: <code>1+</code>`, productDetailKeyboard(email, acc.name, acc.price, Object.values(accounts).filter(a => a.name === acc.name && a.price === acc.price).length));
}

// -------------------------------
// Deposit flows (pretty + QRIS blockquote captions)
async function handleDepositStart(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) { await answerCallback(env, cb.id, '❌ Anda diblokir.', true); return; }
  const p = await getPendingPayment(env, user.id);
  if (p) { await answerCallback(env, cb.id); return await telegramEditText(env, user.id, cb.message.message_id, `⚠️ Kamu masih punya pembayaran pending.\n> ID: ${p.transactionId}\n> Total: Rp ${formatNumber(p.finalNominal)}`, simpleBackKeyboard('ui_home')); }

  const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, `<b>💳 Deposit Saldo</b>\nMinimal: <code>Rp ${formatNumber(minAmount)}</code>\nKetik jumlah (mis: 20000) atau pilih Quick:`, {
    inline_keyboard: [
      [{ text: "Rp 20.000", callback_data: "quickdep_20000" }, { text: "Rp 50.000", callback_data: "quickdep_50000" }],
      [{ text: "Rp 100.000", callback_data: "quickdep_100000" }],
      [{ text: "🏠 Menu Utama", callback_data: "ui_home" }]
    ]
  });
}
async function handleQuickDeposit(update, env, amount) {
  const cb = update.callback_query;
  const user = cb.from;
  const nominal = parseInt(amount);
  await answerCallback(env, cb.id);
  return await createQrisAndConfirm(env, user, nominal);
}

async function createQrisAndConfirm(env, user, nominal) {
  const randomFee = getRandomAmount(env);
  const finalTotal = nominal + randomFee;
  try {
    const response = await fetch(`${env.API_CREATE_URL}?amount=${finalTotal}&qrisCode=${env.QRIS_CODE}`);
    const data = await response.json();
    if (!data || data.status !== 'success') {
      return await telegramSend(env, user.id, '❌ Gagal membuat QRIS. Coba lagi.', simpleBackKeyboard('ui_home'));
    }
    const qrisUrl = data.data.download_url;
    const transId = data.data['kode transaksi'] || (`TX${Date.now()}`);
    const paymentData = { nominal, finalNominal: finalTotal, transactionId: transId, timestamp: new Date(), status: 'pending', messageId: null };
    await savePendingPayment(env, user.id, paymentData);

    // caption with blockquote style
    const captionHeader = `💳 <b>Pembayaran Pending</b>\n`;
    const quoteLines = [
      `ID: ${transId}`,
      `Nominal: Rp ${formatNumber(nominal)}`,
      `Fee Random: Rp ${formatNumber(randomFee)}`,
      `Total Bayar: Rp ${formatNumber(finalTotal)}`,
      `Expired: 10 menit`
    ];
    let caption = captionHeader;
    for (const l of quoteLines) caption += `> ${l}\n`;
    caption += `\nScan QRIS di atas lalu tekan konfirmasi.`;

    const keyboard = { inline_keyboard: [[{ text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transId}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }], [{ text: "🏠 Menu Utama", callback_data: "ui_home" }]] };
    const sent = await telegramSendPhoto(env, user.id, qrisUrl, caption, keyboard);
    if (sent && sent.ok) { paymentData.messageId = sent.result.message_id; await savePendingPayment(env, user.id, paymentData); }

    // admin notify/log using blockquote style
    const adminMsg = `<b>⏳ Pembayaran Pending</b>\n> User: ${user.username ? `@${user.username}` : (user.first_name || user.id)}\n> ID: ${transId}\n> Total: Rp ${formatNumber(finalTotal)}`;
    await telegramSend(env, env.ADMIN_ID, adminMsg);
    await sendLog(env, '⏳ Pending', [`User: ${user.id}`, `ID: ${transId}`, `Total: Rp ${formatNumber(finalTotal)}`]);
  } catch (e) {
    console.error('createQrisAndConfirm', e);
    await telegramSend(env, user.id, '❌ Terjadi kesalahan membuat QRIS.', simpleBackKeyboard('ui_home'));
  }
}

async function handleConfirmPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  const p = await getPendingPayment(env, user.id);
  if (!p) { await answerCallback(env, cb.id, '❌ Tidak ada pembayaran pending.', true); return; }
  const transId = cb.data.split('_')[2];
  if (p.transactionId !== transId) { await answerCallback(env, cb.id, '❌ ID tidak cocok.', true); return; }

  // expire check
  const now = new Date();
  if ((now - new Date(p.timestamp)) / (1000*60) > 10) {
    await removePendingPayment(env, user.id);
    if (p.messageId) await telegramEditCaption(env, user.id, p.messageId, `❌ <b>Pembayaran Expired</b>\n> ID: ${transId}`);
    await answerCallback(env, cb.id, '❌ Pembayaran expired.', true);
    return;
  }

  try {
    const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
    const data = await response.json();
    if (!data || data.status !== 'success') { await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi.', true); return; }
    const payments = data.data || [];
    let found = false;
    for (const pay of payments) { if (pay && pay.amount === p.finalNominal) { found = true; break; } }
    if (!found) { await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi.', true); return; }

    const users = await loadDB(env, 'users');
    const uid = user.id.toString();
    if (!users[uid]) users[uid] = { saldo: 0 };
    const cfg = await loadConfig(env);
    let bonus = 0;
    if (cfg.bonus) {
      if (cfg.bonus.mode === 'percent' && cfg.bonus.percent) bonus = Math.floor(p.nominal * (cfg.bonus.percent / 100));
      else if (cfg.bonus.mode === 'range' && Array.isArray(cfg.bonus.ranges)) {
        for (const r of cfg.bonus.ranges) { if (p.nominal >= r.min && p.nominal <= r.max) { bonus = r.bonus; break; } }
      }
    }
    users[uid].saldo += p.nominal + bonus;
    await saveDB(env, users, 'users');
    await removePendingPayment(env, user.id);

    // caption success blockquote
    const header = `✅ <b>Pembayaran Dikonfirmasi</b>\n`;
    const quoteLines = [
      `ID: ${p.transactionId}`,
      `Nominal: Rp ${formatNumber(p.nominal)}`,
      `Bonus: Rp ${formatNumber(bonus)}`,
      `Saldo Sekarang: Rp ${formatNumber(users[uid].saldo)}`
    ];
    let body = header;
    for (const l of quoteLines) body += `> ${l}\n`;

    if (p.messageId) {
      await telegramEditCaption(env, user.id, p.messageId, body);
    } else {
      await telegramSend(env, user.id, body, simpleBackKeyboard('ui_home'));
    }

    // admin & log
    const adminMsg = `<b>✅ Pembayaran Dikonfirmasi</b>\n> User: ${user.username ? `@${user.username}` : (user.first_name || user.id)}\n> ID: ${p.transactionId}\n> Nominal: Rp ${formatNumber(p.nominal)}\n> Bonus: Rp ${formatNumber(bonus)}`;
    await telegramSend(env, env.ADMIN_ID, adminMsg);
    await sendLog(env, '📥 Deposit', [`User: ${uid}`, `Nominal: Rp ${formatNumber(p.nominal)}`, `Bonus: Rp ${formatNumber(bonus)}`]);
    await incrStatSuccess(env, 1);
    await answerCallback(env, cb.id, '✅ Pembayaran dikonfirmasi.', true);
  } catch (e) {
    console.error('handleConfirmPayment', e);
    await answerCallback(env, cb.id, '❌ Terjadi kesalahan saat cek pembayaran.', true);
  }
}

async function handleCancelPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  const p = await getPendingPayment(env, user.id);
  if (!p) { await answerCallback(env, cb.id, '❌ Tidak ada pending.', true); return; }
  await removePendingPayment(env, user.id);
  if (p.messageId) await telegramEditCaption(env, user.id, p.messageId, `❌ <b>Pembayaran Dibatalkan</b>\n> ID: ${p.transactionId}`);
  await telegramSend(env, env.ADMIN_ID, `<b>❌ Pembayaran Dibatalkan</b>\n> User: ${user.username || user.id}\n> ID: ${p.transactionId}`);
  await sendLog(env, '❌ Pembayaran Dibatalkan', [`User: ${user.id}`, `ID: ${p.transactionId}`]);
  await answerCallback(env, cb.id, '✅ Pembayaran dibatalkan.', true);
}

// -------------------------------
// Cleanup expired pending payments
async function cleanupExpiredPayments(env) {
  try {
    const pending = await loadPendingPayments(env);
    const now = new Date();
    for (const [uid, p] of Object.entries(pending)) {
      const paymentTime = new Date(p.timestamp);
      if ((now - paymentTime) / (1000*60) > 10) {
        if (p.messageId) {
          try { await telegramEditCaption(env, parseInt(uid), p.messageId, `❌ <b>Pembayaran Expired</b>\n> ID: ${p.transactionId}`); } catch(e){}
        }
        await removePendingPayment(env, uid);
        await telegramSend(env, env.ADMIN_ID, `<b>⏰ Pending Expired</b>\n> User: ${uid}\n> ID: ${p.transactionId}`);
        await sendLog(env, '⏰ Pending Expired', [`User: ${uid}`, `ID: ${p.transactionId}`]);
      }
    }
  } catch (e) { console.error('cleanupExpiredPayments', e); }
}

// -------------------------------
// Admin handlers (full)
async function handleNexusCommand(update, env) {
  const user = update.message.from;
  if (user.id.toString() !== env.ADMIN_ID) return await telegramSend(env, user.id, '❌ Akses ditolak.');
  const users = await loadDB(env, 'users');
  const total = Object.keys(users).length;
  const msg = `<b>👑 NEXUS Admin</b>\nMembers: <code>${total}</code>\nPilih menu:`;
  const kb = {
    inline_keyboard: [
      [{ text: "🚫 Ban", callback_data: "nexus_user_ban" }, { text: "✅ Unban", callback_data: "nexus_user_unban" }],
      [{ text: "➕ Tambah Saldo", callback_data: "nexus_saldo_add" }, { text: "➖ Kurangi Saldo", callback_data: "nexus_saldo_sub" }],
      [{ text: "📦 Stok", callback_data: "nexus_stok" }, { text: "🧾 Transaksi", callback_data: "nexus_transaksi" }],
      [{ text: "🔧 Konfigurasi", callback_data: "nexus_config" }, { text: "🏠 Menu Utama", callback_data: "ui_home" }]
    ]
  };
  return await telegramSend(env, user.id, msg, kb);
}
async function handleNexusCallback(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (user.id.toString() !== env.ADMIN_ID) { await answerCallback(env, cb.id, '❌ Akses ditolak', true); return; }
  const data = cb.data;
  await answerCallback(env, cb.id);
  // Basic admin UI actions (expandable)
  if (data === 'nexus_user_ban') {
    userSessions.set(user.id, { action: 'ban_user' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🚫 Ban User</b>\nKirim ID dan alasan (opsional)\nContoh: <code>123456 alasan</code>`, simpleBackKeyboard('nexus_main'));
  }
  if (data === 'nexus_user_unban') {
    userSessions.set(user.id, { action: 'unban_user' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>✅ Unban User</b>\nKirim ID user:`, simpleBackKeyboard('nexus_main'));
  }
  if (data === 'nexus_saldo_add') {
    userSessions.set(user.id, { action: 'tambah_saldo' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>➕ Tambah Saldo</b>\nKirim: <code>id jumlah</code>\nContoh: <code>12345 20000</code>`, simpleBackKeyboard('nexus_main'));
  }
  if (data === 'nexus_saldo_sub') {
    userSessions.set(user.id, { action: 'kurangi_saldo' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>➖ Kurangi Saldo</b>\nKirim: <code>id jumlah</code>`, simpleBackKeyboard('nexus_main'));
  }
  if (data === '
