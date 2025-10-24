 import { Router } from 'itty-router'; // Pastikan ini ada

const router = Router();

// In-memory storage untuk sessions (sementara)
const userSessions = new Map();

// --- (BAGIAN 1: HELPER FUNCTIONS) ---
// (Fungsi loadDB, saveDB, loadPendingPayments, dll. TETAP SAMA)

async function loadDB(binding, dbType) {
    try {
        const data = await binding.get(dbType, 'json');
        return data || {};
    } catch (error) { console.error(`Error loading ${dbType} from KV:`, error); return {}; }
}

async function saveDB(binding, data, dbType) {
    try {
        await binding.put(dbType, JSON.stringify(data));
        return true;
    } catch (error) { console.error(`Error saving ${dbType} to KV:`, error); return false; }
}

async function loadPendingPayments(binding) {
    try {
        const data = await binding.get('pending_payments', 'json');
        return data || {};
    } catch (error) { console.error('Error loading pending_payments from KV:', error); return {}; }
}

async function savePendingPayment(binding, userId, paymentData) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        pendingPayments[String(userId)] = { ...paymentData, timestamp: paymentData.timestamp.toISOString() };
        await binding.put('pending_payments', JSON.stringify(pendingPayments));
        return true;
    } catch (error) { console.error('Error saving pending payment:', error); return false; }
}

async function removePendingPayment(binding, userId) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        const userIdStr = String(userId);
        if (pendingPayments[userIdStr]) {
            delete pendingPayments[userIdStr];
            await binding.put('pending_payments', JSON.stringify(pendingPayments));
        }
        return true;
    } catch (error) { console.error('Error removing pending payment:', error); return false; }
}

async function getPendingPayment(binding, userId) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        const userIdStr = String(userId);
        const payment = pendingPayments[userIdStr];
        if (payment) { return { ...payment, timestamp: new Date(payment.timestamp) }; }
        return null;
    } catch (error) { console.error('Error getting pending payment:', error); return null; }
}

async function getConfig(binding) {
    try {
        const configData = await binding.get('config', 'json');
        const defaultConfig = { bonus_percentage: 0 };
        return configData && typeof configData === 'object' ? { ...defaultConfig, ...configData } : defaultConfig;
    } catch (error) { console.error('Error loading config from KV:', error); return { bonus_percentage: 0 }; }
}

async function saveConfig(binding, configData) {
    try {
        await binding.put('config', JSON.stringify(configData));
        return true;
    } catch (error) { console.error('Error saving config to KV:', error); return false; }
}

function formatNumber(num) {
    const number = Number(num);
    if (isNaN(number)) { return String(num); }
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function getRandomAmount(env) {
    const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1;
    const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: parseMode };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return await response.json();
    } catch (error) { console.error('Error sending Telegram message:', error); return null; }
}
async function sendTelegramPhoto(botToken, chatId, photoUrl, caption = '', replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    const payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: parseMode };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return await response.json();
    } catch (error) { console.error('Error sending Telegram photo:', error); return null; }
}
async function editMessageText(botToken, chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: parseMode };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return await response.json();
    } catch (error) { console.error('Error editing message text:', error); return null; }
}
async function editMessageCaption(botToken, chatId, messageId, caption, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/editMessageCaption`;
    const payload = { chat_id: chatId, message_id: messageId, caption: caption, parse_mode: parseMode };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return await response.json();
    } catch (error) { console.error('Error editing message caption:', error); return null; }
}
async function answerCallbackQuery(botToken, callbackQueryId, text = null, showAlert = false) {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    const payload = { callback_query_id: callbackQueryId };
    if (text) { payload.text = text; payload.show_alert = showAlert; }
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return await response.json();
    } catch (error) { console.error('Error answering callback query:', error); return null; }
}

async function sendLogNotification(env, type, userData, itemData) {
    const chatId = env.LOG_GROUP_ID;
    if (!chatId) return;
    let message = `🔔 <b>Log Transaksi Baru: ${type}</b>\n\n👤 <b>User:</b> <code>@${userData.username || 'N/A'}</code>\n🆔 <b>User ID:</b> <code>${userData.id}</code>\n`;
    if (type === 'PEMBELIAN') {
        message += `🛒 <b>Status:</b> ✅ Berhasil\n📦 <b>Produk:</b> ${itemData.name}\n💸 <b>Harga:</b> <code>Rp ${formatNumber(itemData.price)}</code>\n📧 <b>Akun:</b> <code>${itemData.email}</code> | <code>${itemData.password}</code>\n💳 <b>Sisa Saldo:</b> <code>Rp ${formatNumber(itemData.currentSaldo)}</code>`;
    } else if (type === 'DEPOSIT') {
        message += `💳 <b>Status:</b> ✅ Berhasil\n🆔 <b>ID Transaksi:</b> <code>${itemData.transactionId}</code>\n💰 <b>Nominal:</b> <code>Rp ${formatNumber(itemData.nominal)}</code>\n🎁 <b>Bonus (${itemData.bonusPercentage}%):</b> <code>Rp ${formatNumber(itemData.bonusAmount || 0)}</code>\n➡️ <b>Total Masuk:</b> <code>Rp ${formatNumber(itemData.totalAdded)}</code>\n➕ <b>Total Bayar:</b> <code>Rp ${formatNumber(itemData.finalNominal)}</code>\n💳 <b>Saldo Baru:</b> <code>Rp ${formatNumber(itemData.currentSaldo)}</code>`;
    }
    await sendTelegramMessage(env.BOT_TOKEN, chatId, message);
}

// --- (BAGIAN 2: LOGIKA BOT (Tampilan Keren)) ---
// (Semua fungsi handle...KEREN dari respons sebelumnya)

async function handleStart(update, env) {
    const user = update.message.from;
    const userId = user.id.toString();
    const userFirstName = user.first_name || user.username || "User";
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    if (!users[userId]) { users[userId] = { saldo: 0 }; await saveDB(env.BOT_DB, users, 'users'); }
    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "Bot Order Otomatis";
    const message = `Halo, <b>${userFirstName}</b>! 👋\n\nSelamat datang di <b>${botName}</b>.\nSistem order otomatis 24/7 untuk kebutuhan Anda.\n\n┌ <b>INFORMASI AKUN ANDA</b>\n├ 🆔 <b>User ID:</b> <code>${userId}</code>\n└ 💰 <b>Saldo:</b> <code>Rp ${formatNumber(saldo)}</code>\n\n┌ <b>INFORMASI BOT</b>\n├ 📦 <b>Stok Akun:</b> ${stok}\n└ 👨‍💼 <b>Bantuan:</b> ${adminUsername}\n\n👇 Silakan pilih menu di bawah ini untuk memulai:`;
    const keyboard = { inline_keyboard: [[{ text: "🛒 Beli Akun", callback_data: "beli_akun" }, { text: "💳 Deposit Saldo", callback_data: "deposit" }], [{ text: "🔄 Refresh", callback_data: "back_to_main" }]] };
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
}

async function handleGetId(update, env) {
    const user = update.message.from;
    const userId = user.id;
    const username = user.username;
    let message = username ? `🆔 <b>Informasi Akun Anda:</b>\n📄 <b>ID Pengguna:</b> <code>${userId}</code>\n👤 <b>Username:</b> <code>@${username}</code>` : `🆔 <b>Informasi Akun Anda:</b>\n📄 <b>ID Pengguna:</b> <code>${userId}</code>\n👤 <b>Username:</b> <i>(not found)</i>`;
    return await sendTelegramMessage(env.BOT_TOKEN, userId, message);
}

async function handleBeliAkunCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const users = await loadDB(env.BOT_DB, 'users');
    const saldo = users[userId]?.saldo || 0;
    if (Object.keys(accounts).length === 0) {
        const message = `⚠️ <b>STOK KOSONG</b> ⚠️\n\nMaaf, <b>${user.first_name}</b>, saat ini semua produk sedang habis.`;
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok produk kosong!", true);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, { inline_keyboard: [[{ text: "🔙 Kembali ke Menu", callback_data: "back_to_main" }]] });
    }
    const groupedAccounts = {};
    for (const [email, akun] of Object.entries(accounts)) { const key = `${akun.name}_${akun.price}`; if (!groupedAccounts[key]) groupedAccounts[key] = []; groupedAccounts[key].push(email); }
    const keyboardButtons = Object.entries(groupedAccounts).map(([key, emails]) => { const [name, price] = key.split('_'); const count = emails.length; const formattedPrice = formatNumber(parseInt(price)); return [{ text: `📦 ${name} | Rp ${formattedPrice} (Stok: ${count})`, callback_data: `group_${name}_${price}` }]; });
    const keyboard = { inline_keyboard: [...keyboardButtons, [{ text: "🔙 Kembali ke Menu", callback_data: "back_to_main" }]] };
    const message = `🛒 <b>DAFTAR PRODUK</b> 🛒\n\nSaldo Anda: <code>Rp ${formatNumber(saldo)}</code>\nTotal Stok Tersedia: <code>${Object.keys(accounts).length}</code>\n\nSilakan pilih produk:`;
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

async function handleDetailAkun(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const callbackData = callbackQuery.data;
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const users = await loadDB(env.BOT_DB, 'users');
    const saldo = users[userId]?.saldo || 0;
    const [, name, price] = callbackData.split('_');
    const priceInt = parseInt(price);
    const filteredAccounts = Object.entries(accounts).filter(([email, akun]) => akun.name === name && akun.price === priceInt);
    if (filteredAccounts.length === 0) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok item ini baru saja habis!", true);
        const message = `❌ <b>STOK HABIS</b>\nAkun yang Anda pilih baru saja habis.`;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, { inline_keyboard: [[{ text: "🛒 Kembali ke Daftar Produk", callback_data: "beli_akun" }]] });
    }
    const [email] = filteredAccounts[0];
    const akun = accounts[email];
    const message = `📄 <b>DETAIL & KONFIRMASI</b> 📄\n\n┌ <b>PRODUK</b>\n├ 📦 <b>Nama:</b> <code>${akun.name}</code>\n├ 💸 <b>Harga:</b> <code>Rp ${formatNumber(akun.price)}</code>\n└ 📝 <b>Deskripsi:</b>\n${akun.description}\n\n---\nSaldo Anda: <code>Rp ${formatNumber(saldo)}</code>\nStok Item Ini: ${filteredAccounts.length}\n\nTekan "✅ Beli Sekarang" untuk melanjutkan.`;
    const keyboard = { inline_keyboard: [[{ text: "✅ Beli Sekarang", callback_data: `beli_${email}` }, { text: "❌ Batal (Kembali)", callback_data: "beli_akun" }]] };
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

async function handleBackToMain(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const userFirstName = user.first_name || user.username || "User";
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "Bot Order Otomatis";
    const message = `Halo, <b>${userFirstName}</b>! 👋\n\nSelamat datang di <b>${botName}</b>.\nSistem order otomatis 24/7 untuk kebutuhan Anda.\n\n┌ <b>INFORMASI AKUN ANDA</b>\n├ 🆔 <b>User ID:</b> <code>${userId}</code>\n└ 💰 <b>Saldo:</b> <code>Rp ${formatNumber(saldo)}</code>\n\n┌ <b>INFORMASI BOT</b>\n├ 📦 <b>Stok Akun:</b> ${stok}\n└ 👨‍💼 <b>Bantuan:</b> ${adminUsername}\n\n👇 Silakan pilih menu di bawah ini untuk memulai:`;
    const keyboard = { inline_keyboard: [[{ text: "🛒 Beli Akun", callback_data: "beli_akun" }, { text: "💳 Deposit Saldo", callback_data: "deposit" }], [{ text: "🔄 Refresh", callback_data: "back_to_main" }]] };
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Menu diperbarui!");
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

async function handleProsesPembelian(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const callbackData = callbackQuery.data;
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const email = callbackData.split('_')[1];
    if (!accounts[email]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Akun sudah terjual!", true); const message = "<b>⚠️ Maaf, akun yang Anda pilih sudah terjual.</b>"; return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, { inline_keyboard: [[{ text: "🛒 Kembali ke Daftar Produk", callback_data: "beli_akun" }]] }); }
    const akun = accounts[email]; const harga = akun.price;
    if (!users[userId]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda belum terdaftar! Ketik /start", true); return; }
    const saldo = users[userId].saldo;
    if (saldo < harga) { const message = `<b>🚫 SALDO TIDAK CUKUP</b>\n\nMaaf, <b>${user.first_name}</b>, saldo Anda tidak cukup.\nHarga: <code>Rp ${formatNumber(harga)}</code>\nSaldo Anda: <code>Rp ${formatNumber(saldo)}</code>\n\nSilakan deposit.`; await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Saldo tidak cukup!", true); return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, { inline_keyboard: [[{ text: "💳 Deposit Saldo", callback_data: "deposit" }]] }); }
    users[userId].saldo -= harga; await saveDB(env.BOT_DB, users, 'users');
    delete accounts[email]; await saveDB(env.BOT_DB, accounts, 'accounts');
    const currentSaldo = users[userId].saldo;
    const akunStr = `🎉 <b>TRANSAKSI BERHASIL</b> 🎉\n\nTerima kasih, <b>${user.first_name}</b>!\nBerikut detail akun Anda:\n\n┌ <b>DETAIL AKUN</b>\n├ 📦 <b>Produk:</b> <code>${akun.name}</code>\n├ 📧 <b>Email/User:</b> <code>${akun.email}</code>\n├ 🔑 <b>Password:</b> <code>${akun.password}</code>\n└ 🗒️ <b>Catatan:</b> ${akun.note || 'Tidak ada catatan'}\n\n┌ <b>PEMBAYARAN</b>\n├ 💸 <b>Harga:</b> <code>Rp ${formatNumber(harga)}</code>\n└ 💰 <b>Sisa Saldo:</b> <code>Rp ${formatNumber(currentSaldo)}</code>\n\nSimpan baik-baik detail ini.`;
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Pembelian Berhasil!");
    const keyboard = { inline_keyboard: [[{ text: "🛒 Beli Lagi", callback_data: "beli_akun" }, { text: "🏠 Menu Utama", callback_data: "back_to_main" }]] };
    await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, akunStr, keyboard);
    const username = user.username || "null";
    const adminMessage = `🛒 <b>Penjualan Baru!</b>\n<b>User:</b> @${username} (<code>${userId}</code>)\n<b>Produk:</b> ${akun.name}\n<b>Harga:</b> Rp ${formatNumber(harga)}\n<b>Sisa Saldo:</b> Rp ${formatNumber(currentSaldo)}`;
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    await sendLogNotification(env, 'PEMBELIAN', user, { name: akun.name, price: akun.price, email: akun.email, password: akun.password, currentSaldo: currentSaldo });
}

async function handleDepositCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda masih memiliki deposit yang belum selesai.", true); return; }
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    const maxRandom = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    const config = await getConfig(env.BOT_DB);
    const bonusPercentage = config.bonus_percentage;
    userSessions.set(user.id, { action: 'awaiting_deposit_nominal' });
    let message = `💳 <b>DEPOSIT SALDO (QRIS OTOMATIS)</b>\n\n┌ <b>INFORMASI DEPOSIT</b>\n├ 💰 <b>Minimal:</b> <code>Rp ${formatNumber(minAmount)}</code>\n└ 🔢 <b>Kode Unik:</b> Akan ditambah 1-${maxRandom} Rupiah`;
    if (bonusPercentage > 0) { message += `\n├ 🎁 <b>Bonus:</b> Dapatkan bonus <b>${bonusPercentage}%</b>!`; }
    message += `\n\nSilakan balas pesan ini dengan <b>jumlah nominal</b>.\nContoh: <code>10000</code>`;
    const keyboard = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "back_to_main" }]] };
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

async function handleDepositMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;
    const session = userSessions.get(user.id);
    if (session?.action !== 'awaiting_deposit_nominal') { if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) return null; return null; }
    userSessions.delete(user.id);
    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) { const responseMessage = `⚠️ Anda masih memiliki deposit yang belum selesai.`; return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage); }
    try {
        const nominal = parseInt(text); const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
        if (isNaN(nominal) || nominal <= 0) { const responseMessage = "⚠️ Nominal tidak valid. Masukkan angka saja."; return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage); }
        if (nominal < minAmount) { const responseMessage = `⚠️ Minimal deposit adalah Rp ${formatNumber(minAmount)}.`; return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage); }
        await createQrisAndConfirm(env, user, nominal);
    } catch (error) { const responseMessage = "⚠️ Nominal tidak valid."; return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage); }
    return new Response('Processing QRIS'); // Indicate processing
}

async function createQrisAndConfirm(env, user, nominal) {
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    try {
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        const data = await response.json();
        if (data.status === "success") {
            const qrisUrl = data.data.download_url; const transactionId = data.data["kode transaksi"];
            const paymentData = { nominal: nominal, finalNominal: finalNominal, transactionId: transactionId, timestamp: new Date(), status: "pending", messageId: null };
            await savePendingPayment(env.BOT_DB, user.id, paymentData);
            const keyboard = { inline_keyboard: [[{ text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transactionId}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }]] };
            const caption = `⏳ <b>PENDING PAYMENT</b> ⏳\n\nTransfer <b>TEPAT</b> <code>Rp ${formatNumber(finalNominal)}</code>.\n\n┌ <b>DETAIL TAGIHAN</b>\n├ 🆔 <b>ID:</b> <code>${transactionId}</code>\n├ 💰 <b>Nominal:</b> <code>Rp ${formatNumber(nominal)}</code>\n├ 🔢 <b>Kode Unik:</b> <code>Rp ${randomAddition}</code>\n└ 💳 <b>TOTAL:</b> <b><code>Rp ${formatNumber(finalNominal)}</code></b>\n\nScan QRIS di atas.\nBayar sebelum <b>10 menit</b>.\n\nKlik "✅ Konfirmasi" jika <b>SUDAH</b> transfer.`;
            const sentMessage = await sendTelegramPhoto(env.BOT_TOKEN, user.id, qrisUrl, caption, keyboard);
            if (sentMessage && sentMessage.ok) { paymentData.messageId = sentMessage.result.message_id; await savePendingPayment(env.BOT_DB, user.id, paymentData); }
            const adminMessage = `⏳ <b>Deposit Pending</b>\nUser: @${user.username || 'N/A'} (<code>${user.id}</code>)\nID: <code>${transactionId}</code>\nTotal: <code>Rp ${finalNominal}</code>`;
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
        } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal membuat QRIS."); }
    } catch (error) { console.error('Error creating QRIS:', error); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error server saat membuat QRIS."); }
}

async function handleConfirmPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const callbackData = callbackQuery.data;
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit pending.", true); return; }
    const transactionId = callbackData.split('_')[2];
    if (paymentData.transactionId !== transactionId) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ ID transaksi tidak sesuai.", true); return; }
    const now = new Date(); const paymentTime = new Date(paymentData.timestamp); const diffMinutes = (now - paymentTime) / (1000 * 60);
    if (diffMinutes > 10) {
        await removePendingPayment(env.BOT_DB, userId);
        const expiredNotif = `⏳ <b>Pembayaran Expired</b>\nID: <code>${transactionId}</code>\nBatas waktu 10 menit terlewati.`;
        await sendTelegramMessage(env.BOT_TOKEN, userId, expiredNotif); // Kirim notif baru
        const expiredCaption = `❌ <b>PEMBAYARAN EXPIRED</b>\nID: <code>${transactionId}</code>\nExpired. Silakan deposit ulang.`;
        if (paymentData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, user.id, paymentData.messageId, expiredCaption); } catch (e) {} }
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran expired.", true); return;
    }
    try {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Mengecek pembayaran...");
        const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
        if (response.ok) {
            const data = await response.json();
            if (data.status === "success") {
                const payments = data.data || []; let paymentFound = false;
                for (const payment of payments) { if (payment && typeof payment === 'object' && payment.amount === paymentData.finalNominal) { paymentFound = true; break; } }
                if (paymentFound) {
                    const users = await loadDB(env.BOT_DB, 'users'); const config = await getConfig(env.BOT_DB); const userIdStr = userId.toString();
                    if (!users[userIdStr]) { users[userIdStr] = { saldo: 0 }; }
                    const bonusPercentage = config.bonus_percentage || 0; const bonusAmount = Math.floor(paymentData.nominal * (bonusPercentage / 100)); const totalAdded = paymentData.nominal + bonusAmount;
                    users[userIdStr].saldo += totalAdded; await saveDB(env.BOT_DB, users, 'users');
                    const formattedSaldo = formatNumber(users[userIdStr].saldo);
                    await removePendingPayment(env.BOT_DB, userId);
                    let newCaption = `✅ <b>DEPOSIT BERHASIL</b> ✅\n\nHalo <b>${user.first_name}</b>, saldo ditambahkan!\n\n┌ <b>RINGKASAN</b>\n├ 🆔 <b>ID:</b> <code>${transactionId}</code>\n├ 💸 <b>Nominal:</b> <code>Rp ${formatNumber(paymentData.nominal)}</code>`;
                    if (bonusAmount > 0) { newCaption += `\n├ 🎁 <b>Bonus (${bonusPercentage}%):</b> <code>Rp ${formatNumber(bonusAmount)}</code>\n➡️ <b>Total Masuk:</b> <code>Rp ${formatNumber(totalAdded)}</code>`; }
                    newCaption += `\n└ 💰 <b>Saldo Baru:</b> <b><code>Rp ${formattedSaldo}</code></b>\n\nTerima kasih! 😊`;
                    if (paymentData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, user.id, paymentData.messageId, newCaption); } catch (e) {} }
                    let adminMessage = `✅ <b>Deposit Sukses</b>\nUser: @${user.username || 'null'} (<code>${userId}</code>)\nID: <code>${transactionId}</code>\nNominal: <code>Rp ${formatNumber(paymentData.nominal)}</code>`;
                    if (bonusAmount > 0) { adminMessage += `\nBonus: <code>Rp ${formatNumber(bonusAmount)}</code>\nTotal Masuk: <code>Rp ${formatNumber(totalAdded)}</code>`; }
                    adminMessage += `\nSaldo Baru: <code>Rp ${formattedSaldo}</code>`;
                    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
                    await sendLogNotification(env, 'DEPOSIT', user, { transactionId: transactionId, nominal: paymentData.nominal, bonusPercentage: bonusPercentage, bonusAmount: bonusAmount, totalAdded: totalAdded, finalNominal: paymentData.finalNominal, currentSaldo: users[userIdStr].saldo });
                } else { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Pembayaran belum terdeteksi. Coba lagi.", true); }
            } else { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal cek API.", true); }
        } else { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal koneksi ke sistem pembayaran.", true); }
    } catch (error) { console.error('Error checking payment:', error); await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, `❌ Error: ${error.message}`, true); }
}

async function handleCancelPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit pending.", true); return; }
    const transactionId = paymentData.transactionId;
    await removePendingPayment(env.BOT_DB, userId);
    const newCaption = `❌ <b>PEMBAYARAN DIBATALKAN</b>\n\n🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>\nPembayaran dibatalkan.`;
    if (paymentData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, user.id, paymentData.messageId, newCaption); } catch(e) {} }
    const adminMessage = `❌ <b>Deposit Batal</b>\nUser: @${user.username || 'null'} (<code>${userId}</code>)\nID: <code>${transactionId}</code>`;
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran dibatalkan.", true);
}


// --- (BAGIAN 3: LOGIKA ADMIN) ---

async function handleAdmin(update, env) {
    const message = update.message;
    const user = message.from;
    if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); }
    const users = await loadDB(env.BOT_DB, 'users'); const accounts = await loadDB(env.BOT_DB, 'accounts'); const config = await getConfig(env.BOT_DB);
    const totalMembers = Object.keys(users).length; const totalStok = Object.keys(accounts).length; const currentBonus = config.bonus_percentage || 0;
    const keyboard = { inline_keyboard: [[{ text: "➕ Tmbh Saldo", callback_data: "admin_tambah_saldo" }, { text: "➖ Krg Saldo", callback_data: "admin_kurangi_saldo" }], [{ text: "🛒 Tmbh Akun", callback_data: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", callback_data: "admin_hapus_akun" }], [{ text: "👥 Cek Member", callback_data: "admin_cek_member" }, { text: "📢 Broadcast", callback_data: "admin_broadcast" }], [{ text: "⏰ Cek Pending", callback_data: "admin_cek_pending" }, { text: `⚙️ Bonus (${currentBonus}%)`, callback_data: "admin_set_bonus" }]] };
    const adminMessage = `👮‍♂️ <b>PANEL ADMIN</b> 👮‍♂️\n\nHalo <b>${user.first_name}</b>!\n\n┌ INFO\n├ 👥 Member: <code>${totalMembers}</code>\n├ 📦 Stok: <code>${totalStok}</code>\n└ 🎁 Bonus: <code>${currentBonus}%</code>\n\nPilih aksi:`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMessage, keyboard);
}

async function handleAdminActions(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const callbackData = callbackQuery.data;
    if (user.id.toString() !== env.ADMIN_ID) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Akses ditolak!", true); return; }
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    let message = ""; let keyboard_submenu = { inline_keyboard: [[{ text: "🔙 Kembali ke Panel Admin", callback_data: "admin_back" }]] };

    switch (callbackData) {
        case "admin_tambah_saldo": message = `📝 <b>Tambah Saldo</b>\nFormat: <code>id jumlah</code>`; userSessions.set(user.id, { action: 'tambah_saldo' }); break;
        case "admin_kurangi_saldo": message = `📝 <b>Kurangi Saldo</b>\nFormat: <code>id jumlah</code>`; userSessions.set(user.id, { action: 'kurangi_saldo' }); break;
        case "admin_tambah_akun": message = `🛒 <b>Tambah Akun</b>\nMasukkan <b>nama produk</b>:`; userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} }); break;
        case "admin_hapus_akun": message = `🗑️ <b>Hapus Akun</b>\nMasukkan <b>email/username</b> akun:`; userSessions.set(user.id, { action: 'hapus_akun' }); break;
        case "admin_cek_member": const users = await loadDB(env.BOT_DB, 'users'); const totalMember = Object.keys(users).length; if (totalMember === 0) { message = "⚠️ Tidak ada member."; } else { const maxIdLength = Math.max(1, ...Object.keys(users).map(id => id.length)); const saldoInfo = Object.entries(users).map(([uid, data]) => `⤷<code>${uid.padEnd(maxIdLength)}</code>: ${formatNumber(data.saldo)}`).join('\n'); message = `👥 Member: <code>${totalMember}</code>\n\n💳 Saldo:\n${saldoInfo}`; } break;
        case "admin_broadcast": message = `📢 <b>Broadcast</b>\nBalas pesan ini dgn <code>/broadcast</code> atau <code>/broadcast id1,id2</code>`; break;
        case "admin_cek_pending": const pending = await loadPendingPayments(env.BOT_DB); const count = Object.keys(pending).length; if (count === 0) { message = "⚠️ Tidak ada pending."; } else { const now = new Date(); const info = Object.entries(pending).map(([uid, p]) => { const pt = new Date(p.timestamp); const dm = Math.floor((now - pt) / 60000); const r = Math.max(0, 10 - dm); return `⤷<code>${uid}</code>: ${p.transactionId} (${r}m)`; }).join('\n'); message = `⏰ Pending: <code>${count}</code>\n\n${info}`; } break;
        case "admin_set_bonus": const cfg = await getConfig(env.BOT_DB); message = `⚙️ <b>Atur Bonus (%)</b>\nSaat ini: <b>${cfg.bonus_percentage || 0}%</b>\nMasukkan persentase baru (misal: <code>10</code> atau <code>0</code>):`; userSessions.set(user.id, { action: 'set_bonus' }); break;
        case "admin_back": // ** PERBAIKAN DI SINI **
            userSessions.delete(user.id);
            const users_a = await loadDB(env.BOT_DB, 'users'); const acc_a = await loadDB(env.BOT_DB, 'accounts'); const conf_a = await getConfig(env.BOT_DB);
            const kb_a = { inline_keyboard: [[{ text: "➕ Tmbh Saldo", callback_data: "admin_tambah_saldo" }, { text: "➖ Krg Saldo", callback_data: "admin_kurangi_saldo" }], [{ text: "🛒 Tmbh Akun", callback_data: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", callback_data: "admin_hapus_akun" }], [{ text: "👥 Cek Member", callback_data: "admin_cek_member" }, { text: "📢 Broadcast", callback_data: "admin_broadcast" }], [{ text: "⏰ Cek Pending", callback_data: "admin_cek_pending" }, { text: `⚙️ Bonus (${conf_a.bonus_percentage || 0}%)`, callback_data: "admin_set_bonus" }]] };
            const msg_a = `👮‍♂️ <b>PANEL ADMIN</b> 👮‍♂️\n\nHalo <b>${user.first_name}</b>!\n\n┌ INFO\n├ 👥 Member: <code>${Object.keys(users_a).length}</code>\n├ 📦 Stok: <code>${Object.keys(acc_a).length}</code>\n└ 🎁 Bonus: <code>${conf_a.bonus_percentage || 0}%</code>\n\nPilih aksi:`;
            // Gunakan editMessageText, bukan return objek baru
            await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg_a, kb_a);
            return new Response('OK'); // Kembalikan respons OK setelah edit

        default: message = "❓ Aksi tidak dikenal."; break;
    }
    // Edit pesan untuk sub-menu
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard_submenu);
}


async function handleAdminMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;
    if (user.id.toString() !== env.ADMIN_ID) return;
    const session = userSessions.get(user.id);
    if (!session) return;
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    try {
        switch (session.action) {
            case 'tambah_saldo': case 'kurangi_saldo':
                const [targetId, amountStr] = text.split(' '); const amount = parseInt(amountStr);
                if (!targetId || !amount || isNaN(amount)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Format salah: <code>ID JUMLAH</code>"); return; }
                if (!users[targetId]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ User tidak ditemukan."); return; }
                if (session.action === 'tambah_saldo') { users[targetId].saldo += amount; }
                else { if (users[targetId].saldo < amount) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Saldo user (<code>${users[targetId].saldo}</code>) < <code>${amount}</code>.`); return; } users[targetId].saldo -= amount; }
                await saveDB(env.BOT_DB, users, 'users');
                const adminMsg = `✅ Saldo diperbarui!\nID: <code>${targetId}</code>\n${session.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amount)}</code>\nSaldo baru: <code>Rp ${formatNumber(users[targetId].saldo)}</code>`;
                const userMsg = `🔔 UPDATE SALDO ADMIN\n${session.action === 'tambah_saldo' ? '+' : '-'} Saldo: <code>Rp ${formatNumber(amount)}</code>\nSaldo Saat Ini: <code>Rp ${formatNumber(users[targetId].saldo)}</code>`;
                await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMsg);
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), userMsg);
                userSessions.delete(user.id); break;
            case 'tambah_akun':
                const step = session.step; const data = session.data;
                if (step === 'nama') { data.name = text; session.step = 'email'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "📧 Masukkan email/username:"); }
                else if (step === 'email') { data.email = text; session.step = 'password'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🔑 Masukkan password:"); }
                else if (step === 'password') { data.password = text; session.step = 'harga'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "💰 Masukkan harga (angka):"); }
                else if (step === 'harga') { data.price = parseInt(text); if (isNaN(data.price)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Harga harus angka."); return; } session.step = 'deskripsi'; await sendTelegramMessage(env.BOT_TOKEN, user.id, `📝 Masukkan deskripsi:\nHarga: <code>Rp ${formatNumber(data.price)}</code>`); }
                else if (step === 'deskripsi') { data.description = text; session.step = 'catatan'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🗒️ Masukkan catatan ('tidak ada' jika kosong):"); }
                else if (step === 'catatan') { data.note = text.toLowerCase() !== "tidak ada" ? text : "Tidak ada catatan"; if (accounts[data.email]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${data.email}</code> sudah ada.`); userSessions.delete(user.id); return; } accounts[data.email] = data; await saveDB(env.BOT_DB, accounts, 'accounts'); const addedMsg = `✅ Akun ditambahkan:\n<code>${data.name}</code> | <code>${data.email}</code> | <code>${data.password}</code> | Rp ${formatNumber(data.price)}`; await sendTelegramMessage(env.BOT_TOKEN, user.id, addedMsg); userSessions.delete(user.id); }
                break;
            case 'hapus_akun':
                if (accounts[text]) { delete accounts[text]; await saveDB(env.BOT_DB, accounts, 'accounts'); await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ Akun dihapus."); }
                else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${text}</code> tidak ditemukan.`); }
                userSessions.delete(user.id); break;
            case 'set_bonus': // ** BARU: Proses Set Bonus **
                const newBonus = parseInt(text);
                if (isNaN(newBonus) || newBonus < 0) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Persentase tidak valid. Masukkan angka positif."); return; }
                const currentConfig = await getConfig(env.BOT_DB); currentConfig.bonus_percentage = newBonus;
                if (await saveConfig(env.BOT_DB, currentConfig)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `✅ Bonus deposit diatur ke <b>${newBonus}%</b>.`); }
                else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal menyimpan bonus."); }
                userSessions.delete(user.id); break;
            default: userSessions.delete(user.id); break;
        }
    } catch (error) { console.error('Error processing admin message:', error); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses perintah."); userSessions.delete(user.id); }
    // Kembalikan respons OK setelah pemrosesan pesan admin
    return new Response('OK');
}


async function handleBroadcast(update, env) { /* ... (Kode handleBroadcast tetap sama) ... */ }
async function cleanupExpiredPayments(env) { /* ... (Kode cleanupExpiredPayments dengan notif user) ... */ }
function handleInfo(env) { /* ... (Kode handleInfo tampilan web) ... */ }


// --- (BAGIAN 4: NATIVE ROUTING PENGGANTI ITTY-ROUTER) ---

export default {
    async fetch(request, env, ctx) {

        const url = new URL(request.url);
        const method = request.method;

        // --- Handle GET ---
        if (method === 'GET') {
            if (url.pathname === '/info') return handleInfo(env);
            if (url.pathname === '/') return new Response('Bot Aktif! Cek /info.');
            return new Response('Not Found', { status: 404 });
        }

        // --- Handle POST (Webhook Telegram) ---
        if (method === 'POST' && (url.pathname === '/' || url.pathname === `/${env.BOT_TOKEN}`)) {
            try {
                const update = await request.json();
                ctx.waitUntil(cleanupExpiredPayments(env)); // Jalankan di background

                let response = null; // Variabel untuk menyimpan respons dari handler

                if (update.message) {
                    const text = update.message.text || '';
                    const user = update.message.from;
                    const session = userSessions.get(user.id);

                    if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) {
                         response = await handleDepositMessage(update, env);
                    } else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) {
                         response = await handleAdminMessage(update, env); // handleAdminMessage sekarang mengembalikan Response
                    } else if (text.startsWith('/start')) {
                         response = await handleStart(update, env);
                    } else if (text.startsWith('/id')) {
                         response = await handleGetId(update, env);
                    } else if (text.startsWith('/admin')) {
                         response = await handleAdmin(update, env);
                    } else if (text.startsWith('/broadcast')) {
                         response = await handleBroadcast(update, env); // handleBroadcast juga bisa mengembalikan Response
                    }

                } else if (update.callback_query) {
                    const callbackData = update.callback_query.data;
                         if (callbackData === 'beli_akun')        response = await handleBeliAkunCallback(update, env);
                    else if (callbackData.startsWith('group_'))   response = await handleDetailAkun(update, env);
                    else if (callbackData.startsWith('beli_'))    response = await handleProsesPembelian(update, env);
                    else if (callbackData === 'deposit')           response = await handleDepositCallback(update, env);
                    else if (callbackData.startsWith('confirm_payment_')) response = await handleConfirmPayment(update, env);
                    else if (callbackData === 'cancel_payment')   response = await handleCancelPayment(update, env);
                    else if (callbackData.startsWith('admin_'))   response = await handleAdminActions(update, env); // handleAdminActions sekarang mengembalikan Response
                    else if (callbackData === 'back_to_main')     response = await handleBackToMain(update, env);
                }

                // Jika ada respons dari handler, kirim sebagai JSON
                if (response && response instanceof Response === false) { // Pastikan bukan objek Response bawaan
                     return new Response(JSON.stringify(response));
                }
                // Jika handler mengembalikan Response (seperti handleAdminActions > admin_back), gunakan itu
                else if (response instanceof Response) {
                    return response;
                }
                // Jika tidak ada handler cocok atau handler return null
                return new Response('OK');

            } catch (error) {
                console.error('Error handling Telegram update:', error);
                return new Response('Internal Server Error', { status: 500 });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
};
