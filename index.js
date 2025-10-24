 import { Router } from 'itty-router';

const router = Router();

// -----------------------------
// In-memory / Constants
// -----------------------------
const userSessions = new Map();
const messageTimestamps = new Map(); // anti-spam timestamps
const START_TIME = Date.now();

// -----------------------------
// KV helpers (Cloudflare Worker KV)
// -----------------------------
async function kvGet(env, key) {
  try {
    const raw = await env.BOT_DB.get(key, { type: 'json' });
    return raw || {};
  } catch (e) {
    console.error('KV get error', key, e);
    return {};
  }
}
async function kvPut(env, key, value) {
  try {
    await env.BOT_DB.put(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('KV put error', key, e);
    return false;
  }
}

// Backwards-compatible loaders used in original file
async function loadDB(binding, dbType) {
  return await kvGet({ BOT_DB: binding }, dbType);
}
async function saveDB(binding, data, dbType) {
  return await kvPut({ BOT_DB: binding }, dbType);
}

// pending payments (original structure)
async function loadPendingPayments(binding) {
  return await kvGet({ BOT_DB: binding }, 'pending_payments');
}
async function savePendingPayment(binding, userId, paymentData) {
  try {
    const pending = await loadPendingPayments(binding);
    pending[userId] = {
      ...paymentData,
      timestamp: paymentData.timestamp instanceof Date ? paymentData.timestamp.toISOString() : paymentData.timestamp
    };
    await kvPut({ BOT_DB: binding }, 'pending_payments', pending);
    return true;
  } catch (e) {
    console.error('savePendingPayment', e);
    return false;
  }
}
async function removePendingPayment(binding, userId) {
  try {
    const pending = await loadPendingPayments(binding);
    if (pending[userId]) {
      delete pending[userId];
      await kvPut({ BOT_DB: binding }, 'pending_payments', pending);
    }
    return true;
  } catch (e) {
    console.error('removePendingPayment', e);
    return false;
  }
}
async function getPendingPayment(binding, userId) {
  try {
    const pending = await loadPendingPayments(binding);
    const p = pending[userId];
    if (!p) return null;
    return { ...p, timestamp: new Date(p.timestamp) };
  } catch (e) {
    console.error('getPendingPayment', e);
    return null;
  }
}

// -----------------------------
// Format helpers
// -----------------------------
function formatNumber(num = 0) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function niceTime(d = new Date()) {
  // return e.g. 24 Okt 2025, 13:20 WIB
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

// -----------------------------
// Telegram API helpers
// -----------------------------
async function telegramSend(botToken, chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('telegramSend error', e);
    return null;
  }
}
async function telegramSendPhoto(botToken, chatId, photoUrl, caption = '', replyMarkup = null, parseMode='HTML') {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const payload = { chat_id: chatId, photo: photoUrl, caption, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('telegramSendPhoto error', e);
    return null;
  }
}
async function telegramEditText(botToken, chatId, messageId, text, replyMarkup = null, parseMode='HTML') {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('telegramEditText error', e);
    return null;
  }
}
async function telegramEditCaption(botToken, chatId, messageId, caption, replyMarkup=null, parseMode='HTML') {
  const url = `https://api.telegram.org/bot${botToken}/editMessageCaption`;
  const payload = { chat_id: chatId, message_id: messageId, caption, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('telegramEditCaption error', e);
    return null;
  }
}
async function answerCallback(botToken, callbackQueryId, text=null, showAlert=false) {
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  const payload = { callback_query_id: callbackQueryId };
  if (text) { payload.text = text; payload.show_alert = showAlert; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    console.error('answerCallback error', e);
    return null;
  }
}

// -----------------------------
// Config & Ban helpers
// -----------------------------
async function loadConfig(env) {
  const cfg = await kvGet(env, 'bot_config');
  return {
    bonus: cfg.bonus || { mode: 'percent', percent: 0, ranges: [] },
    spam: cfg.spam || { limit: 10, window: 10 },
    logGroupId: cfg.logGroupId || null,
    ...cfg
  };
}
async function saveConfig(env, config) {
  return await kvPut(env, 'bot_config', config);
}
async function getBans(env) {
  return await kvGet(env, 'banned_users');
}
async function addBan(env, userId, reason='banned') {
  const bans = await getBans(env);
  bans[userId] = { reason, timestamp: new Date().toISOString() };
  await kvPut(env, 'banned_users', bans);
}
async function removeBan(env, userId) {
  const bans = await getBans(env);
  if (bans[userId]) {
    delete bans[userId];
    await kvPut(env, 'banned_users', bans);
  }
}
async function isBanned(env, userId) {
  const bans = await getBans(env);
  return !!bans[userId];
}

// Send to log group in quoted style if set
async function sendLog(env, title, items = []) {
  try {
    const cfg = await loadConfig(env.BOT_DB);
    const gid = cfg.logGroupId;
    if (!gid) return;
    // build quote style message
    // title line + each item prefixed with > for quote
    // Example:
    // 📦 Transaksi Sukses
    // > 👤 User: @username (ID: 123)
    // > 💳 Jenis: Deposit
    // ...
    let text = `${title}\n`;
    for (const it of items) {
      text += `> ${it}\n`;
    }
    // add small tags line
    await telegramSend(env.BOT_TOKEN, gid, text);
  } catch (e) {
    console.error('sendLog error', e);
  }
}

// -----------------------------
// Anti-spam: track messages and auto-ban
// -----------------------------
async function checkAntiSpam(env, userId, username) {
  try {
    const cfg = await loadConfig(env.BOT_DB);
    const limit = (cfg.spam && cfg.spam.limit) || 10;
    const windowSec = (cfg.spam && cfg.spam.window) || 10;
    const now = Date.now();
    const arr = messageTimestamps.get(userId) || [];
    const windowMs = windowSec * 1000;
    const pruned = arr.filter(t => now - t <= windowMs);
    pruned.push(now);
    messageTimestamps.set(userId, pruned);
    if (pruned.length > limit) {
      // auto ban
      await addBan(env, userId, 'auto-spam');
      // notify admin
      await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>🚫 Auto-Ban (Anti-Spam)</b>\nUser: @${username || 'N/A'} (${userId})\nCount: ${pruned.length} msgs in ${windowSec}s`);
      await sendLog(env, '🚫 Auto-Ban (Anti-Spam)', [
        `👤 User: @${username || 'N/A'} (ID: ${userId})`,
        `🧠 Alasan: Spam terlalu banyak dalam ${windowSec} detik`,
        `⏰ Waktu: ${niceTime(new Date())}`
      ]);
      messageTimestamps.delete(userId);
      return true;
    }
    return false;
  } catch (e) {
    console.error('checkAntiSpam error', e);
    return false;
  }
}

// -----------------------------
// Bot message templates (modern & simple)
// -----------------------------
function adminMenuTemplate(totalUsers = 0) {
  return `
👑 <b>NEXUS — Admin Console</b>
━━━━━━━━━━━━━━━━━━
👥 Members: <code>${totalUsers}</code>

Pilih tindakan di bawah (sentuh tombol):
`;
}
function prettyUserHeader(user) {
  return `👋 <b>Halo, ${user.username ? '@' + user.username : 'User'}</b>\nID: <code>${user.id}</code>\n━━━━━━━━━━━━━━━━━━\n`;
}

// -----------------------------
// Existing user flows (start, id, buy, deposit) adapted and preserved
// -----------------------------
async function handleStart(update, env) {
  const user = update.message.from;
  const uid = user.id.toString();
  if (await isBanned(env, uid)) {
    const bans = await getBans(env);
    const reason = bans[uid]?.reason || 'Anda diblokir.';
    return await telegramSend(env.BOT_TOKEN, user.id, `❌ <b>Akses Ditolak</b>\n\nAnda telah diblokir.\nAlasan: ${reason}`);
  }

  const users = await loadDB(env.BOT_DB, 'users');
  const accounts = await loadDB(env.BOT_DB, 'accounts');

  if (!users[uid]) {
    users[uid] = { saldo: 0 };
    await saveDB(env.BOT_DB, users, 'users');
  }

  const saldo = users[uid].saldo || 0;
  const stok = Object.keys(accounts).length;
  const msg = `
${prettyUserHeader(user)}
💰 <b>Saldo:</b> <code>Rp ${formatNumber(saldo)}</code>
📦 <b>Stok Akun:</b> <code>${stok}</code>

Gunakan menu di bawah untuk membeli atau deposit.
`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
      [{ text: "💳 Deposit Saldo", callback_data: "deposit" }]
    ]
  };

  return await telegramSend(env.BOT_TOKEN, user.id, msg, keyboard);
}

async function handleGetId(update, env) {
  const u = update.message.from;
  const msg = `
🆔 <b>Informasi Akun</b>
👤 Username: ${u.username ? `<code>@${u.username}</code>` : '<i>(tidak tersedia)</i>'}
📄 User ID: <code>${u.id}</code>
`;
  return await telegramSend(env.BOT_TOKEN, u.id, msg);
}

// BUY FLOW (kept behavior)
async function handleBeliAkunCallback(update, env) {
  const callbackQuery = update.callback_query;
  const user = callbackQuery.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id, '❌ Anda diblokir.', true);
    return;
  }
  const accounts = await loadDB(env.BOT_DB, 'accounts');
  if (Object.keys(accounts).length === 0) {
    const msg = `⚠️ <b>Maaf, saat ini item tidak tersedia.</b>`;
    return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg);
  }
  const grouped = {};
  for (const [email, acc] of Object.entries(accounts)) {
    const key = `${acc.name}_${acc.price}`;
    (grouped[key] = grouped[key] || []).push(email);
  }
  const buttons = Object.entries(grouped).map(([key, emails]) => {
    const [name, price] = key.split('_');
    const count = emails.length;
    return [{ text: `${name} - Rp ${formatNumber(parseInt(price))} (x${count})`, callback_data: `group_${name}_${price}` }];
  });
  buttons.push([{ text: "🔙 Kembali", callback_data: "back_to_main" }]);
  const msg = `<b>🛒 Pilih Produk</b>\nTotal stok: <code>${Object.keys(accounts).length}</code>`;
  await answerCallback(env.BOT_TOKEN, callbackQuery.id);
  return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg, { inline_keyboard: buttons });
}

async function handleDetailAkun(update, env) {
  const callbackQuery = update.callback_query;
  const user = callbackQuery.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id, '❌ Anda diblokir.', true);
    return;
  }
  const accounts = await loadDB(env.BOT_DB, 'accounts');
  const [, name, price] = callbackQuery.data.split('_');
  const priceInt = parseInt(price);
  const filtered = Object.entries(accounts).filter(([email, acc]) => acc.name === name && acc.price === priceInt);
  if (filtered.length === 0) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id);
    return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, '❌ <b>Akun tidak tersedia</b>');
  }
  const [email, acc] = filtered[Math.floor(Math.random() * filtered.length)];
  const msg = `
<b>Detail Produk</b>
<b>Nama:</b> <code>${acc.name}</code>
<b>Harga:</b> <code>Rp ${formatNumber(acc.price)}</code>
<b>Deskripsi:</b>
${acc.description || 'Tidak ada deskripsi'}
`;
  const keyboard = { inline_keyboard: [[{ text: "✅ Beli", callback_data: `beli_${email}` }, { text: "❌ Batal", callback_data: "beli_akun" }]] };
  await answerCallback(env.BOT_TOKEN, callbackQuery.id);
  return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg, keyboard);
}

async function handleProsesPembelian(update, env) {
  const callbackQuery = update.callback_query;
  const user = callbackQuery.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id, '❌ Anda diblokir.', true);
    return;
  }
  const uid = user.id.toString();
  const users = await loadDB(env.BOT_DB, 'users');
  const accounts = await loadDB(env.BOT_DB, 'accounts');
  const email = callbackQuery.data.split('_')[1];
  if (!accounts[email]) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id);
    return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, '<b>⚠️ Akun tidak tersedia.</b>');
  }
  const acc = accounts[email];
  const price = acc.price;
  if (!users[uid]) users[uid] = { saldo: 0 };
  if (users[uid].saldo < price) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id);
    return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, '<b>💰 Saldo tidak cukup. Silakan deposit.</b>');
  }
  users[uid].saldo -= price;
  await saveDB(env.BOT_DB, users, 'users');
  delete accounts[email];
  await saveDB(env.BOT_DB, accounts, 'accounts');
  const msg = `
✅ <b>Pembelian Berhasil</b>
<b>Produk:</b> <code>${acc.name}</code>
<b>Email:</b> <code>${acc.email}</code>
<b>Password:</b> <code>${acc.password}</code>
<b>Total Bayar:</b> <code>Rp ${formatNumber(price)}</code>
`;
  await answerCallback(env.BOT_TOKEN, callbackQuery.id);
  await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg);

  // notify admin and log group (quoted)
  await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>🔔 Pembelian Sukses</b>\n> 👤 User: @${user.username || 'N/A'} (ID: ${uid})\n> 🛒 Produk: ${acc.name}\n> 💰 Harga: Rp ${formatNumber(price)}\n> 🕒 ${niceTime(new Date())}`);
  await sendLog(env, '📦 Transaksi Sukses', [
    `👤 User: @${user.username || 'N/A'} (ID: ${uid})`,
    `Jenis: Pembelian`,
    `Produk: ${acc.name}`,
    `Harga: Rp ${formatNumber(price)}`,
    `Waktu: ${niceTime(new Date())}`
  ]);
}

// -----------------------------
// Deposit flow (preserve original logic + bonus calculation)
// -----------------------------
async function handleDepositCallback(update, env) {
  const callbackQuery = update.callback_query;
  const user = callbackQuery.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id, '❌ Anda diblokir dan tidak dapat deposit.', true);
    return;
  }
  const pending = await getPendingPayment(env.BOT_DB, user.id);
  if (pending) {
    await answerCallback(env.BOT_TOKEN, callbackQuery.id, '⚠️ Anda masih punya deposit pending.', true);
    return;
  }
  await answerCallback(env.BOT_TOKEN, callbackQuery.id);
  const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
  const msg = `<b>Masukkan nominal deposit</b>\n💰 Minimal: <code>Rp ${formatNumber(minAmount)}</code>\nKetik jumlah:`;
  return await telegramEditText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg);
}

async function handleDepositMessage(update, env) {
  const message = update.message;
  const user = message.from;
  if (await isBanned(env, user.id.toString())) {
    await telegramSend(env.BOT_TOKEN, user.id, '❌ Anda diblokir dan tidak dapat deposit.');
    return;
  }
  const pending = await getPendingPayment(env.BOT_DB, user.id);
  if (pending) {
    await telegramSend(env.BOT_TOKEN, user.id, '⚠️ Anda masih memiliki deposit yang belum selesai.');
    return;
  }
  try {
    const nominal = parseInt(message.text.replace(/\D/g, ''));
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    if (isNaN(nominal) || nominal < minAmount) {
      return await telegramSend(env.BOT_TOKEN, user.id, `⚠️ Nominal minimal Rp ${formatNumber(minAmount)}.`);
    }
    await createQrisAndConfirm(env, user, nominal);
  } catch (e) {
    await telegramSend(env.BOT_TOKEN, user.id, '⚠️ Nominal tidak valid.');
  }
}

async function createQrisAndConfirm(env, user, nominal) {
  const randomFee = getRandomAmount(env);
  const finalTotal = nominal + randomFee;
  try {
    const response = await fetch(`${env.API_CREATE_URL}?amount=${finalTotal}&qrisCode=${env.QRIS_CODE}`);
    const data = await response.json();
    if (!data || data.status !== 'success') {
      return await telegramSend(env.BOT_TOKEN, user.id, '❌ Gagal membuat QRIS. Coba lagi.');
    }
    const qrisUrl = data.data.download_url;
    const transId = data.data['kode transaksi'] || (`TX${Date.now()}`);
    const paymentData = {
      nominal,
      finalNominal: finalTotal,
      transactionId: transId,
      timestamp: new Date(),
      status: 'pending',
      messageId: null
    };
    await savePendingPayment(env.BOT_DB, user.id, paymentData);
    const caption = `
<b>🔖 Top Up Pending</b>

🆔 ID Transaksi: <code>${transId}</code>
💰 Nominal: <code>Rp ${formatNumber(nominal)}</code>
📊 Fee Random: <code>Rp ${formatNumber(randomFee)}</code>
💳 Total Bayar: <code>Rp ${formatNumber(finalTotal)}</code>
⏰ Expired: <code>10 minutes</code>

Scan QRIS & konfirmasi setelah bayar.
`;
    const keyboard = { inline_keyboard: [[{ text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transId}` }, { text: "❌ Batalkan Pembayaran", callback_data: "cancel_payment" }]] };
    const sent = await telegramSendPhoto(env.BOT_TOKEN, user.id, qrisUrl, caption, keyboard);
    if (sent && sent.ok) {
      paymentData.messageId = sent.result.message_id;
      await savePendingPayment(env.BOT_DB, user.id, paymentData);
    }
    // notify admin & log
    await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>🔔 Pembayaran Pending</b>\n> 👤 User: @${user.username || 'N/A'} (ID: ${user.id})\n> ID Trans: ${transId}\n> Total: Rp ${formatNumber(finalTotal)}`);
    await sendLog(env, '⏳ Pending Payment', [
      `👤 User: @${user.username || 'N/A'} (ID: ${user.id})`,
      `ID Trans: ${transId}`,
      `Total Bayar: Rp ${formatNumber(finalTotal)}`,
      `Waktu: ${niceTime(new Date())}`
    ]);
  } catch (e) {
    console.error('createQrisAndConfirm error', e);
    await telegramSend(env.BOT_TOKEN, user.id, '❌ Terjadi kesalahan membuat QRIS.');
  }
}

async function handleConfirmPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ Anda diblokir.', true);
    return;
  }
  const p = await getPendingPayment(env.BOT_DB, user.id);
  if (!p) {
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ Tidak ada pembayaran pending.', true);
    return;
  }
  const transId = cb.data.split('_')[2];
  if (p.transactionId !== transId) {
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ ID transaksi tidak cocok.', true);
    return;
  }
  // check expiration
  const now = new Date();
  const diffMinutes = (now - new Date(p.timestamp)) / (1000*60);
  if (diffMinutes > 10) {
    await removePendingPayment(env.BOT_DB, user.id);
    if (p.messageId) await telegramEditCaption(env.BOT_TOKEN, user.id, p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${transId}</code>`);
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ Pembayaran expired.', true);
    return;
  }
  // verify via API
  try {
    const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
    if (!response.ok) {
      await answerCallback(env.BOT_TOKEN, cb.id, '❌ Gagal cek pembayaran.', true);
      return;
    }
    const data = await response.json();
    if (data.status !== 'success') {
      await answerCallback(env.BOT_TOKEN, cb.id, '⚠️ Pembayaran belum terdeteksi.', true);
      return;
    }
    const payments = data.data || [];
    let found = false;
    for (const pay of payments) {
      if (pay && pay.amount === p.finalNominal) { found = true; break; }
    }
    if (!found) {
      await answerCallback(env.BOT_TOKEN, cb.id, '⚠️ Pembayaran belum terdeteksi.', true);
      return;
    }
    // apply bonus
    const users = await loadDB(env.BOT_DB, 'users');
    const uid = user.id.toString();
    if (!users[uid]) users[uid] = { saldo: 0 };
    const cfg = await loadConfig(env.BOT_DB);
    let bonus = 0;
    if (cfg.bonus) {
      if (cfg.bonus.mode === 'percent' && cfg.bonus.percent) {
        bonus = Math.floor(p.nominal * (cfg.bonus.percent / 100));
      } else if (cfg.bonus.mode === 'range' && Array.isArray(cfg.bonus.ranges)) {
        for (const r of cfg.bonus.ranges) {
          if (p.nominal >= r.min && p.nominal <= r.max) {
            bonus = r.bonus;
            break;
          }
        }
      }
    }
    users[uid].saldo += p.nominal + bonus;
    await saveDB(env.BOT_DB, users, 'users');
    await removePendingPayment(env.BOT_DB, user.id);
    if (p.messageId) {
      await telegramEditCaption(env.BOT_TOKEN, user.id, p.messageId, `
✅ <b>Pembayaran Dikonfirmasi</b>
🆔 ID: <code>${p.transactionId}</code>
💰 Nominal: <code>Rp ${formatNumber(p.nominal)}</code>
🎁 Bonus: <code>Rp ${formatNumber(bonus)}</code>
💳 Saldo Sekarang: <code>Rp ${formatNumber(users[uid].saldo)}</code>
`);
    }
    await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>✅ Pembayaran Dikonfirmasi</b>\n> 👤 User: @${user.username||'N/A'} (ID: ${uid})\n> ID: ${p.transactionId}\n> Nominal: Rp ${formatNumber(p.nominal)}\n> Bonus: Rp ${formatNumber(bonus)}`);
    await sendLog(env, '📥 Deposit Sukses', [
      `👤 User: @${user.username || 'N/A'} (ID: ${uid})`,
      `Jenis: Deposit`,
      `Nominal: Rp ${formatNumber(p.nominal)}`,
      `Bonus: Rp ${formatNumber(bonus)}`,
      `Waktu: ${niceTime(new Date())}`
    ]);
    await answerCallback(env.BOT_TOKEN, cb.id, '✅ Pembayaran dikonfirmasi.', true);
  } catch (e) {
    console.error('handleConfirmPayment error', e);
    await answerCallback(env.BOT_TOKEN, cb.id, `❌ Terjadi kesalahan: ${e.message}`, true);
  }
}

async function handleCancelPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  const p = await getPendingPayment(env.BOT_DB, user.id);
  if (!p) {
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ Tidak ada pembayaran pending.', true);
    return;
  }
  await removePendingPayment(env.BOT_DB, user.id);
  if (p.messageId) {
    await telegramEditCaption(env.BOT_TOKEN, user.id, p.messageId, `❌ <b>Pembayaran Dibatalkan</b>\nID: <code>${p.transactionId}</code>`);
  }
  await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>❌ Pembayaran Dibatalkan</b>\n> 👤 User: @${user.username || 'N/A'} (ID: ${user.id})\n> ID: ${p.transactionId}`);
  await sendLog(env, '❌ Pembayaran Dibatalkan', [
    `👤 User: @${user.username || 'N/A'} (ID: ${user.id})`,
    `ID Trans: ${p.transactionId}`,
    `Waktu: ${niceTime(new Date())}`
  ]);
  await answerCallback(env.BOT_TOKEN, cb.id, '❌ Pembayaran dibatalkan.', true);
}

// -----------------------------
// Admin UI: /nexus main menu & submenus (inline keyboard driven)
// -----------------------------
function nexusMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "👥 Kontrol User", callback_data: "nexus_user" }, { text: "💰 Saldo", callback_data: "nexus_saldo" }],
      [{ text: "📦 Stok", callback_data: "nexus_stok" }, { text: "🧾 Transaksi", callback_data: "nexus_transaksi" }],
      [{ text: "🎁 Bonus Deposit", callback_data: "nexus_bonus" }, { text: "🚫 Anti-Spam", callback_data: "nexus_spam" }],
      [{ text: "📢 Broadcast", callback_data: "nexus_broadcast" }, { text: "🔧 Konfigurasi", callback_data: "nexus_config" }],
      [{ text: "📊 Pending Payments", callback_data: "nexus_pending" }, { text: "⏱️ Uptime", callback_data: "nexus_uptime" }]
    ]
  };
}
function backButton(data='nexus_main') { return { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: data }]] }; }

async function handleNexusCommand(update, env) {
  const user = update.message.from;
  if (user.id.toString() !== env.ADMIN_ID) {
    return await telegramSend(env.BOT_TOKEN, user.id, '❌ Akses ditolak. Hanya admin.');
  }
  const users = await loadDB(env.BOT_DB, 'users');
  const total = Object.keys(users).length;
  return await telegramSend(env.BOT_TOKEN, user.id, adminMenuTemplate(total), nexusMainKeyboard());
}

// Admin callback actions for nexus
async function handleNexusCallback(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (user.id.toString() !== env.ADMIN_ID) {
    await answerCallback(env.BOT_TOKEN, cb.id, '❌ Akses ditolak', true);
    return;
  }
  const data = cb.data;
  await answerCallback(env.BOT_TOKEN, cb.id);
  // main menu
  if (data === 'nexus_main') {
    const users = await loadDB(env.BOT_DB, 'users');
    const total = Object.keys(users).length;
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, adminMenuTemplate(total), nexusMainKeyboard());
  }
  // user control submenu
  if (data === 'nexus_user') {
    const kb = { inline_keyboard: [
      [{ text: "🚫 Ban User", callback_data: "nexus_user_ban" }, { text: "✅ Unban User", callback_data: "nexus_user_unban" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>👥 Kontrol User</b>\nPilih tindakan:`, kb);
  }
  if (data === 'nexus_saldo') {
    const kb = { inline_keyboard: [
      [{ text: "➕ Tambah Saldo", callback_data: "nexus_saldo_add" }, { text: "➖ Kurangi Saldo", callback_data: "nexus_saldo_sub" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>💰 Manajemen Saldo</b>\nKirim ID dan jumlah setelah pilih (format bakal muncul).`, kb);
  }
  if (data === 'nexus_stok') {
    const kb = { inline_keyboard: [
      [{ text: "➕ Tambah Akun", callback_data: "nexus_stok_add" }, { text: "🗑️ Hapus Akun", callback_data: "nexus_stok_del" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>📦 Manajemen Stok</b>\nTambahkan / hapus akun produk.`, kb);
  }
  if (data === 'nexus_transaksi') {
    const kb = { inline_keyboard: [
      [{ text: "⏰ Cek Pending Payments", callback_data: "nexus_transaksi_pending" }, { text: "❌ Batalkan Deposit", callback_data: "nexus_transaksi_cancel" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>🧾 Transaksi Admin</b>\nPilih tindakan:`, kb);
  }
  if (data === 'nexus_bonus') {
    const cfg = await loadConfig(env.BOT_DB);
    const mode = cfg.bonus && cfg.bonus.mode ? cfg.bonus.mode : 'percent';
    const percent = cfg.bonus && cfg.bonus.percent ? cfg.bonus.percent : 0;
    const ranges = cfg.bonus && cfg.bonus.ranges ? cfg.bonus.ranges : [];
    const text = `<b>🎁 Bonus Deposit</b>\nMode: <b>${mode}</b>\nPercent: <code>${percent}%</code>\nRanges: ${ranges.length} item\n\nGunakan command atau tombol di bawah.`;
    const kb = { inline_keyboard: [
      [{ text: "Set Percent", callback_data: "nexus_bonus_setpercent" }, { text: "Add Range", callback_data: "nexus_bonus_addrange" }],
      [{ text: "Clear Ranges", callback_data: "nexus_bonus_clearranges" }, { text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, text, kb);
  }
  if (data === 'nexus_spam') {
    const cfg = await loadConfig(env.BOT_DB);
    const spam = cfg.spam || { limit: 10, window: 10 };
    const text = `<b>🚫 Anti-Spam</b>\nLimit: <code>${spam.limit}</code> pesan / <code>${spam.window}</code> detik\n\nGunakan /setspam <limit> <windowSeconds> atau tombol.`;
    const kb = { inline_keyboard: [
      [{ text: "Set Anti-Spam", callback_data: "nexus_spam_set" }, { text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, text, kb);
  }
  if (data === 'nexus_broadcast') {
    const kb = { inline_keyboard: [
      [{ text: "🔤 Kirim ke Semua", callback_data: "nexus_broadcast_all" }, { text: "🔢 Kirim ke ID", callback_data: "nexus_broadcast_ids" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>📢 Broadcast</b>\nBalas pesan ini dengan /broadcast atau gunakan tombol.`, kb);
  }
  if (data === 'nexus_config') {
    const kb = { inline_keyboard: [
      [{ text: "🔔 Set Log Grup", callback_data: "nexus_config_setnotif" }, { text: "🔁 Reset Config", callback_data: "nexus_config_reset" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>🔧 Konfigurasi</b>\nAtur log group / reset config.`, kb);
  }
  if (data === 'nexus_pending') {
    // show pending list
    const pend = await loadPendingPayments(env.BOT_DB);
    const keys = Object.keys(pend);
    if (keys.length === 0) {
      return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>⏰ Pending Payments</b>\nTidak ada pending saat ini.`, backButton('nexus_main'));
    }
    const now = new Date();
    const lines = keys.map(uid => {
      const p = pend[uid];
      const paymentTime = new Date(p.timestamp);
      const diff = Math.floor((now - paymentTime)/(1000*60));
      const left = Math.max(0, 10 - diff);
      return `> ${uid} - ${p.transactionId} - Rp ${formatNumber(p.nominal)} (${left}m left)`;
    }).join('\n');
    const text = `<b>⏰ Pending Payments</b>\n${lines}`;
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, text, backButton('nexus_main'));
  }
  if (data === 'nexus_uptime') {
    const up = formatUptime(Date.now() - START_TIME);
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>⏱️ Uptime</b>\n${up}`, backButton('nexus_main'));
  }

  // Sub-actions: handle specific flows launching sessions for admin via text replies
  // e.g. nexus_user_ban -> set session action 'ban_user' and instruct admin to reply with ID and optional reason.
  if (data === 'nexus_user_ban') {
    userSessions.set(user.id, { action: 'ban_user' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>🚫 Ban User</b>\nKirim ID User dan alasan (opsional) dengan format:\n<code>123456 alasan</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_user_unban') {
    userSessions.set(user.id, { action: 'unban_user' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>✅ Unban User</b>\nKirim ID User untuk di-unban:\n<code>123456</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_saldo_add') {
    userSessions.set(user.id, { action: 'tambah_saldo' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>➕ Tambah Saldo</b>\nKirim: <code>id jumlah</code>\nContoh: <code>12345 20000</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_saldo_sub') {
    userSessions.set(user.id, { action: 'kurangi_saldo' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>➖ Kurangi Saldo</b>\nKirim: <code>id jumlah</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_stok_add') {
    userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>➕ Tambah Akun</b>\nKetik nama produk:`, backButton('nexus_main'));
  }
  if (data === 'nexus_stok_del') {
    userSessions.set(user.id, { action: 'hapus_akun' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>🗑️ Hapus Akun</b>\nKirim email/username akun yang ingin dihapus:`, backButton('nexus_main'));
  }
  if (data === 'nexus_transaksi_cancel') {
    userSessions.set(user.id, { action: 'admin_cancel_deposit' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>❌ Batalkan Deposit</b>\nKirim ID user yang ingin dibatalkan pending-nya:`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_setpercent') {
    userSessions.set(user.id, { action: 'set_bonus_percent' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>Set Bonus Percent</b>\nKirim angka persen, mis: <code>10</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_addrange') {
    userSessions.set(user.id, { action: 'add_bonus_range' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>Tambah Range Bonus</b>\nFormat: <code>min max bonus</code>\nContoh: <code>20000 50000 5000</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_clearranges') {
    const cfg = await loadConfig(env.BOT_DB);
    cfg.bonus = { mode: 'percent', percent: cfg.bonus.percent || 0, ranges: [] };
    await saveConfig(env.BOT_DB, cfg);
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>✅ Semua range bonus dihapus. Mode set ke percent (${cfg.bonus.percent || 0}%).</b>`, backButton('nexus_main'));
  }
  if (data === 'nexus_spam_set') {
    userSessions.set(user.id, { action: 'set_spam' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>Set Anti-Spam</b>\nKirim: <code>limit windowSeconds</code>\nContoh: <code>10 10</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_broadcast_all' || data === 'nexus_broadcast_ids') {
    userSessions.set(user.id, { action: data === 'nexus_broadcast_all' ? 'broadcast_all' : 'broadcast_ids' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>📢 Broadcast</b>\nBalas pesan ini dengan /broadcast (reply) atau kirim teks yang akan dibroadcast. Untuk ID gunakan format: /broadcast id1,id2`, backButton('nexus_main'));
  }
  if (data === 'nexus_config_setnotif') {
    userSessions.set(user.id, { action: 'set_notif' });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>🔔 Set Log Grup</b>\nKirim ID grup: <code>-1001234567890</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_config_reset') {
    await saveConfig(env.BOT_DB, { bonus: { mode: 'percent', percent: 0, ranges: [] }, spam: { limit: 10, window: 10 }, logGroupId: null });
    return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>✅ Config di-reset ke default.</b>`, backButton('nexus_main'));
  }

  // default fallback
  return await telegramEditText(env.BOT_TOKEN, user.id, cb.message.message_id, `<b>Command belum diimplementasikan</b>`, backButton('nexus_main'));
}

// -----------------------------
// Admin text flow handler (for sessions)
// -----------------------------
async function handleAdminSessionMessage(update, env) {
  const message = update.message;
  const user = message.from;
  if (user.id.toString() !== env.ADMIN_ID) return;
  const session = userSessions.get(user.id);
  if (!session) return;

  const users = await loadDB(env.BOT_DB, 'users');
  const accounts = await loadDB(env.BOT_DB, 'accounts');
  const cfg = await loadConfig(env.BOT_DB);

  try {
    switch (session.action) {
      case 'ban_user': {
        const parts = message.text.split(/\s+/);
        const target = parts[0];
        const reason = parts.slice(1).join(' ') || 'Dibanned oleh admin';
        if (!target) {
          await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: <code>userId alasan</code>');
          userSessions.delete(user.id);
          return;
        }
        await addBan(env, target, reason);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ User ${target} dibanned.`);
        try { await telegramSend(env.BOT_TOKEN, parseInt(target), `❌ Anda diblokir oleh admin.\nAlasan: ${reason}`); } catch (e){ }
        await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'unban_user': {
        const target = message.text.trim();
        if (!target) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Kirim ID user'); userSessions.delete(user.id); return; }
        await removeBan(env, target);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ User ${target} di-unban.`);
        try { await telegramSend(env.BOT_TOKEN, parseInt(target), `✅ Akun Anda telah dibuka kembali oleh admin.`); } catch (e) {}
        await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'tambah_saldo': {
        const [target, amountStr] = message.text.trim().split(/\s+/);
        const amount = parseInt(amountStr);
        if (!target || isNaN(amount)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: <code>id jumlah</code>'); userSessions.delete(user.id); return; }
        if (!users[target]) users[target] = { saldo: 0 };
        users[target].saldo += amount;
        await saveDB(env.BOT_DB, users, 'users');
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Saldo ditambahkan ke ${target}: Rp ${formatNumber(amount)}`);
        try { await telegramSend(env.BOT_TOKEN, parseInt(target), `✅ Saldo Anda bertambah: Rp ${formatNumber(amount)}`); } catch (e) {}
        await sendLog(env, '💰 Tambah Saldo', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Jumlah: Rp ${formatNumber(amount)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'kurangi_saldo': {
        const [target, amountStr] = message.text.trim().split(/\s+/);
        const amount = parseInt(amountStr);
        if (!target || isNaN(amount)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: <code>id jumlah</code>'); userSessions.delete(user.id); return; }
        if (!users[target]) users[target] = { saldo: 0 };
        users[target].saldo -= amount;
        if (users[target].saldo < 0) users[target].saldo = 0;
        await saveDB(env.BOT_DB, users, 'users');
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Saldo dikurangi dari ${target}: Rp ${formatNumber(amount)}`);
        try { await telegramSend(env.BOT_TOKEN, parseInt(target), `❗ Saldo Anda dikurangi: Rp ${formatNumber(amount)}`); } catch (e) {}
        await sendLog(env, '➖ Kurangi Saldo', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Jumlah: Rp ${formatNumber(amount)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'tambah_akun': {
        // multi-step: nama -> email -> password -> harga -> deskripsi -> note
        const step = session.step;
        const data = session.data || {};
        if (step === 'nama') {
          data.name = message.text.trim();
          session.step = 'email';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env.BOT_TOKEN, user.id, '<b>Masukkan username/email</b>');
          return;
        } else if (step === 'email') {
          data.email = message.text.trim();
          session.step = 'password';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env.BOT_TOKEN, user.id, '<b>Masukkan password</b>');
          return;
        } else if (step === 'password') {
          data.password = message.text.trim();
          session.step = 'harga';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env.BOT_TOKEN, user.id, '<b>Masukkan harga (angka)</b>');
          return;
        } else if (step === 'harga') {
          const price = parseInt(message.text.replace(/\D/g,''));
          if (isNaN(price)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Harga harus angka'); userSessions.delete(user.id); return; }
          data.price = price;
          session.step = 'deskripsi';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env.BOT_TOKEN, user.id, `<b>Masukkan deskripsi produk</b>`);
          return;
        } else if (step === 'deskripsi') {
          data.description = message.text.trim();
          session.step = 'note';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env.BOT_TOKEN, user.id, `<b>Masukkan catatan (atau ketik 'tidak ada')</b>`);
          return;
        } else if (step === 'note') {
          data.note = message.text.trim().toLowerCase() !== 'tidak ada' ? message.text.trim() : 'Tidak ada catatan';
          accounts[data.email] = data;
          await saveDB(env.BOT_DB, accounts, 'accounts');
          await telegramSend(env.BOT_TOKEN, user.id, `<b>✅ Akun berhasil ditambahkan</b>\nNama: <code>${data.name}</code>\nEmail: <code>${data.email}</code>\nHarga: Rp ${formatNumber(data.price)}`);
          await sendLog(env, '➕ Stok Ditambah', [`Admin: ${env.ADMIN_ID}`, `Produk: ${data.name}`, `Email: ${data.email}`, `Harga: Rp ${formatNumber(data.price)}`, `Waktu: ${niceTime(new Date())}`]);
          userSessions.delete(user.id);
          return;
        }
        return;
      }
      case 'hapus_akun': {
        const key = message.text.trim();
        if (accounts[key]) {
          delete accounts[key];
          await saveDB(env.BOT_DB, accounts, 'accounts');
          await telegramSend(env.BOT_TOKEN, user.id, '✅ Akun berhasil dihapus.');
          await sendLog(env, '🗑️ Hapus Akun', [`Admin: ${env.ADMIN_ID}`, `Akun: ${key}`, `Waktu: ${niceTime(new Date())}`]);
        } else {
          await telegramSend(env.BOT_TOKEN, user.id, '❌ Akun tidak ditemukan.');
        }
        userSessions.delete(user.id);
        return;
      }
      case 'admin_cancel_deposit': {
        const target = message.text.trim();
        if (!target) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Kirim ID user'); userSessions.delete(user.id); return; }
        const pend = await getPendingPayment(env.BOT_DB, target);
        if (!pend) { await telegramSend(env.BOT_TOKEN, user.id, '⚠️ Tidak ada pending untuk user tersebut'); userSessions.delete(user.id); return; }
        if (pend.messageId) {
          try { await telegramEditCaption(env.BOT_TOKEN, parseInt(target), pend.messageId, `❌ <b>Pembayaran Dibatalkan oleh Admin</b>\nID: <code>${pend.transactionId}</code>`); } catch(e) {}
        }
        await removePendingPayment(env.BOT_DB, target);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Pending deposit untuk ${target} dibatalkan.`);
        try { await telegramSend(env.BOT_TOKEN, parseInt(target), `❌ Pembayaran Anda dibatalkan oleh admin.`); } catch (e) {}
        await sendLog(env, '❌ Admin Batalkan Deposit', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Trans: ${pend.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_bonus_percent': {
        const val = parseFloat(message.text.trim());
        if (isNaN(val)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Kirim angka persen'); userSessions.delete(user.id); return; }
        cfg.bonus = cfg.bonus || { mode: 'percent', percent: 0, ranges: [] };
        cfg.bonus.mode = 'percent';
        cfg.bonus.percent = val;
        await saveConfig(env.BOT_DB, cfg);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Bonus percent diset: ${val}%`);
        await sendLog(env, '🎁 Set Bonus Percent', [`Admin: ${env.ADMIN_ID}`, `Percent: ${val}%`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'add_bonus_range': {
        const parts = message.text.trim().split(/\s+/);
        const min = parseInt(parts[0]);
        const max = parseInt(parts[1]);
        const bonus = parseInt(parts[2]);
        if (isNaN(min) || isNaN(max) || isNaN(bonus)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: min max bonus'); userSessions.delete(user.id); return; }
        cfg.bonus = cfg.bonus || { mode: 'range', percent: 0, ranges: [] };
        cfg.bonus.mode = 'range';
        cfg.bonus.ranges = cfg.bonus.ranges || [];
        cfg.bonus.ranges.push({ min, max, bonus });
        await saveConfig(env.BOT_DB, cfg);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Range ditambahkan: ${min}-${max} => Rp ${formatNumber(bonus)}`);
        await sendLog(env, '🎁 Add Bonus Range', [`Admin: ${env.ADMIN_ID}`, `Range: ${min}-${max}`, `Bonus: Rp ${formatNumber(bonus)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_spam': {
        const parts = message.text.trim().split(/\s+/);
        const limit = parseInt(parts[0]);
        const window = parseInt(parts[1]);
        if (isNaN(limit) || isNaN(window)) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: limit windowSeconds'); userSessions.delete(user.id); return; }
        cfg.spam = { limit, window };
        await saveConfig(env.BOT_DB, cfg);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Anti-spam diset: ${limit} msgs / ${window}s`);
        await sendLog(env, '🚫 Set Anti-Spam', [`Admin: ${env.ADMIN_ID}`, `Limit: ${limit}`, `Window: ${window}s`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_notif': {
        const gid = message.text.trim();
        if (!gid) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Kirim ID grup'); userSessions.delete(user.id); return; }
        cfg.logGroupId = gid;
        await saveConfig(env.BOT_DB, cfg);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ ID grup log disimpan: ${gid}`);
        await sendLog(env, '🔔 Set Log Group', [`Admin: ${env.ADMIN_ID}`, `Group: ${gid}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'broadcast_all': {
        // message.text is the content to send
        const content = message.text;
        const allUsers = await loadDB(env.BOT_DB, 'users');
        const ids = Object.keys(allUsers);
        let success = 0, fail = 0;
        for (const id of ids) {
          try {
            await telegramSend(env.BOT_TOKEN, parseInt(id), content);
            success++;
          } catch (e) { fail++; }
          await new Promise(res => setTimeout(res, 80));
        }
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Broadcast selesai. Success: ${success}, Fail: ${fail}`);
        userSessions.delete(user.id);
        return;
      }
      case 'broadcast_ids': {
        // format: first line ids comma separated? We'll expect admin used /broadcast id1,id2 reply or text: "id1,id2\nmessage"
        const raw = message.text.split('\n');
        const idsPart = raw[0].trim();
        const msgPart = raw.slice(1).join('\n').trim();
        const ids = idsPart.split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length || !msgPart) { await telegramSend(env.BOT_TOKEN, user.id, '❌ Format: id1,id2,...\\nPesan'); userSessions.delete(user.id); return; }
        let s=0,f=0;
        for (const id of ids) {
          try { await telegramSend(env.BOT_TOKEN, parseInt(id), msgPart); s++; } catch(e){ f++; }
        }
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Broadcast selesai. Success: ${s}, Fail: ${f}`);
        userSessions.delete(user.id);
        return;
      }
      default:
        userSessions.delete(user.id);
        return;
    }
  } catch (e) {
    console.error('handleAdminSessionMessage error', e);
    userSessions.delete(user.id);
    await telegramSend(env.BOT_TOKEN, user.id, `❌ Terjadi kesalahan: ${e.message}`);
  }
}

// -----------------------------
// Cleanup expired pending payments
// -----------------------------
async function cleanupExpiredPayments(env) {
  try {
    const pending = await loadPendingPayments(env.BOT_DB);
    const now = new Date();
    for (const [uid, p] of Object.entries(pending)) {
      const paymentTime = new Date(p.timestamp);
      const diff = (now - paymentTime) / (1000*60);
      if (diff > 10) {
        if (p.messageId) {
          try { await telegramEditCaption(env.BOT_TOKEN, parseInt(uid), p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${p.transactionId}</code>`); } catch(e){}
        }
        await removePendingPayment(env.BOT_DB, uid);
        await telegramSend(env.BOT_TOKEN, env.ADMIN_ID, `<b>⏰ Pending payment expired</b>\n> User: ${uid}\n> Trans: ${p.transactionId}`);
        await sendLog(env, '⏰ Pending Expired', [`User: ${uid}`, `Trans: ${p.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
      }
    }
  } catch (e) {
    console.error('cleanupExpiredPayments error', e);
  }
}

// -----------------------------
// Router: main entry
// -----------------------------
router.post('/', async (request, env) => {
  try {
    const update = await request.json();

    // run cleanup on every request
    await cleanupExpiredPayments(env);

    // callback_query handling
    if (update.callback_query) {
      const data = update.callback_query.data;
      // nexus callbacks
      if (data && data.startsWith('nexus')) {
        return new Response(JSON.stringify(await handleNexusCallback(update, env)));
      }
      // buy callbacks
      if (data === 'beli_akun') return new Response(JSON.stringify(await handleBeliAkunCallback(update, env)));
      if (data.startsWith('group_')) return new Response(JSON.stringify(await handleDetailAkun(update, env)));
      if (data.startsWith('beli_')) return new Response(JSON.stringify(await handleProsesPembelian(update, env)));
      if (data === 'deposit') return new Response(JSON.stringify(await handleDepositCallback(update, env)));
      if (data.startsWith('confirm_payment_')) return new Response(JSON.stringify(await handleConfirmPayment(update, env)));
      if (data === 'cancel_payment') return new Response(JSON.stringify(await handleCancelPayment(update, env)));
      // fallback OK
      return new Response('OK');
    }

    // message handling
    if (update.message) {
      const text = update.message.text || '';
      const user = update.message.from;

      // Admin session messages (if any)
      if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) {
        await handleAdminSessionMessage(update, env);
        return new Response(JSON.stringify({ ok: true }));
      }

      // commands that don't require /nexus menu
      if (text.startsWith('/nexus')) {
        return new Response(JSON.stringify(await handleNexusCommand(update, env)));
      }
      if (text.startsWith('/setnotif')) {
        // allow admin to set group quickly as well
        if (user.id.toString() !== env.ADMIN_ID) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/);
        const gid = parts[1];
        if (!gid) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /setnotif <id_grup>')));
        const cfg = await loadConfig(env.BOT_DB);
        cfg.logGroupId = gid;
        await saveConfig(env.BOT_DB, cfg);
        await telegramSend(env.BOT_TOKEN, user.id, `✅ ID grup log disimpan: ${gid}`);
        return new Response(JSON.stringify({ ok: true }));
      }
      if (text.startsWith('/uptime')) {
        const up = formatUptime(Date.now() - START_TIME);
        return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, `⏱️ Uptime: ${up}`)));
      }

      // admin quick text commands (some kept for backward compatibility)
      if (user.id.toString() === env.ADMIN_ID) {
        // commands: /ban, /unban, /canceldeposit, /setbonuspercent, /addrangebonus, /clearrangebonus, /setspam
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();

        if (cmd === '/ban') {
          const target = parts[1];
          const reason = parts.slice(2).join(' ') || 'Dibanned oleh admin';
          if (!target) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /ban <userId> [reason]')));
          await addBan(env, target, reason);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ User ${target} dibanned.`);
          try { await telegramSend(env.BOT_TOKEN, parseInt(target), `❌ Anda diblokir oleh admin.\nAlasan: ${reason}`); } catch(e){}
          await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/unban') {
          const target = parts[1];
          if (!target) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /unban <userId>')));
          await removeBan(env, target);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ User ${target} di-unban.`);
          try { await telegramSend(env.BOT_TOKEN, parseInt(target), `✅ Akun Anda telah dibuka kembali oleh admin.`); } catch(e){}
          await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/canceldeposit') {
          const target = parts[1];
          if (!target) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /canceldeposit <userId>')));
          const pend = await getPendingPayment(env.BOT_DB, target);
          if (!pend) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '⚠️ Tidak ada pending untuk user tersebut')));
          if (pend.messageId) {
            try { await telegramEditCaption(env.BOT_TOKEN, parseInt(target), pend.messageId, `❌ <b>Pembayaran Dibatalkan oleh Admin</b>\nID: <code>${pend.transactionId}</code>`); } catch(e){}
          }
          await removePendingPayment(env.BOT_DB, target);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ Pending deposit untuk ${target} dibatalkan.`);
          try { await telegramSend(env.BOT_TOKEN, parseInt(target), `❌ Pembayaran Anda dibatalkan oleh admin.`); } catch(e){}
          await sendLog(env, '❌ Admin Batalkan Deposit', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Trans: ${pend.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/setbonuspercent') {
          const val = parseFloat(parts[1]);
          if (isNaN(val)) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /setbonuspercent <percent>')));
          const cfg = await loadConfig(env.BOT_DB);
          cfg.bonus = cfg.bonus || { mode: 'percent', percent: 0, ranges: [] };
          cfg.bonus.mode = 'percent';
          cfg.bonus.percent = val;
          await saveConfig(env.BOT_DB, cfg);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ Bonus percent diset: ${val}%`);
          await sendLog(env, '🎁 Set Bonus Percent', [`Admin: ${env.ADMIN_ID}`, `Percent: ${val}%`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/addrangebonus') {
          const min = parseInt(parts[1]); const max = parseInt(parts[2]); const bonus = parseInt(parts[3]);
          if (isNaN(min) || isNaN(max) || isNaN(bonus)) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /addrangebonus <min> <max> <bonus>')));
          const cfg = await loadConfig(env.BOT_DB);
          cfg.bonus = cfg.bonus || { mode: 'range', percent: 0, ranges: [] };
          cfg.bonus.mode = 'range';
          cfg.bonus.ranges = cfg.bonus.ranges || [];
          cfg.bonus.ranges.push({ min, max, bonus });
          await saveConfig(env.BOT_DB, cfg);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ Range ditambahkan: ${min}-${max} => Rp ${formatNumber(bonus)}`);
          await sendLog(env, '🎁 Add Bonus Range', [`Admin: ${env.ADMIN_ID}`, `Range: ${min}-${max}`, `Bonus: Rp ${formatNumber(bonus)}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/clearrangebonus') {
          const cfg = await loadConfig(env.BOT_DB);
          cfg.bonus = { mode: 'percent', percent: cfg.bonus.percent || 0, ranges: [] };
          await saveConfig(env.BOT_DB, cfg);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ Semua range bonus dihapus.`);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/setspam') {
          const limit = parseInt(parts[1]); const window = parseInt(parts[2]);
          if (isNaN(limit) || isNaN(window)) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Usage: /setspam <limit> <windowSeconds>')));
          const cfg = await loadConfig(env.BOT_DB);
          cfg.spam = { limit, window };
          await saveConfig(env.BOT_DB, cfg);
          await telegramSend(env.BOT_TOKEN, user.id, `✅ Anti-spam diset: ${limit} msgs / ${window}s`);
          return new Response(JSON.stringify({ ok: true }));
        }
      }

      // Non-admin messages: anti-spam & deposit handling
      if (!text.startsWith('/') && user.id.toString() !== env.ADMIN_ID) {
        const banned = await checkAntiSpam(env, user.id.toString(), user.username);
        if (banned) {
          await telegramSend(env.BOT_TOKEN, user.id, '❌ Anda diblokir sementara karena aktivitas spam. Hubungi admin jika keliru.');
          return new Response(JSON.stringify({ ok: true }));
        }
      }

      // standard commands
      if (text.startsWith('/start')) return new Response(JSON.stringify(await handleStart(update, env)));
      if (text.startsWith('/id')) return new Response(JSON.stringify(await handleGetId(update, env)));
      if (text.startsWith('/broadcast')) {
        // keep original broadcast behavior (reply to message or /broadcast id1,id2)
        if (user.id.toString() !== env.ADMIN_ID) return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '❌ Akses ditolak')));
        if (!update.message.reply_to_message && text.indexOf(' ') === -1) {
          return new Response(JSON.stringify(await telegramSend(env.BOT_TOKEN, user.id, '⚠️ Balas pesan yang ingin di-broadcast atau gunakan /broadcast id1,id2')));
        }
        const reply = update.message.reply_to_message;
        const specificIds = text.split(' ')[1]?.split(',').filter(Boolean) || [];
        const users = await loadDB(env.BOT_DB, 'users');
        const targets = specificIds.length ? specificIds : Object.keys(users);
        let s=0,f=0;
        for (const t of targets) {
          try {
            if (reply && reply.text) await telegramSend(env.BOT_TOKEN, parseInt(t), reply.text);
            else await telegramSend(env.BOT_TOKEN, parseInt(t), '📢 Broadcast dari admin');
            s++;
          } catch (e) { f++; }
          await new Promise(r => setTimeout(r, 80));
        }
        await telegramSend(env.BOT_TOKEN, user.id, `✅ Broadcast selesai. Success: ${s}, Fail: ${f}`);
        return new Response(JSON.stringify({ ok: true }));
      }

      // if regular non-command text -> deposit message handler
      if (update.message.text && !text.startsWith('/')) {
        return new Response(JSON.stringify(await handleDepositMessage(update, env)));
      }
    }

    return new Response('OK');
  } catch (e) {
    console.error('Main router error', e);
    return new Response('Error', { status: 500 });
  }
});

router.get('/', () => new Response('Telegram Bot is running!'));

export default {
  fetch: router.handle
};
