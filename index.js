 import { Router } from 'itty-router';
const router = Router();

/**
 * index.js - TeamNexusDev Bot (Versi 1.1 Beta)
 *
 * Fitur:
 * - /start tampilkan Versi 1.1 Beta UI (dinamis greet user)
 * - /nexus admin panel (inline keyboard)
 * - setnotif untuk set grup log (semua notifikasi ke 1 grup, dikutip)
 * - deposit flow (QRIS create, pending, konfirmasi)
 * - pembelian akun (stok akun di KV)
 * - manajemen saldo, stok, ban/unban, anti-spam auto-ban
 * - bonus deposit (percent / ranges)
 * - pending payments cleanup
 * - statistik & uptime
 *
 * NOTE:
 * - Pastikan KV binding: BOT_DB
 * - ENV variables: BOT_TOKEN, ADMIN_ID, ADMIN_USERNAME, API_CREATE_URL, API_CHECK_PAYMENT,
 *   QRIS_CODE, MERCHANT_ID, API_KEY, MIN_AMOUNT, RANDOM_AMOUNT_MIN, RANDOM_AMOUNT_MAX
 */

// -------------------------------
// In-memory & constants
// -------------------------------
const userSessions = new Map(); // admin multi-step sessions
const messageTimestamps = new Map(); // anti-spam timestamps
const START_TIME = Date.now();

// -------------------------------
// KV helpers (use full env object, expects env.BOT_DB)
// -------------------------------
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

// Backwards-compatible DB wrappers
async function loadDB(env, dbType) { return await kvGet(env, dbType); }
async function saveDB(env, data, dbType) { return await kvPut(env, dbType, data); }

// Pending payments helpers
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
  } catch (e) {
    console.error('savePendingPayment', e);
    return false;
  }
}
async function removePendingPayment(env, userId) {
  try {
    const pending = await loadPendingPayments(env);
    if (pending[userId]) {
      delete pending[userId];
      await kvPut(env, 'pending_payments', pending);
    }
    return true;
  } catch (e) {
    console.error('removePendingPayment', e);
    return false;
  }
}
async function getPendingPayment(env, userId) {
  try {
    const pending = await loadPendingPayments(env);
    const p = pending[userId];
    if (!p) return null;
    return { ...p, timestamp: new Date(p.timestamp) };
  } catch (e) {
    console.error('getPendingPayment', e);
    return null;
  }
}

// Stats helpers (track successful transactions)
async function loadStats(env) {
  const s = await kvGet(env, 'stats');
  return {
    success: s.success || 0,
    // extendable
    ...s
  };
}
async function incrStatSuccess(env, n = 1) {
  const s = await kvGet(env, 'stats');
  s.success = (s.success || 0) + n;
  await kvPut(env, 'stats', s);
}

// -------------------------------
// Format helpers
// -------------------------------
function formatNumber(num = 0) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
// -------------------------------
async function telegramSend(env, chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
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
async function telegramSendPhoto(env, chatId, photoUrl, caption = '', replyMarkup = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`;
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
async function telegramEditText(env, chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`;
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
async function telegramEditCaption(env, chatId, messageId, caption, replyMarkup = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageCaption`;
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
async function answerCallback(env, callbackQueryId, text = null, showAlert = false) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
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

// -------------------------------
// Config & Ban helpers
// -------------------------------
async function loadConfig(env) {
  const cfg = await kvGet(env, 'bot_config');
  return {
    bonus: cfg.bonus || { mode: 'percent', percent: 0, ranges: [] },
    spam: cfg.spam || { limit: 10, window: 10 },
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
  if (bans[userId]) {
    delete bans[userId];
    await kvPut(env, 'banned_users', bans);
  }
}
async function isBanned(env, userId) {
  const bans = await getBans(env);
  return !!bans[userId];
}

// -------------------------------
// sendLog: sends to logGroup if set, in quoted style
// items = array of strings (no > prefix). The function will prefix each item with "> " to create quotes.
// Example title: "📦 Transaksi Sukses"
async function sendLog(env, title, items = []) {
  try {
    const cfg = await loadConfig(env);
    const gid = cfg.logGroupId;
    if (!gid) return;
    let text = `${title}\n`;
    for (const it of items) text += `> ${it}\n`;
    // optional hashtags automatically based on title keywords (simple)
    const tags = [];
    if (/deposit/i.test(title)) tags.push('#DEPOSIT');
    if (/pembelian|pembeli/i.test(title)) tags.push('#TRANSACTION', '#SUCCESS');
    if (/pending/i.test(title)) tags.push('#PENDING');
    if (/ban/i.test(title)) tags.push('#SECURITY');
    if (tags.length) text += tags.join(' ');
    await telegramSend(env, gid, text);
  } catch (e) {
    console.error('sendLog error', e);
  }
}

// -------------------------------
// Anti-spam: sliding window, auto-ban
// -------------------------------
async function checkAntiSpam(env, userId, username) {
  try {
    const cfg = await loadConfig(env);
    const limit = (cfg.spam && cfg.spam.limit) || 10;
    const windowSec = (cfg.spam && cfg.spam.window) || 10;
    const now = Date.now();
    const arr = messageTimestamps.get(userId) || [];
    const windowMs = windowSec * 1000;
    const pruned = arr.filter(t => now - t <= windowMs);
    pruned.push(now);
    messageTimestamps.set(userId, pruned);
    if (pruned.length > limit) {
      await addBan(env, userId, 'auto-spam');
      await telegramSend(env, env.ADMIN_ID, `<b>🚫 Auto-Ban (Anti-Spam)</b>\n> 👤 User: @${username || 'N/A'} (ID: ${userId})\n> 🧠 Alasan: Spam terlalu banyak\n> ⏰ Waktu: ${niceTime(new Date())}`);
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

// -------------------------------
// UI templates
// -------------------------------
function startTemplate(env, user, totalUsers, successCount, stok, uptimeStr) {
  // greeting uses username if exists, else first_name, else 'Pengguna Baru'
  const name = user.username ? `@${user.username}` : (user.first_name || 'Pengguna Baru');
  const admin = env.ADMIN_USERNAME ? env.ADMIN_USERNAME : (env.ADMIN_ID || 'Admin');
  return `
<b>🧩 Versi 1.1 Beta</b>

<b>Halo, ${name}! 👋</b>
Selamat datang di <b>𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃</b>.
Solusi digital otomatis Anda.

<b>┌ INFORMASI AKUN ANDA</b>
├ 🆔 <b>User ID:</b> <code>${user.id}</code>
└ 💰 <b>Saldo:</b> <code>Rp ${formatNumber(user.saldo || 0)}</code>

<b>┌ STATISTIK BOT</b>
├ 👥 <b>Total Pengguna:</b> <code>${totalUsers}</code>
├ ✅ <b>Transaksi Sukses:</b> <code>${successCount}</code>
├ 📦 <b>Stok Tersedia:</b> <code>${stok} Akun</code>
└ ⏱️ <b>Bot Aktif Sejak:</b> <code>${uptimeStr}</code>

<b>┌ BANTUAN</b>
└ 👨‍💼 <b>Admin:</b> ${admin}

👇 <b>Silakan pilih menu di bawah ini:</b>
`.trim();
}

// admin menu template
function adminMenuTemplate(totalUsers = 0) {
  return `
👑 <b>NEXUS — Admin Console</b>
━━━━━━━━━━━━━━━━━━
👥 <b>Members:</b> <code>${totalUsers}</code>

Pilih tindakan di bawah (sentuh tombol):
`.trim();
}

// -------------------------------
// Flow: /start
// -------------------------------
async function handleStart(update, env) {
  const userRaw = update.message.from;
  const userId = userRaw.id.toString();
  const users = await loadDB(env, 'users');
  const accounts = await loadDB(env, 'accounts');

  if (!users[userId]) {
    users[userId] = { saldo: 0 };
    await saveDB(env, users, 'users');
  }

  // ban check
  if (await isBanned(env, userId)) {
    const bans = await getBans(env);
    const reason = bans[userId]?.reason || 'Anda diblokir.';
    return await telegramSend(env, userRaw.id, `❌ <b>Akses Ditolak</b>\n\nAnda telah diblokir.\nAlasan: ${reason}`);
  }

  const totalUsers = Object.keys(users).length;
  const stats = await loadStats(env);
  const successCount = stats.success || 0;
  const stok = Object.keys(accounts).length;
  const uptimeStr = formatUptime(Date.now() - START_TIME);

  const userView = { id: userRaw.id, username: userRaw.username, first_name: userRaw.first_name, saldo: users[userId].saldo || 0 };
  const msg = startTemplate(env, userView, totalUsers, successCount, stok, uptimeStr);

  const keyboard = {
    inline_keyboard: [
      [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
      [{ text: "💳 Deposit Saldo", callback_data: "deposit" }],
      [{ text: "📞 Bantuan", callback_data: "help" }]
    ]
  };

  return await telegramSend(env, userRaw.id, msg, keyboard);
}

// -------------------------------
// /id command
// -------------------------------
async function handleGetId(update, env) {
  const u = update.message.from;
  const msg = `
🆔 <b>Informasi Akun</b>
👤 <b>Username:</b> ${u.username ? `<code>@${u.username}</code>` : '<i>(tidak tersedia)</i>'}
📄 <b>User ID:</b> <code>${u.id}</code>
`;
  return await telegramSend(env, u.id, msg);
}

// -------------------------------
// Buy flow (kept behavior, with log)
// -------------------------------
async function handleBeliAkunCallback(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env, cb.id, '❌ Anda diblokir.', true);
    return;
  }

  const accounts = await loadDB(env, 'accounts');
  if (Object.keys(accounts).length === 0) {
    const msg = `⚠️ <b>Maaf, saat ini item tidak tersedia.</b>`;
    return await telegramEditText(env, user.id, cb.message.message_id, msg);
  }

  // group by name_price
  const grouped = {};
  for (const [email, acc] of Object.entries(accounts)) {
    const key = `${acc.name}_${acc.price}`;
    (grouped[key] = grouped[key] || []).push(email);
  }

  const buttons = Object.entries(grouped).map(([key, emails]) => {
    const [name, price] = key.split('_');
    return [{ text: `${name} - Rp ${formatNumber(parseInt(price))} (x${emails.length})`, callback_data: `group_${name}_${price}` }];
  });
  buttons.push([{ text: "🔙 Kembali", callback_data: "back_to_main" }]);

  const msg = `<b>🛒 Pilih Produk</b>\nTotal stok: <code>${Object.keys(accounts).length}</code>`;
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, msg, { inline_keyboard: buttons });
}

async function handleDetailAkun(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env, cb.id, '❌ Anda diblokir.', true);
    return;
  }

  const accounts = await loadDB(env, 'accounts');
  const [, name, price] = cb.data.split('_');
  const priceInt = parseInt(price);
  const filtered = Object.entries(accounts).filter(([email, acc]) => acc.name === name && acc.price === priceInt);
  if (filtered.length === 0) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, '❌ <b>Akun tidak tersedia</b>');
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
  await answerCallback(env, cb.id);
  return await telegramEditText(env, user.id, cb.message.message_id, msg, keyboard);
}

async function handleProsesPembelian(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env, cb.id, '❌ Anda diblokir.', true);
    return;
  }
  const uid = user.id.toString();
  const users = await loadDB(env, 'users');
  const accounts = await loadDB(env, 'accounts');
  const email = cb.data.split('_')[1];
  if (!accounts[email]) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, '<b>⚠️ Akun tidak tersedia.</b>');
  }
  const acc = accounts[email];
  const price = acc.price;
  if (!users[uid]) users[uid] = { saldo: 0 };
  if (users[uid].saldo < price) {
    await answerCallback(env, cb.id);
    return await telegramEditText(env, user.id, cb.message.message_id, '<b>💰 Saldo tidak cukup. Silakan deposit.</b>');
  }
  // process
  users[uid].saldo -= price;
  await saveDB(env, users, 'users');
  delete accounts[email];
  await saveDB(env, accounts, 'accounts');

  const msg = `
✅ <b>Pembelian Berhasil</b>
<b>Produk:</b> <code>${acc.name}</code>
<b>Email:</b> <code>${acc.email}</code>
<b>Password:</b> <code>${acc.password}</code>
<b>Total Bayar:</b> <code>Rp ${formatNumber(price)}</code>
`;
  await answerCallback(env, cb.id);
  await telegramEditText(env, user.id, cb.message.message_id, msg);

  // notify admin & log
  await telegramSend(env, env.ADMIN_ID, `<b>🔔 Pembelian Sukses</b>\n> 👤 User: @${user.username || 'N/A'} (ID: ${uid})\n> 🛒 Produk: ${acc.name}\n> 💰 Harga: Rp ${formatNumber(price)}\n> 🕒 ${niceTime(new Date())}`);
  await sendLog(env, '📦 Transaksi Sukses', [
    `👤 User: @${user.username || 'N/A'} (ID: ${uid})`,
    `Jenis: Pembelian`,
    `Produk: ${acc.name}`,
    `Harga: Rp ${formatNumber(price)}`,
    `Waktu: ${niceTime(new Date())}`
  ]);

  // increment success stat
  await incrStatSuccess(env, 1);
}

// -------------------------------
// Deposit flow (pending -> confirm -> credit with bonus)
// -------------------------------
async function handleDepositCallback(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env, cb.id, '❌ Anda diblokir dan tidak dapat deposit.', true);
    return;
  }
  const pending = await getPendingPayment(env, user.id);
  if (pending) {
    await answerCallback(env, cb.id, '⚠️ Anda masih punya deposit pending.', true);
    return;
  }
  await answerCallback(env, cb.id);
  const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
  const msg = `<b>Masukkan nominal deposit</b>\n💰 Minimal: <code>Rp ${formatNumber(minAmount)}</code>\nKetik jumlah:`;
  return await telegramEditText(env, user.id, cb.message.message_id, msg);
}

async function handleDepositMessage(update, env) {
  const message = update.message;
  const user = message.from;
  if (await isBanned(env, user.id.toString())) {
    await telegramSend(env, user.id, '❌ Anda diblokir dan tidak dapat deposit.');
    return;
  }
  const pending = await getPendingPayment(env, user.id);
  if (pending) {
    await telegramSend(env, user.id, '⚠️ Anda masih memiliki deposit yang belum selesai.');
    return;
  }
  try {
    const nominal = parseInt(message.text.replace(/\D/g, ''));
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    if (isNaN(nominal) || nominal < minAmount) {
      return await telegramSend(env, user.id, `⚠️ Nominal minimal Rp ${formatNumber(minAmount)}.`);
    }
    await createQrisAndConfirm(env, user, nominal);
  } catch (e) {
    await telegramSend(env, user.id, '⚠️ Nominal tidak valid.');
  }
}

async function createQrisAndConfirm(env, user, nominal) {
  const randomFee = getRandomAmount(env);
  const finalTotal = nominal + randomFee;

  try {
    // call external API to create qris (assumed API returns status/data.download_url & kode transaksi)
    const response = await fetch(`${env.API_CREATE_URL}?amount=${finalTotal}&qrisCode=${env.QRIS_CODE}`);
    const data = await response.json();

    if (!data || data.status !== 'success') {
      return await telegramSend(env, user.id, '❌ Gagal membuat QRIS. Coba lagi.');
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
    await savePendingPayment(env, user.id, paymentData);

    const caption = `
<b>💳 Pembayaran Pending</b>
━━━━━━━━━━━━━━
👤 <b>Username:</b> ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')}
🆔 <b>User ID:</b> <code>${user.id}</code>
🧾 <b>Id Transaksi:</b> <code>${transId}</code>
💰 <b>Nominal:</b> <code>Rp ${formatNumber(nominal)}</code>
🎲 <b>Fee Random:</b> <code>Rp ${formatNumber(randomFee)}</code>
💳 <b>Total Bayar:</b> <code>Rp ${formatNumber(finalTotal)}</code>
⌛ <b>Expired:</b> <code>10 menit</code>

📸 Silakan scan QRIS di atas untuk menyelesaikan pembayaran.
Setelah membayar, tekan tombol ✅ <b>Konfirmasi Pembayaran</b>.
`.trim();

    const keyboard = { inline_keyboard: [[{ text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transId}` }, { text: "❌ Batalkan Pembayaran", callback_data: "cancel_payment" }]] };

    const sent = await telegramSendPhoto(env, user.id, qrisUrl, caption, keyboard);
    if (sent && sent.ok) {
      paymentData.messageId = sent.result.message_id;
      await savePendingPayment(env, user.id, paymentData);
    }

    // notify admin + log (quoted)
    await telegramSend(env, env.ADMIN_ID, `<b>⏳ Pembayaran Pending</b>\n> 👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')}\n> 🆔 User ID: ${user.id}\n> 🧾 Id Transaksi: ${transId}\n> 💳 Total Bayar: Rp ${formatNumber(finalTotal)}`);
    await sendLog(env, '⏳ Pembayaran Pending', [
      `👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')} (ID: ${user.id})`,
      `Id Transaksi: ${transId}`,
      `Nominal: Rp ${formatNumber(nominal)}`,
      `Fee Random: Rp ${formatNumber(randomFee)}`,
      `Total Bayar: Rp ${formatNumber(finalTotal)}`,
      `Waktu: ${niceTime(new Date())}`
    ]);
  } catch (e) {
    console.error('createQrisAndConfirm error', e);
    await telegramSend(env, user.id, '❌ Terjadi kesalahan membuat QRIS.');
  }
}

async function handleConfirmPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (await isBanned(env, user.id.toString())) {
    await answerCallback(env, cb.id, '❌ Anda diblokir.', true);
    return;
  }
  const p = await getPendingPayment(env, user.id);
  if (!p) {
    await answerCallback(env, cb.id, '❌ Tidak ada pembayaran pending.', true);
    return;
  }
  const transId = cb.data.split('_')[2];
  if (p.transactionId !== transId) {
    await answerCallback(env, cb.id, '❌ ID transaksi tidak cocok.', true);
    return;
  }

  // expiration
  const now = new Date();
  if ((now - new Date(p.timestamp)) / (1000*60) > 10) {
    await removePendingPayment(env, user.id);
    if (p.messageId) await telegramEditCaption(env, user.id, p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${transId}</code>`);
    await answerCallback(env, cb.id, '❌ Pembayaran expired.', true);
    return;
  }

  // call check payment API
  try {
    const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
    if (!response.ok) {
      await answerCallback(env, cb.id, '❌ Gagal cek pembayaran.', true);
      return;
    }
    const data = await response.json();
    if (data.status !== 'success') {
      await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi.', true);
      return;
    }
    const payments = data.data || [];
    let found = false;
    for (const pay of payments) {
      if (pay && pay.amount === p.finalNominal) { found = true; break; }
    }
    if (!found) {
      await answerCallback(env, cb.id, '⚠️ Pembayaran belum terdeteksi.', true);
      return;
    }

    // apply bonus
    const users = await loadDB(env, 'users');
    const uid = user.id.toString();
    if (!users[uid]) users[uid] = { saldo: 0 };
    const cfg = await loadConfig(env);
    let bonus = 0;
    if (cfg.bonus) {
      if (cfg.bonus.mode === 'percent' && cfg.bonus.percent) {
        bonus = Math.floor(p.nominal * (cfg.bonus.percent / 100));
      } else if (cfg.bonus.mode === 'range' && Array.isArray(cfg.bonus.ranges)) {
        for (const r of cfg.bonus.ranges) {
          if (p.nominal >= r.min && p.nominal <= r.max) { bonus = r.bonus; break; }
        }
      }
    }

    users[uid].saldo += p.nominal + bonus;
    await saveDB(env, users, 'users');
    await removePendingPayment(env, user.id);

    if (p.messageId) {
      await telegramEditCaption(env, user.id, p.messageId, `
✅ <b>Pembayaran Dikonfirmasi</b>
🆔 ID: <code>${p.transactionId}</code>
💰 Nominal: <code>Rp ${formatNumber(p.nominal)}</code>
🎁 Bonus: <code>Rp ${formatNumber(bonus)}</code>
💳 Saldo Sekarang: <code>Rp ${formatNumber(users[uid].saldo)}</code>
`);
    }

    // notify admin & log
    await telegramSend(env, env.ADMIN_ID, `<b>✅ Pembayaran Dikonfirmasi</b>\n> 👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')}\n> 🆔 User ID: ${user.id}\n> 🧾 Id Transaksi: ${p.transactionId}\n> 💰 Nominal: Rp ${formatNumber(p.nominal)}\n> 🎁 Bonus: Rp ${formatNumber(bonus)}`);
    await sendLog(env, '📥 Deposit Sukses', [
      `👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')} (ID: ${user.id})`,
      `Id Transaksi: ${p.transactionId}`,
      `Nominal: Rp ${formatNumber(p.nominal)}`,
      `Bonus: Rp ${formatNumber(bonus)}`,
      `Waktu: ${niceTime(new Date())}`
    ]);

    // increment stats
    await incrStatSuccess(env, 1);

    await answerCallback(env, cb.id, '✅ Pembayaran dikonfirmasi.', true);

  } catch (e) {
    console.error('handleConfirmPayment error', e);
    await answerCallback(env, cb.id, `❌ Terjadi kesalahan: ${e.message}`, true);
  }
}

async function handleCancelPayment(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  const p = await getPendingPayment(env, user.id);
  if (!p) {
    await answerCallback(env, cb.id, '❌ Tidak ada pembayaran pending.', true);
    return;
  }
  await removePendingPayment(env, user.id);
  if (p.messageId) {
    await telegramEditCaption(env, user.id, p.messageId, `❌ <b>Pembayaran Dibatalkan</b>\nID: <code>${p.transactionId}</code>`);
  }
  await telegramSend(env, env.ADMIN_ID, `<b>❌ Pembayaran Dibatalkan</b>\n> 👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')}\n> 🆔 User ID: ${user.id}\n> 🧾 ID: ${p.transactionId}`);
  await sendLog(env, '❌ Pembayaran Dibatalkan', [
    `👤 Username: ${user.username ? `@${user.username}` : (user.first_name || 'Pengguna')} (ID: ${user.id})`,
    `ID Trans: ${p.transactionId}`,
    `Waktu: ${niceTime(new Date())}`
  ]);
  await answerCallback(env, cb.id, '❌ Pembayaran dibatalkan.', true);
}

// -------------------------------
// Admin UI (/nexus) and handling (inline keyboard heavy)
// -------------------------------
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
function backButton(data = 'nexus_main') { return { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: data }]] }; }

async function handleNexusCommand(update, env) {
  const user = update.message.from;
  if (user.id.toString() !== env.ADMIN_ID) {
    return await telegramSend(env, user.id, '❌ Akses ditolak. Hanya admin.');
  }
  const users = await loadDB(env, 'users');
  const total = Object.keys(users).length;
  return await telegramSend(env, user.id, adminMenuTemplate(total), nexusMainKeyboard());
}

async function handleNexusCallback(update, env) {
  const cb = update.callback_query;
  const user = cb.from;
  if (user.id.toString() !== env.ADMIN_ID) {
    await answerCallback(env, cb.id, '❌ Akses ditolak', true);
    return;
  }
  const data = cb.data;
  await answerCallback(env, cb.id);

  // main
  if (data === 'nexus_main') {
    const users = await loadDB(env, 'users');
    const total = Object.keys(users).length;
    return await telegramEditText(env, user.id, cb.message.message_id, adminMenuTemplate(total), nexusMainKeyboard());
  }

  // user control submenu
  if (data === 'nexus_user') {
    const kb = { inline_keyboard: [
      [{ text: "🚫 Ban User", callback_data: "nexus_user_ban" }, { text: "✅ Unban User", callback_data: "nexus_user_unban" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>👥 Kontrol User</b>\nPilih tindakan:`, kb);
  }

  if (data === 'nexus_saldo') {
    const kb = { inline_keyboard: [
      [{ text: "➕ Tambah Saldo", callback_data: "nexus_saldo_add" }, { text: "➖ Kurangi Saldo", callback_data: "nexus_saldo_sub" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>💰 Manajemen Saldo</b>\nKirim ID dan jumlah setelah pilih (format akan muncul).`, kb);
  }

  if (data === 'nexus_stok') {
    const kb = { inline_keyboard: [
      [{ text: "➕ Tambah Akun", callback_data: "nexus_stok_add" }, { text: "🗑️ Hapus Akun", callback_data: "nexus_stok_del" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>📦 Manajemen Stok</b>\nTambahkan / hapus akun produk.`, kb);
  }

  if (data === 'nexus_transaksi') {
    const kb = { inline_keyboard: [
      [{ text: "⏰ Cek Pending Payments", callback_data: "nexus_transaksi_pending" }, { text: "❌ Batalkan Deposit", callback_data: "nexus_transaksi_cancel" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🧾 Transaksi Admin</b>\nPilih tindakan:`, kb);
  }

  if (data === 'nexus_bonus') {
    const cfg = await loadConfig(env);
    const mode = cfg.bonus && cfg.bonus.mode ? cfg.bonus.mode : 'percent';
    const percent = cfg.bonus && cfg.bonus.percent ? cfg.bonus.percent : 0;
    const ranges = cfg.bonus && cfg.bonus.ranges ? cfg.bonus.ranges : [];
    const text = `<b>🎁 Bonus Deposit</b>\nMode: <b>${mode}</b>\nPercent: <code>${percent}%</code>\nRanges: <code>${ranges.length} item</code>\n\nGunakan tombol atau balas pesan untuk input.`;
    const kb = { inline_keyboard: [
      [{ text: "Set Percent", callback_data: "nexus_bonus_setpercent" }, { text: "Add Range", callback_data: "nexus_bonus_addrange" }],
      [{ text: "Clear Ranges", callback_data: "nexus_bonus_clearranges" }, { text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, text, kb);
  }

  if (data === 'nexus_spam') {
    const cfg = await loadConfig(env);
    const spam = cfg.spam || { limit: 10, window: 10 };
    const text = `<b>🚫 Anti-Spam</b>\nLimit: <code>${spam.limit}</code> pesan / <code>${spam.window}</code> detik\n\nGunakan /setspam <limit> <windowSeconds> atau tombol.`;
    return await telegramEditText(env, user.id, cb.message.message_id, text, backButton('nexus_main'));
  }

  if (data === 'nexus_broadcast') {
    const kb = { inline_keyboard: [
      [{ text: "🔤 Kirim ke Semua", callback_data: "nexus_broadcast_all" }, { text: "🔢 Kirim ke ID", callback_data: "nexus_broadcast_ids" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>📢 Broadcast</b>\nBalas pesan ini dengan /broadcast atau gunakan tombol.`, kb);
  }

  if (data === 'nexus_config') {
    const kb = { inline_keyboard: [
      [{ text: "🔔 Set Log Grup", callback_data: "nexus_config_setnotif" }, { text: "🔁 Reset Config", callback_data: "nexus_config_reset" }],
      [{ text: "🔙 Kembali", callback_data: "nexus_main" }]
    ]};
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🔧 Konfigurasi</b>\nAtur log group / reset config.`, kb);
  }

  if (data === 'nexus_pending') {
    const pend = await loadPendingPayments(env);
    const keys = Object.keys(pend);
    if (keys.length === 0) {
      return await telegramEditText(env, user.id, cb.message.message_id, `<b>⏰ Pending Payments</b>\nTidak ada pending saat ini.`, backButton('nexus_main'));
    }
    const now = new Date();
    const lines = keys.map(uid => {
      const p = pend[uid];
      const paymentTime = new Date(p.timestamp);
      const diff = Math.floor((now - paymentTime) / (1000*60));
      const left = Math.max(0, 10 - diff);
      return `> ${uid} - ${p.transactionId} - Rp ${formatNumber(p.finalNominal)} (${left}m left)`;
    }).join('\n');
    const text = `<b>⏰ Pending Payments</b>\n${lines}`;
    return await telegramEditText(env, user.id, cb.message.message_id, text, backButton('nexus_main'));
  }

  if (data === 'nexus_uptime') {
    const up = formatUptime(Date.now() - START_TIME);
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>⏱️ Uptime</b>\n${up}`, backButton('nexus_main'));
  }

  // sub-actions that start admin sessions
  if (data === 'nexus_user_ban') {
    userSessions.set(user.id, { action: 'ban_user' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🚫 Ban User</b>\nKirim ID User dan alasan (opsional):\n<code>123456 alasan</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_user_unban') {
    userSessions.set(user.id, { action: 'unban_user' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>✅ Unban User</b>\nKirim ID User untuk di-unban:`, backButton('nexus_main'));
  }
  if (data === 'nexus_saldo_add') {
    userSessions.set(user.id, { action: 'tambah_saldo' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>➕ Tambah Saldo</b>\nKirim: <code>id jumlah</code>\nContoh: <code>12345 20000</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_saldo_sub') {
    userSessions.set(user.id, { action: 'kurangi_saldo' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>➖ Kurangi Saldo</b>\nKirim: <code>id jumlah</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_stok_add') {
    userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>➕ Tambah Akun</b>\nKetik nama produk:`, backButton('nexus_main'));
  }
  if (data === 'nexus_stok_del') {
    userSessions.set(user.id, { action: 'hapus_akun' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🗑️ Hapus Akun</b>\nKirim email/username akun yang ingin dihapus:`, backButton('nexus_main'));
  }
  if (data === 'nexus_transaksi_cancel') {
    userSessions.set(user.id, { action: 'admin_cancel_deposit' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>❌ Batalkan Deposit</b>\nKirim ID user yang ingin dibatalkan pending-nya:`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_setpercent') {
    userSessions.set(user.id, { action: 'set_bonus_percent' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>Set Bonus Percent</b>\nKirim angka persen, mis: <code>10</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_addrange') {
    userSessions.set(user.id, { action: 'add_bonus_range' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>Tambah Range Bonus</b>\nFormat: <code>min max bonus</code>\nContoh: <code>20000 50000 5000</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_bonus_clearranges') {
    const cfg = await loadConfig(env);
    cfg.bonus = { mode: 'percent', percent: cfg.bonus.percent || 0, ranges: [] };
    await saveConfig(env, cfg);
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>✅ Semua range bonus dihapus. Mode set ke percent (${cfg.bonus.percent || 0}%).</b>`, backButton('nexus_main'));
  }
  if (data === 'nexus_spam_set') {
    userSessions.set(user.id, { action: 'set_spam' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>Set Anti-Spam</b>\nKirim: <code>limit windowSeconds</code>\nContoh: <code>10 10</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_broadcast_all' || data === 'nexus_broadcast_ids') {
    userSessions.set(user.id, { action: data === 'nexus_broadcast_all' ? 'broadcast_all' : 'broadcast_ids' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>📢 Broadcast</b>\nBalas pesan ini dengan /broadcast (reply) atau kirim teks yang akan dibroadcast. Untuk ID gunakan format: /broadcast id1,id2`, backButton('nexus_main'));
  }
  if (data === 'nexus_config_setnotif') {
    userSessions.set(user.id, { action: 'set_notif' });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>🔔 Set Log Grup</b>\nKirim ID grup: <code>-1001234567890</code>`, backButton('nexus_main'));
  }
  if (data === 'nexus_config_reset') {
    await saveConfig(env, { bonus: { mode: 'percent', percent: 0, ranges: [] }, spam: { limit: 10, window: 10 }, logGroupId: null });
    return await telegramEditText(env, user.id, cb.message.message_id, `<b>✅ Config di-reset ke default.</b>`, backButton('nexus_main'));
  }

  // fallback
  return await telegramEditText(env, user.id, cb.message.message_id, `<b>Command belum diimplementasikan</b>`, backButton('nexus_main'));
}

// -------------------------------
// Admin session flow handler
// -------------------------------
async function handleAdminSessionMessage(update, env) {
  const message = update.message;
  const user = message.from;
  if (user.id.toString() !== env.ADMIN_ID) return;
  const session = userSessions.get(user.id);
  if (!session) return;

  const users = await loadDB(env, 'users');
  const accounts = await loadDB(env, 'accounts');
  const cfg = await loadConfig(env);

  try {
    switch (session.action) {
      case 'ban_user': {
        const parts = message.text.split(/\s+/);
        const target = parts[0];
        const reason = parts.slice(1).join(' ') || 'Dibanned oleh admin';
        if (!target) { await telegramSend(env, user.id, '❌ Format: <code>userId alasan</code>'); userSessions.delete(user.id); return; }
        await addBan(env, target, reason);
        await telegramSend(env, user.id, `✅ User ${target} dibanned.`);
        try { await telegramSend(env, parseInt(target), `❌ Anda diblokir oleh admin.\nAlasan: ${reason}`); } catch (e) {}
        await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'unban_user': {
        const target = message.text.trim();
        if (!target) { await telegramSend(env, user.id, '❌ Kirim ID user'); userSessions.delete(user.id); return; }
        await removeBan(env, target);
        await telegramSend(env, user.id, `✅ User ${target} di-unban.`);
        try { await telegramSend(env, parseInt(target), `✅ Akun Anda telah dibuka kembali oleh admin.`); } catch (e) {}
        await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'tambah_saldo': {
        const [target, amountStr] = message.text.trim().split(/\s+/);
        const amount = parseInt(amountStr);
        if (!target || isNaN(amount)) { await telegramSend(env, user.id, '❌ Format: <code>id jumlah</code>'); userSessions.delete(user.id); return; }
        if (!users[target]) users[target] = { saldo: 0 };
        users[target].saldo += amount;
        await saveDB(env, users, 'users');
        await telegramSend(env, user.id, `✅ Saldo ditambahkan ke ${target}: Rp ${formatNumber(amount)}`);
        try { await telegramSend(env, parseInt(target), `✅ Saldo Anda bertambah: Rp ${formatNumber(amount)}`); } catch (e) {}
        await sendLog(env, '💰 Tambah Saldo', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Jumlah: Rp ${formatNumber(amount)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'kurangi_saldo': {
        const [target, amountStr] = message.text.trim().split(/\s+/);
        const amount = parseInt(amountStr);
        if (!target || isNaN(amount)) { await telegramSend(env, user.id, '❌ Format: <code>id jumlah</code>'); userSessions.delete(user.id); return; }
        if (!users[target]) users[target] = { saldo: 0 };
        users[target].saldo -= amount;
        if (users[target].saldo < 0) users[target].saldo = 0;
        await saveDB(env, users, 'users');
        await telegramSend(env, user.id, `✅ Saldo dikurangi dari ${target}: Rp ${formatNumber(amount)}`);
        try { await telegramSend(env, parseInt(target), `❗ Saldo Anda dikurangi: Rp ${formatNumber(amount)}`); } catch (e) {}
        await sendLog(env, '➖ Kurangi Saldo', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Jumlah: Rp ${formatNumber(amount)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'tambah_akun': {
        const step = session.step;
        const data = session.data || {};
        if (step === 'nama') {
          data.name = message.text.trim();
          session.step = 'email';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env, user.id, '<b>Masukkan username/email</b>');
          return;
        } else if (step === 'email') {
          data.email = message.text.trim();
          session.step = 'password';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env, user.id, '<b>Masukkan password</b>');
          return;
        } else if (step === 'password') {
          data.password = message.text.trim();
          session.step = 'harga';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env, user.id, '<b>Masukkan harga (angka)</b>');
          return;
        } else if (step === 'harga') {
          const price = parseInt(message.text.replace(/\D/g,''));
          if (isNaN(price)) { await telegramSend(env, user.id, '❌ Harga harus angka'); userSessions.delete(user.id); return; }
          data.price = price;
          session.step = 'deskripsi';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env, user.id, `<b>Masukkan deskripsi produk</b>`);
          return;
        } else if (step === 'deskripsi') {
          data.description = message.text.trim();
          session.step = 'note';
          session.data = data;
          userSessions.set(user.id, session);
          await telegramSend(env, user.id, `<b>Masukkan catatan (atau ketik 'tidak ada')</b>`);
          return;
        } else if (step === 'note') {
          data.note = message.text.trim().toLowerCase() !== 'tidak ada' ? message.text.trim() : 'Tidak ada catatan';
          accounts[data.email] = data;
          await saveDB(env, accounts, 'accounts');
          await telegramSend(env, user.id, `<b>✅ Akun berhasil ditambahkan</b>\nNama: <code>${data.name}</code>\nEmail: <code>${data.email}</code>\nHarga: Rp ${formatNumber(data.price)}`);
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
          await saveDB(env, accounts, 'accounts');
          await telegramSend(env, user.id, '✅ Akun berhasil dihapus.');
          await sendLog(env, '🗑️ Hapus Akun', [`Admin: ${env.ADMIN_ID}`, `Akun: ${key}`, `Waktu: ${niceTime(new Date())}`]);
        } else {
          await telegramSend(env, user.id, '❌ Akun tidak ditemukan.');
        }
        userSessions.delete(user.id);
        return;
      }
      case 'admin_cancel_deposit': {
        const target = message.text.trim();
        if (!target) { await telegramSend(env, user.id, '❌ Kirim ID user'); userSessions.delete(user.id); return; }
        const pend = await getPendingPayment(env, target);
        if (!pend) { await telegramSend(env, user.id, '⚠️ Tidak ada pending untuk user tersebut'); userSessions.delete(user.id); return; }
        if (pend.messageId) {
          try { await telegramEditCaption(env, parseInt(target), pend.messageId, `❌ <b>Pembayaran Dibatalkan oleh Admin</b>\nID: <code>${pend.transactionId}</code>`); } catch(e) {}
        }
        await removePendingPayment(env, target);
        await telegramSend(env, user.id, `✅ Pending deposit untuk ${target} dibatalkan.`);
        try { await telegramSend(env, parseInt(target), `❌ Pembayaran Anda dibatalkan oleh admin.`); } catch (e) {}
        await sendLog(env, '❌ Admin Batalkan Deposit', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Trans: ${pend.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_bonus_percent': {
        const val = parseFloat(message.text.trim());
        if (isNaN(val)) { await telegramSend(env, user.id, '❌ Kirim angka persen'); userSessions.delete(user.id); return; }
        cfg.bonus = cfg.bonus || { mode: 'percent', percent: 0, ranges: [] };
        cfg.bonus.mode = 'percent';
        cfg.bonus.percent = val;
        await saveConfig(env, cfg);
        await telegramSend(env, user.id, `✅ Bonus percent diset: ${val}%`);
        await sendLog(env, '🎁 Set Bonus Percent', [`Admin: ${env.ADMIN_ID}`, `Percent: ${val}%`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'add_bonus_range': {
        const parts = message.text.trim().split(/\s+/);
        const min = parseInt(parts[0]), max = parseInt(parts[1]), bonus = parseInt(parts[2]);
        if (isNaN(min) || isNaN(max) || isNaN(bonus)) { await telegramSend(env, user.id, '❌ Format: min max bonus'); userSessions.delete(user.id); return; }
        cfg.bonus = cfg.bonus || { mode: 'range', percent: 0, ranges: [] };
        cfg.bonus.mode = 'range';
        cfg.bonus.ranges = cfg.bonus.ranges || [];
        cfg.bonus.ranges.push({ min, max, bonus });
        await saveConfig(env, cfg);
        await telegramSend(env, user.id, `✅ Range ditambahkan: ${min}-${max} => Rp ${formatNumber(bonus)}`);
        await sendLog(env, '🎁 Add Bonus Range', [`Admin: ${env.ADMIN_ID}`, `Range: ${min}-${max}`, `Bonus: Rp ${formatNumber(bonus)}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_spam': {
        const parts = message.text.trim().split(/\s+/);
        const limit = parseInt(parts[0]), window = parseInt(parts[1]);
        if (isNaN(limit) || isNaN(window)) { await telegramSend(env, user.id, '❌ Format: limit windowSeconds'); userSessions.delete(user.id); return; }
        cfg.spam = { limit, window };
        await saveConfig(env, cfg);
        await telegramSend(env, user.id, `✅ Anti-spam diset: ${limit} msgs / ${window}s`);
        await sendLog(env, '🚫 Set Anti-Spam', [`Admin: ${env.ADMIN_ID}`, `Limit: ${limit}`, `Window: ${window}s`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'set_notif': {
        const gid = message.text.trim();
        if (!gid) { await telegramSend(env, user.id, '❌ Kirim ID grup'); userSessions.delete(user.id); return; }
        cfg.logGroupId = gid;
        await saveConfig(env, cfg);
        await telegramSend(env, user.id, `✅ ID grup log disimpan: ${gid}`);
        await sendLog(env, '🔔 Set Log Group', [`Admin: ${env.ADMIN_ID}`, `Group: ${gid}`, `Waktu: ${niceTime(new Date())}`]);
        userSessions.delete(user.id);
        return;
      }
      case 'broadcast_all': {
        const content = message.text;
        const allUsers = await loadDB(env, 'users');
        const ids = Object.keys(allUsers);
        let success = 0, fail = 0;
        for (const id of ids) {
          try { await telegramSend(env, parseInt(id), content); success++; } catch (e) { fail++; }
          await new Promise(res => setTimeout(res, 80));
        }
        await telegramSend(env, user.id, `✅ Broadcast selesai. Success: ${success}, Fail: ${fail}`);
        userSessions.delete(user.id);
        return;
      }
      case 'broadcast_ids': {
        const raw = message.text.split('\n');
        const idsPart = raw[0].trim();
        const msgPart = raw.slice(1).join('\n').trim();
        const ids = idsPart.split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length || !msgPart) { await telegramSend(env, user.id, '❌ Format: id1,id2,...\\nPesan'); userSessions.delete(user.id); return; }
        let s = 0, f = 0;
        for (const id of ids) {
          try { await telegramSend(env, parseInt(id), msgPart); s++; } catch (e) { f++; }
        }
        await telegramSend(env, user.id, `✅ Broadcast selesai. Success: ${s}, Fail: ${f}`);
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
    await telegramSend(env, user.id, `❌ Terjadi kesalahan: ${e.message}`);
  }
}

// -------------------------------
// Cleanup expired pending payments
// -------------------------------
async function cleanupExpiredPayments(env) {
  try {
    const pending = await loadPendingPayments(env);
    const now = new Date();
    for (const [uid, p] of Object.entries(pending)) {
      const paymentTime = new Date(p.timestamp);
      if ((now - paymentTime) / (1000*60) > 10) {
        if (p.messageId) {
          try { await telegramEditCaption(env, parseInt(uid), p.messageId, `❌ <b>Pembayaran Expired</b>\nID: <code>${p.transactionId}</code>`); } catch(e){}
        }
        await removePendingPayment(env, uid);
        await telegramSend(env, env.ADMIN_ID, `<b>⏰ Pending payment expired</b>\n> User: ${uid}\n> Trans: ${p.transactionId}`);
        await sendLog(env, '⏰ Pending Expired', [`User: ${uid}`, `Trans: ${p.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
      }
    }
  } catch (e) {
    console.error('cleanupExpiredPayments error', e);
  }
}

// -------------------------------
// Router main
// -------------------------------
router.post('/', async (request, env) => {
  try {
    const update = await request.json();

    // cleanup expired pending payments
    await cleanupExpiredPayments(env);

    // callbacks
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;

      // nexus admin callbacks
      if (data && data.startsWith('nexus')) {
        return new Response(JSON.stringify(await handleNexusCallback(update, env)));
      }

      // user flows
      if (data === 'beli_akun') return new Response(JSON.stringify(await handleBeliAkunCallback(update, env)));
      if (data && data.startsWith('group_')) return new Response(JSON.stringify(await handleDetailAkun(update, env)));
      if (data && data.startsWith('beli_')) return new Response(JSON.stringify(await handleProsesPembelian(update, env)));
      if (data === 'deposit') return new Response(JSON.stringify(await handleDepositCallback(update, env)));
      if (data && data.startsWith('confirm_payment_')) return new Response(JSON.stringify(await handleConfirmPayment(update, env)));
      if (data === 'cancel_payment') return new Response(JSON.stringify(await handleCancelPayment(update, env)));

      // fallback
      return new Response('OK');
    }

    // messages
    if (update.message) {
      const text = update.message.text || '';
      const user = update.message.from;

      // handle admin session messages
      if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) {
        await handleAdminSessionMessage(update, env);
        return new Response(JSON.stringify({ ok: true }));
      }

      // commands that don't require nexus
      if (text.startsWith('/nexus')) {
        return new Response(JSON.stringify(await handleNexusCommand(update, env)));
      }
      if (text.startsWith('/setnotif')) {
        if (user.id.toString() !== env.ADMIN_ID) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Akses ditolak')));
        const parts = text.split(/\s+/);
        const gid = parts[1];
        if (!gid) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /setnotif <id_grup>')));
        const cfg = await loadConfig(env);
        cfg.logGroupId = gid;
        await saveConfig(env, cfg);
        await telegramSend(env, user.id, `✅ ID grup log disimpan: ${gid}`);
        return new Response(JSON.stringify({ ok: true }));
      }
      if (text.startsWith('/uptime')) {
        const up = formatUptime(Date.now() - START_TIME);
        return new Response(JSON.stringify(await telegramSend(env, user.id, `⏱️ Uptime: ${up}`)));
      }

      // admin quick text commands for convenience
      if (user.id.toString() === env.ADMIN_ID) {
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();

        if (cmd === '/ban') {
          const target = parts[1];
          const reason = parts.slice(2).join(' ') || 'Dibanned oleh admin';
          if (!target) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /ban <userId> [reason]')));
          await addBan(env, target, reason);
          await telegramSend(env, user.id, `✅ User ${target} dibanned.`);
          try { await telegramSend(env, parseInt(target), `❌ Anda diblokir oleh admin.\nAlasan: ${reason}`); } catch(e){}
          await sendLog(env, '🚫 Ban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Alasan: ${reason}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/unban') {
          const target = parts[1];
          if (!target) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /unban <userId>')));
          await removeBan(env, target);
          await telegramSend(env, user.id, `✅ User ${target} di-unban.`);
          try { await telegramSend(env, parseInt(target), `✅ Akun Anda telah dibuka kembali oleh admin.`); } catch(e){}
          await sendLog(env, '✅ Unban User', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/canceldeposit') {
          const target = parts[1];
          if (!target) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /canceldeposit <userId>')));
          const pend = await getPendingPayment(env, target);
          if (!pend) return new Response(JSON.stringify(await telegramSend(env, user.id, '⚠️ Tidak ada pending untuk user tersebut')));
          if (pend.messageId) { try { await telegramEditCaption(env, parseInt(target), pend.messageId, `❌ <b>Pembayaran Dibatalkan oleh Admin</b>\nID: <code>${pend.transactionId}</code>`); } catch(e){} }
          await removePendingPayment(env, target);
          await telegramSend(env, user.id, `✅ Pending deposit untuk ${target} dibatalkan.`);
          try { await telegramSend(env, parseInt(target), `❌ Pembayaran Anda dibatalkan oleh admin.`); } catch(e){}
          await sendLog(env, '❌ Admin Batalkan Deposit', [`Admin: ${env.ADMIN_ID}`, `Target: ${target}`, `Trans: ${pend.transactionId}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/setbonuspercent') {
          const val = parseFloat(parts[1]);
          if (isNaN(val)) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /setbonuspercent <percent>')));
          const cfg = await loadConfig(env);
          cfg.bonus = cfg.bonus || { mode: 'percent', percent: 0, ranges: [] };
          cfg.bonus.mode = 'percent';
          cfg.bonus.percent = val;
          await saveConfig(env, cfg);
          await telegramSend(env, user.id, `✅ Bonus percent diset: ${val}%`);
          await sendLog(env, '🎁 Set Bonus Percent', [`Admin: ${env.ADMIN_ID}`, `Percent: ${val}%`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/addrangebonus') {
          const min = parseInt(parts[1]), max = parseInt(parts[2]), bonus = parseInt(parts[3]);
          if (isNaN(min) || isNaN(max) || isNaN(bonus)) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /addrangebonus <min> <max> <bonus>')));
          const cfg = await loadConfig(env);
          cfg.bonus = cfg.bonus || { mode: 'range', percent: 0, ranges: [] };
          cfg.bonus.mode = 'range';
          cfg.bonus.ranges = cfg.bonus.ranges || [];
          cfg.bonus.ranges.push({ min, max, bonus });
          await saveConfig(env, cfg);
          await telegramSend(env, user.id, `✅ Range ditambahkan: ${min}-${max} => Rp ${formatNumber(bonus)}`);
          await sendLog(env, '🎁 Add Bonus Range', [`Admin: ${env.ADMIN_ID}`, `Range: ${min}-${max}`, `Bonus: Rp ${formatNumber(bonus)}`, `Waktu: ${niceTime(new Date())}`]);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/clearrangebonus') {
          const cfg = await loadConfig(env);
          cfg.bonus = { mode: 'percent', percent: cfg.bonus.percent || 0, ranges: [] };
          await saveConfig(env, cfg);
          await telegramSend(env, user.id, `✅ Semua range bonus dihapus.`);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (cmd === '/setspam') {
          const limit = parseInt(parts[1]), window = parseInt(parts[2]);
          if (isNaN(limit) || isNaN(window)) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Usage: /setspam <limit> <windowSeconds>')));
          const cfg = await loadConfig(env);
          cfg.spam = { limit, window };
          await saveConfig(env, cfg);
          await telegramSend(env, user.id, `✅ Anti-spam diset: ${limit} msgs / ${window}s`);
          return new Response(JSON.stringify({ ok: true }));
        }
      }

      // anti-spam check for non-admin regular text
      if (!text.startsWith('/') && user.id.toString() !== env.ADMIN_ID) {
        const banned = await checkAntiSpam(env, user.id.toString(), user.username);
        if (banned) {
          await telegramSend(env, user.id, '❌ Anda diblokir sementara karena aktivitas spam. Hubungi admin jika keliru.');
          return new Response(JSON.stringify({ ok: true }));
        }
      }

      // standard commands
      if (text.startsWith('/start')) return new Response(JSON.stringify(await handleStart(update, env)));
      if (text.startsWith('/id')) return new Response(JSON.stringify(await handleGetId(update, env)));
      if (text.startsWith('/broadcast')) {
        if (user.id.toString() !== env.ADMIN_ID) return new Response(JSON.stringify(await telegramSend(env, user.id, '❌ Akses ditolak')));
        if (!update.message.reply_to_message && text.indexOf(' ') === -1) {
          return new Response(JSON.stringify(await telegramSend(env, user.id, '⚠️ Balas pesan yang ingin di-broadcast atau gunakan /broadcast id1,id2')));
        }
        const reply = update.message.reply_to_message;
        const specificIds = text.split(' ')[1]?.split(',').filter(Boolean) || [];
        const allUsers = await loadDB(env, 'users');
        const targets = specificIds.length ? specificIds : Object.keys(allUsers);
        let s=0,f=0;
        for (const t of targets) {
          try {
            if (reply && reply.text) await telegramSend(env, parseInt(t), reply.text);
            else await telegramSend(env, parseInt(t), '📢 Broadcast dari admin');
            s++;
          } catch (e) { f++; }
          await new Promise(r => setTimeout(r, 80));
        }
        await telegramSend(env, user.id, `✅ Broadcast selesai. Success: ${s}, Fail: ${f}`);
        return new Response(JSON.stringify({ ok: true }));
      }

      // non-command text: deposit flow
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

export default { fetch: router.handle };
