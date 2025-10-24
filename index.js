 import { Router } from 'itty-router';

const router = Router();

// In-memory storage untuk sessions (sementara)
const userSessions = new Map();

// --- HELPER FUNCTIONS (Fungsi Bantuan) ---
// (loadDB, saveDB, loadPendingPayments, savePendingPayment, removePendingPayment, getPendingPayment, formatNumber, getRandomAmount, sendTelegramMessage, sendTelegramPhoto, editMessageText, editMessageCaption, answerCallbackQuery)
// ... (TETAP SAMA, tidak perlu diubah)

async function loadDB(binding, dbType) {
    try {
        const data = await binding.get(dbType, 'json');
        return data || {};
    } catch (error) {
        return {};
    }
}

async function saveDB(binding, data, dbType) {
    try {
        await binding.put(dbType, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Error saving to KV:', error);
        return false;
    }
}

async function loadPendingPayments(binding) {
    try {
        const data = await binding.get('pending_payments', 'json');
        return data || {};
    } catch (error) {
        return {};
    }
}

async function savePendingPayment(binding, userId, paymentData) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        pendingPayments[userId] = {
            ...paymentData,
            timestamp: paymentData.timestamp.toISOString()
        };
        await binding.put('pending_payments', JSON.stringify(pendingPayments));
        return true;
    } catch (error) {
        console.error('Error saving pending payment:', error);
        return false;
    }
}

async function removePendingPayment(binding, userId) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        if (pendingPayments[userId]) {
            delete pendingPayments[userId];
            await binding.put('pending_payments', JSON.stringify(pendingPayments));
        }
        return true;
    } catch (error) {
        console.error('Error removing pending payment:', error);
        return false;
    }
}

async function getPendingPayment(binding, userId) {
    try {
        const pendingPayments = await loadPendingPayments(binding);
        const payment = pendingPayments[userId];
        if (payment) {
            return {
                ...payment,
                timestamp: new Date(payment.timestamp)
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting pending payment:', error);
        return null;
    }
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function getRandomAmount(env) {
    const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1;
    const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode
    };
    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Error sending Telegram message:', error);
        return null;
    }
}

async function sendTelegramPhoto(botToken, chatId, photoUrl, caption = '', replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: parseMode
    };
    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Error sending Telegram photo:', error);
        return null;
    }
}

async function editMessageText(botToken, chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: parseMode
    };
    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Error editing message text:', error);
        return null;
    }
}

async function editMessageCaption(botToken, chatId, messageId, caption, replyMarkup = null, parseMode = 'HTML') {
    const url = `https://api.telegram.org/bot${botToken}/editMessageCaption`;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        caption: caption,
        parse_mode: parseMode
    };
    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Error editing message caption:', error);
        return null;
    }
}

async function answerCallbackQuery(botToken, callbackQueryId, text = null, showAlert = false) {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    const payload = {
        callback_query_id: callbackQueryId
    };
    if (text) {
        payload.text = text;
        payload.show_alert = showAlert;
    }
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Error answering callback query:', error);
        return null;
    }
}

// ** (BARU) Notifikasi Log Grup **
async function sendLogNotification(env, type, userData, itemData) {
    const chatId = env.LOG_GROUP_ID; 
    if (!chatId) return;

    let message = `
🔔 <b>Log Transaksi Baru: ${type}</b>

👤 <b>User:</b> <code>@${userData.username || 'N/A'}</code>
🆔 <b>User ID:</b> <code>${userData.id}</code>
    `;

    if (type === 'PEMBELIAN') {
        const formattedPrice = formatNumber(itemData.price);
        const formattedSaldo = formatNumber(itemData.currentSaldo);
        message += `
🛒 <b>Status:</b> ✅ Berhasil
📦 <b>Produk:</b> ${itemData.name}
💸 <b>Harga:</b> <code>Rp ${formattedPrice}</code>
📧 <b>Akun:</b> <code>${itemData.email}</code> | <code>${itemData.password}</code>
💳 <b>Sisa Saldo:</b> <code>Rp ${formattedSaldo}</code>
        `;
    } else if (type === 'DEPOSIT') {
        const formattedNominal = formatNumber(itemData.nominal);
        const formattedFinal = formatNumber(itemData.finalNominal);
        const formattedSaldo = formatNumber(itemData.currentSaldo);
        message += `
💳 <b>Status:</b> ✅ Berhasil
🆔 <b>ID Transaksi:</b> <code>${itemData.transactionId}</code>
💰 <b>Nominal:</b> <code>Rp ${formattedNominal}</code>
➕ <b>Total Bayar:</b> <code>Rp ${formattedFinal}</code>
💳 <b>Saldo Baru:</b> <code>Rp ${formattedSaldo}</code>
        `;
    }

    await sendTelegramMessage(env.BOT_TOKEN, chatId, message);
}


// --- 🌟 HANDLER TAMPILAN KEREN 🌟 ---

// ** (KEREN) Handle command /start **
async function handleStart(update, env) {
    const user = update.message.from;
    const userId = user.id.toString();
    const userFirstName = user.first_name || user.username || "User";
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    if (!users[userId]) {
        users[userId] = { saldo: 0 };
        await saveDB(env.BOT_DB, users, 'users');
    }
    
    const saldo = users[userId]?.saldo || 0;
    const formattedSaldo = formatNumber(saldo);
    const stok = Object.keys(accounts).length;
    
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "Bot Order Otomatis";

    const message = `
Halo, <b>${userFirstName}</b>! 👋

Selamat datang di <b>${botName}</b>.
Sistem order otomatis 24/7 untuk kebutuhan Anda.

┌ <b>INFORMASI AKUN ANDA</b>
├ 🆔 <b>User ID:</b> <code>${userId}</code>
└ 💰 <b>Saldo:</b> <code>Rp ${formattedSaldo}</code>

┌ <b>INFORMASI BOT</b>
├ 📦 <b>Stok Akun:</b> ${stok}
└ 👨‍💼 <b>Bantuan:</b> ${adminUsername}

👇 Silakan pilih menu di bawah ini untuk memulai:
    `;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Beli Akun", callback_data: "beli_akun" },
                { text: "💳 Deposit Saldo", callback_data: "deposit" }
            ],
            [
                { text: "🔄 Refresh", callback_data: "back_to_main" }
            ]
        ]
    };
    
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
}

// Handle command /id (Tetap sama, sudah cukup keren)
async function handleGetId(update, env) {
    const user = update.message.from;
    const userId = user.id;
    const username = user.username;
    
    let message;
    if (username) {
        message = `
🆔 <b>Informasi Akun Anda:</b>
📄 <b>ID Pengguna:</b> <code>${userId}</code>
👤 <b>Username:</b> <code>@${username}</code>

Terima kasih telah menggunakan bot ini! 😊
        `;
    } else {
        message = `
🆔 <b>Informasi Akun Anda:</b>
📄 <b>ID Pengguna:</b> <code>${userId}</code>
👤 <b>Username:</b> <i>(not found)</i>

Terima kasih telah menggunakan bot ini! 😊
        `;
    }
    
    return await sendTelegramMessage(env.BOT_TOKEN, userId, message);
}

// ** (KEREN) Handle callback beli akun **
async function handleBeliAkunCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const users = await loadDB(env.BOT_DB, 'users');
    const saldo = users[userId]?.saldo || 0;
    
    if (Object.keys(accounts).length === 0) {
        const message = `
⚠️ <b>STOK KOSONG</b> ⚠️

Maaf, <b>${user.first_name}</b>, saat ini semua produk sedang habis.
Silakan cek kembali nanti atau hubungi admin.
        `;
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok produk kosong!", true);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, {
            inline_keyboard: [[{ text: "🔙 Kembali ke Menu", callback_data: "back_to_main" }]]
        });
    }
    
    const groupedAccounts = {};
    for (const [email, akun] of Object.entries(accounts)) {
        const key = `${akun.name}_${akun.price}`;
        if (!groupedAccounts[key]) {
            groupedAccounts[key] = [];
        }
        groupedAccounts[key].push(email);
    }
    
    const keyboardButtons = Object.entries(groupedAccounts).map(([key, emails]) => {
        const [name, price] = key.split('_');
        const count = emails.length;
        const formattedPrice = formatNumber(parseInt(price));
        // Tombol yang lebih rapi
        return [{
            text: `📦 ${name} | Rp ${formattedPrice} (Stok: ${count})`,
            callback_data: `group_${name}_${price}`
        }];
    });

    const keyboard = {
        inline_keyboard: [
            ...keyboardButtons,
            [{ text: "🔙 Kembali ke Menu", callback_data: "back_to_main" }]
        ]
    };
    
    const message = `
🛒 <b>DAFTAR PRODUK</b> 🛒

Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>
Total Stok Tersedia: <code>${Object.keys(accounts).length}</code>

Silakan pilih produk yang tersedia di bawah ini:
    `;
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// ** (KEREN) Handle detail akun **
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
    
    const filteredAccounts = Object.entries(accounts).filter(([email, akun]) => 
        akun.name === name && akun.price === priceInt
    );
    
    if (filteredAccounts.length === 0) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok item ini baru saja habis!", true);
        const message = `
❌ <b>STOK HABIS</b>
Akun yang Anda pilih baru saja habis. Silakan pilih akun lain.
        `;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, {
             inline_keyboard: [[{ text: "🛒 Kembali ke Daftar Produk", callback_data: "beli_akun" }]]
        });
    }
    
    const [email, akun] = filteredAccounts[0]; // Ambil 1 sampel
    const formattedPrice = formatNumber(akun.price);
    
    const message = `
📄 <b>DETAIL & KONFIRMASI</b> 📄

┌ <b>PRODUK</b>
├ 📦 <b>Nama:</b> <code>${akun.name}</code>
├ 💸 <b>Harga:</b> <code>Rp ${formattedPrice}</code>
└ 📝 <b>Deskripsi:</b>
${akun.description}

---
Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>
Stok Item Ini: ${filteredAccounts.length}

Tekan "✅ Beli Sekarang" untuk melanjutkan.
    `;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Beli Sekarang", callback_data: `beli_${email}` },
                { text: "❌ Batal (Kembali)", callback_data: "beli_akun" }
            ]
        ]
    };
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// ** (KEREN) Handle kembali ke menu utama **
async function handleBackToMain(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    
    const userFirstName = user.first_name || user.username || "User";
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    const saldo = users[userId]?.saldo || 0;
    const formattedSaldo = formatNumber(saldo);
    const stok = Object.keys(accounts).length;
    
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "Bot Order Otomatis";

    const message = `
Halo, <b>${userFirstName}</b>! 👋

Selamat datang di <b>${botName}</b>.
Sistem order otomatis 24/7 untuk kebutuhan Anda.

┌ <b>INFORMASI AKUN ANDA</b>
├ 🆔 <b>User ID:</b> <code>${userId}</code>
└ 💰 <b>Saldo:</b> <code>Rp ${formattedSaldo}</code>

┌ <b>INFORMASI BOT</b>
├ 📦 <b>Stok Akun:</b> ${stok}
└ 👨‍💼 <b>Bantuan:</b> ${adminUsername}

👇 Silakan pilih menu di bawah ini untuk memulai:
    `;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Beli Akun", callback_data: "beli_akun" },
                { text: "💳 Deposit Saldo", callback_data: "deposit" }
            ],
            [
                { text: "🔄 Refresh", callback_data: "back_to_main" }
            ]
        ]
    };
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Menu diperbarui!");
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// ** (KEREN) Handle proses pembelian **
async function handleProsesPembelian(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const callbackData = callbackQuery.data;
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    const email = callbackData.split('_')[1];
    
    if (!accounts[email]) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Akun sudah terjual!", true);
        const message = "<b>⚠️ Maaf, akun yang Anda pilih sudah terjual.</b>";
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, {
             inline_keyboard: [[{ text: "🛒 Kembali ke Daftar Produk", callback_data: "beli_akun" }]]
        });
    }
    
    const akun = accounts[email];
    const harga = akun.price;
    
    if (!users[userId]) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda belum terdaftar! Ketik /start", true);
        return;
    }
    
    const saldo = users[userId].saldo;
    if (saldo < harga) {
        const message = `
<b>🚫 SALDO TIDAK CUKUP</b>

Maaf, <b>${user.first_name}</b>, saldo Anda tidak cukup.
Harga Produk: <code>Rp ${formatNumber(harga)}</code>
Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>

Silakan deposit terlebih dahulu.
        `;
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Saldo tidak cukup!", true);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, {
             inline_keyboard: [[{ text: "💳 Deposit Saldo", callback_data: "deposit" }]]
        });
    }
    
    // Proses pembelian
    users[userId].saldo -= harga;
    await saveDB(env.BOT_DB, users, 'users');
    
    delete accounts[email];
    await saveDB(env.BOT_DB, accounts, 'accounts');
    
    const formattedPrice = formatNumber(akun.price);
    const currentSaldo = users[userId].saldo;
    const formattedSaldo = formatNumber(currentSaldo);
    
    const akunStr = `
🎉 <b>TRANSAKSI BERHASIL</b> 🎉

Terima kasih telah membeli, <b>${user.first_name}</b>!
Berikut adalah detail akun Anda:

┌ <b>DETAIL AKUN</b>
├ 📦 <b>Produk:</b> <code>${akun.name}</code>
├ 📧 <b>Email/User:</b> <code>${akun.email}</code>
├ 🔑 <b>Password:</b> <code>${akun.password}</code>
└ 🗒️ <b>Catatan:</b> ${akun.note || 'Tidak ada catatan'}

┌ <b>RINGKASAN PEMBAYARAN</b>
├ 💸 <b>Harga:</b> <code>Rp ${formattedPrice}</code>
└ 💰 <b>Sisa Saldo:</b> <code>Rp ${formattedSaldo}</code>

Simpan baik-baik detail akun Anda.
    `;
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Pembelian Berhasil!");
    
    // Tombol baru setelah sukses
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Beli Lagi", callback_data: "beli_akun" },
                { text: "🏠 Menu Utama", callback_data: "back_to_main" }
            ]
        ]
    };

    await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, akunStr, keyboard);
    
    // Notifikasi ke Admin (Ringkas)
    const username = user.username || "null";
    const adminMessage = `
🛒 <b>Penjualan Baru!</b>
<b>User:</b> @${username} (<code>${userId}</code>)
<b>Produk:</b> ${akun.name}
<b>Harga:</b> Rp ${formattedPrice}
<b>Sisa Saldo User:</b> Rp ${formattedSaldo}
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    
    // Kirim notifikasi ke grup log (Lengkap)
    await sendLogNotification(env, 'PEMBELIAN', user, {
        name: akun.name,
        price: akun.price,
        email: akun.email,
        password: akun.password,
        currentSaldo: currentSaldo,
    });
}

// ** (KEREN) Handle deposit callback **
async function handleDepositCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    
    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda masih memiliki deposit yang belum selesai.", true);
        return;
    }
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    const maxRandom = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    
    userSessions.set(user.id, { action: 'awaiting_deposit_nominal' });
    
    const message = `
💳 <b>DEPOSIT SALDO (QRIS OTOMATIS)</b>

┌ <b>INFORMASI DEPOSIT</b>
├ 💰 <b>Minimal:</b> <code>Rp ${formatNumber(minAmount)}</code>
└ 🔢 <b>Kode Unik:</b> Akan ditambah 1-${maxRandom} Rupiah

Silakan balas pesan ini dengan <b>jumlah nominal</b> yang ingin Anda deposit.

Contoh: <code>10000</code>
    `;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "🔙 Batal", callback_data: "back_to_main" }]
        ]
    };
    
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// ** (KEREN) Handle message deposit **
async function handleDepositMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;

    const session = userSessions.get(user.id);
    
    if (session?.action !== 'awaiting_deposit_nominal') {
        // Jika admin, biarkan admin handler
        if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) {
             return null;
        }
        // Jika user biasa, abaikan pesan
        return null; 
    }
    
    userSessions.delete(user.id); 

    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) {
        const responseMessage = `
⚠️ <b>Anda masih memiliki deposit yang belum selesai.</b>
Silakan selesaikan atau batalkan deposit sebelumnya.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    try {
        const nominal = parseInt(text);
        const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
        
        if (isNaN(nominal) || nominal <= 0) {
             const responseMessage = "⚠️ <b>Nominal tidak valid.</b> Harap masukkan angka saja, contoh: <code>10000</code>";
             return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
        }
        
        if (nominal < minAmount) {
            const formattedMinAmount = formatNumber(minAmount);
            const responseMessage = `⚠️ <b>Minimal deposit adalah Rp ${formattedMinAmount}.</b>`;
            return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
        }
        
        // Buat QRIS dan konfirmasi
        await createQrisAndConfirm(env, user, nominal);
        
    } catch (error) {
        const responseMessage = "⚠️ <b>Nominal tidak valid. Harap masukkan angka.</b>";
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
}

// ** (KEREN) Buat QRIS dan konfirmasi **
async function createQrisAndConfirm(env, user, nominal) {
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    
    try {
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        const data = await response.json();
        
        if (data.status === "success") {
            const qrisUrl = data.data.download_url;
            const transactionId = data.data["kode transaksi"];
            
            const paymentData = {
                nominal: nominal,
                finalNominal: finalNominal,
                transactionId: transactionId,
                timestamp: new Date(),
                status: "pending",
                messageId: null 
            };
            
            await savePendingPayment(env.BOT_DB, user.id, paymentData);
            
            const formattedNominal = formatNumber(nominal);
            const formattedFinal = formatNumber(finalNominal);
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transactionId}` },
                        { text: "❌ Batalkan", callback_data: "cancel_payment" }
                    ]
                ]
            };
            
            const caption = `
⏳ <b>PENDING PAYMENT</b> ⏳

Mohon transfer <b>TEPAT</b> sesuai nominal <b>TOTAL</b> di bawah ini.

┌ <b>DETAIL TAGIHAN</b>
├ 🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>
├ 💰 <b>Nominal:</b> <code>Rp ${formattedNominal}</code>
├ 🔢 <b>Kode Unik:</b> <code>Rp ${randomAddition}</code>
└ 💳 <b>TOTAL:</b> <b><code>Rp ${formattedFinal}</code></b>

Scan QRIS di atas untuk membayar.
Bayar sebelum <b>10 menit</b>.

Klik "✅ Konfirmasi Pembayaran" jika Anda <b>SUDAH</b> transfer.
            `;
            
            const sentMessage = await sendTelegramPhoto(env.BOT_TOKEN, user.id, qrisUrl, caption, keyboard);
            if (sentMessage && sentMessage.ok) {
                paymentData.messageId = sentMessage.result.message_id;
                await savePendingPayment(env.BOT_DB, user.id, paymentData);
            }
            
            const adminMessage = `
⏳ <b>Deposit Pending</b>
<b>User:</b> @${user.username || 'N/A'} (<code>${user.id}</code>)
<b>ID:</b> <code>${transactionId}</code>
<b>Total:</b> <code>Rp ${finalNominal}</code>
            `;
            
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
        } else {
            await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Gagal membuat QRIS. Silakan coba lagi.</b>");
        }
    } catch (error) {
        console.error('Error creating QRIS:', error);
        await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Terjadi kesalahan server saat membuat QRIS. Silakan coba lagi.</b>");
    }
}

// ** (KEREN) Handle konfirmasi pembayaran **
async function handleConfirmPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const callbackData = callbackQuery.data;
    
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit yang pending.", true);
        return;
    }
    
    const transactionId = callbackData.split('_')[2];
    
    if (paymentData.transactionId !== transactionId) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ ID transaksi tidak sesuai.", true);
        return;
    }
    
    const now = new Date();
    const paymentTime = new Date(paymentData.timestamp);
    const diffMinutes = (now - paymentTime) / (1000 * 60);
    
    if (diffMinutes > 10) {
        await removePendingPayment(env.BOT_DB, userId);
        const expiredCaption = `
❌ <b>PEMBAYARAN EXPIRED</b>
ID Transaksi: <code>${transactionId}</code>
Pembayaran telah expired. Silakan buat deposit baru.
        `;
        if (paymentData.messageId) {
            await editMessageCaption(env.BOT_TOKEN, user.id, paymentData.messageId, expiredCaption);
        }
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran telah expired.", true);
        return;
    }
    
    // Cek pembayaran via API
    try {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Sedang mengecek pembayaran Anda..."); // Notif loading
        
        const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
        if (response.ok) {
            const data = await response.json();
            
            if (data.status === "success") {
                const payments = data.data || [];
                let paymentFound = false;
                
                for (const payment of payments) {
                    if (payment && typeof payment === 'object' && payment.amount === paymentData.finalNominal) {
                        paymentFound = true;
                        break;
                    }
                }
                
                if (paymentFound) {
                    // Pembayaran ditemukan
                    const users = await loadDB(env.BOT_DB, 'users');
                    const userIdStr = userId.toString();
                    
                    if (!users[userIdStr]) {
                        users[userIdStr] = { saldo: 0 };
                    }
                    
                    users[userIdStr].saldo += paymentData.nominal;
                    await saveDB(env.BOT_DB, users, 'users');
                    
                    const formattedNominal = formatNumber(paymentData.nominal);
                    const formattedSaldo = formatNumber(users[userIdStr].saldo);
                    
                    await removePendingPayment(env.BOT_DB, userId);
                    
                    const newCaption = `
✅ <b>DEPOSIT BERHASIL</b> ✅

Halo <b>${user.first_name}</b>, saldo Anda telah berhasil ditambahkan!

┌ <b>RINGKASAN</b>
├ 🆔 <b>ID:</b> <code>${transactionId}</code>
├ 💸 <b>Nominal Masuk:</b> <code>Rp ${formattedNominal}</code>
└ 💰 <b>Saldo Baru:</b> <b><code>Rp ${formattedSaldo}</code></b>

Terima kasih telah top-up! 😊
                    `;
                    
                    if (paymentData.messageId) {
                        await editMessageCaption(
                            env.BOT_TOKEN,
                            user.id,
                            paymentData.messageId,
                            newCaption
                            // Hapus keyboard setelah sukses
                        );
                    }
                    
                    const adminMessage = `
✅ <b>Deposit Sukses</b>
<b>User:</b> @${user.username || 'null'} (<code>${userId}</code>)
<b>ID:</b> <code>${transactionId}</code>
<b>Nominal:</b> <code>Rp ${paymentData.nominal}</code>
<b>Saldo Baru:</b> <code>Rp ${formattedSaldo}</code>
                    `;
                    
                    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);

                    await sendLogNotification(env, 'DEPOSIT', user, {
                        transactionId: transactionId,
                        nominal: paymentData.nominal,
                        finalNominal: paymentData.finalNominal,
                        currentSaldo: users[userIdStr].saldo,
                    });
                    
                } else {
                    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Pembayaran belum terdeteksi. Silakan tunggu 5 menit lagi dan coba konfirmasi kembali.", true);
                }
            } else {
                await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal memeriksa API pembayaran. Coba lagi.", true);
            }
        } else {
            await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal terhubung ke sistem pembayaran.", true);
        }
    } catch (error) {
        console.error('Error checking payment:', error);
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, `❌ Terjadi kesalahan: ${error.message}`, true);
    }
}

// ** (KEREN) Handle batalkan pembayaran **
async function handleCancelPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit yang pending.", true);
        return;
    }
    
    const transactionId = paymentData.transactionId;
    await removePendingPayment(env.BOT_DB, userId);
    
    const newCaption = `
❌ <b>PEMBAYARAN DIBATALKAN</b>

🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>

Pembayaran telah dibatalkan. Anda dapat melakukan deposit baru kapan saja.
    `;
    
    if (paymentData.messageId) {
        await editMessageCaption(
            env.BOT_TOKEN,
            user.id,
            paymentData.messageId,
            newCaption
            // Hapus keyboard
        );
    }
    
    const adminMessage = `
❌ <b>Deposit Batal</b>
<b>User:</b> @${user.username || 'null'} (<code>${userId}</code>)
<b>ID:</b> <code>${transactionId}</code>
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran telah dibatalkan.", true);
}


// --- 🌟 ADMIN HANDLER KEREN 🌟 ---

// ** (KEREN) Handle admin command **
async function handleAdmin(update, env) {
    const message = update.message;
    const user = message.from;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        const responseMessage = `
❌ <b>Akses Ditolak!</b>
Hanya admin yang dapat menggunakan perintah ini.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts'); // Ambil info stok
    const totalMembers = Object.keys(users).length;
    const totalStok = Object.keys(accounts).length;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "➕ Tambah Saldo", callback_data: "admin_tambah_saldo" },
                { text: "➖ Kurangi Saldo", callback_data: "admin_kurangi_saldo" }
            ],
            [
                { text: "🛒 Tambah Akun", callback_data: "admin_tambah_akun" },
                { text: "🗑️ Hapus Akun", callback_data: "admin_hapus_akun" }
            ],
            [
                { text: "👥 Cek Member", callback_data: "admin_cek_member" },
                { text: "📢 Broadcast", callback_data: "admin_broadcast" }
            ],
            [
                { text: "⏰ Cek Pending", callback_data: "admin_cek_pending" }
            ]
        ]
    };
    
    const adminMessage = `
👮‍♂️ <b>PANEL ADMIN</b> 👮‍♂️

Halo <b>${user.first_name}</b>! Anda login sebagai admin.

┌ <b>INFORMASI BOT</b>
├ 👥 <b>Total Member:</b> <code>${totalMembers}</code>
└ 📦 <b>Total Stok:</b> <code>${totalStok}</code>

Silakan pilih aksi yang ingin dilakukan:
    `;
    
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMessage, keyboard);
}

// (handleAdminActions, handleAdminMessage, handleBroadcast, cleanupExpiredPayments - TETAP SAMA)
// ... (Fungsi-fungsi ini tidak perlu diubah, sudah fungsional)

async function handleAdminActions(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const callbackData = callbackQuery.data;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Akses ditolak!", true);
        return;
    }
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    
    let message = "";
    
    switch (callbackData) {
        case "admin_tambah_saldo":
            message = `
📝 <b>Tambah Saldo</b>
Kirimkan ID user dan jumlah saldo.
<b>Format:</b> <code>id jumlah</code> (Contoh: <code>12345 10000</code>)
            `;
            userSessions.set(user.id, { action: 'tambah_saldo' });
            break;
            
        case "admin_kurangi_saldo":
            message = `
📝 <b>Kurangi Saldo</b>
Kirimkan ID user dan jumlah saldo.
<b>Format:</b> <code>id jumlah</code> (Contoh: <code>12345 5000</code>)
            `;
            userSessions.set(user.id, { action: 'kurangi_saldo' });
            break;
            
        case "admin_tambah_akun":
            message = `
🛒 <b>Tambah Akun Produk</b>
Silakan masukkan <b>nama produk</b> untuk memulai.
            `;
            userSessions.set(user.id, { 
                action: 'tambah_akun',
                step: 'nama',
                data: {}
            });
            break;
            
        case "admin_hapus_akun":
            message = `
🗑️ <b>Hapus Akun</b>
Kirimkan <b>email/username akun</b> yang ingin dihapus.
            `;
            userSessions.set(user.id, { action: 'hapus_akun' });
            break;
            
        case "admin_cek_member":
            const users = await loadDB(env.BOT_DB, 'users');
            const totalMember = Object.keys(users).length;
            
            if (totalMember === 0) {
                message = "⚠️ <b>Tidak ada member yang terdaftar.</b>";
            } else {
                const maxIdLength = Math.max(...Object.keys(users).map(id => id.length));
                const saldoInfo = Object.entries(users)
                    .map(([userId, data]) => 
                        `⤷ <code>${userId.padEnd(maxIdLength)}</code> ➠ <code>${data.saldo}</code>`
                    )
                    .join('\n');
                
                message = `
👥 <b>Total Member:</b> <code>${totalMember}</code>

💳 <b>Saldo Pengguna:</b>
${saldoInfo}
                `;
            }
            break;
            
        case "admin_broadcast":
            message = `
📢 <b>Broadcast Message</b>
Balas pesan ini dengan perintah <code>/broadcast</code> untuk mengirim ke semua user.
Format lain: <code>/broadcast id1,id2</code>
            `;
            break;
            
        case "admin_cek_pending":
            const pendingPayments = await loadPendingPayments(env.BOT_DB);
            const pendingCount = Object.keys(pendingPayments).length;
            
            if (pendingCount === 0) {
                message = "⚠️ <b>Tidak ada pending payments.</b>";
            } else {
                const now = new Date();
                const pendingInfo = Object.entries(pendingPayments)
                    .map(([userId, payment]) => {
                        const paymentTime = new Date(payment.timestamp);
                        const diffMinutes = Math.floor((now - paymentTime) / (1000 * 60));
                        const remaining = 10 - diffMinutes;
                        return `⤷ <code>${userId}</code> - <code>${payment.transactionId}</code> - Rp ${formatNumber(payment.nominal)} (${remaining}m left)`;
                    })
                    .join('\n');
                
                message = `
⏰ <b>Pending Payments</b>
<b>Total:</b> <code>${pendingCount}</code>

${pendingInfo}
                `;
            }
            break;
    }
    
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, {
         inline_keyboard: [[{ text: "🔙 Kembali ke Panel Admin", callback_data: "admin_back" }]]
    });
}

// ** (KEREN) Tambahkan callback 'admin_back' di handleAdminActions **
// Tambahkan case ini di dalam switch (callbackData) di fungsi handleAdminActions
/*
...
        case "admin_cek_pending":
            // ... (kode di atas)
            break;
            
        case "admin_back":
            // Panggil fungsi handleAdmin, tapi sebagai editan
            const users_admin = await loadDB(env.BOT_DB, 'users');
            const accounts_admin = await loadDB(env.BOT_DB, 'accounts');
            const totalMembers_admin = Object.keys(users_admin).length;
            const totalStok_admin = Object.keys(accounts_admin).length;
            
            const keyboard_admin = {
                inline_keyboard: [
                    [ { text: "➕ Tambah Saldo", callback_data: "admin_tambah_saldo" }, { text: "➖ Kurangi Saldo", callback_data: "admin_kurangi_saldo" } ],
                    [ { text: "🛒 Tambah Akun", callback_data: "admin_tambah_akun" }, { text: "🗑️ Hapus Akun", callback_data: "admin_hapus_akun" } ],
                    [ { text: "👥 Cek Member", callback_data: "admin_cek_member" }, { text: "📢 Broadcast", callback_data: "admin_broadcast" } ],
                    [ { text: "⏰ Cek Pending", callback_data: "admin_cek_pending" } ]
                ]
            };
            
            message = `
👮‍♂️ <b>PANEL ADMIN</b> 👮‍♂️
Halo <b>${user.first_name}</b>! Anda login sebagai admin.
┌ <b>INFORMASI BOT</b>
├ 👥 <b>Total Member:</b> <code>${totalMembers_admin}</code>
└ 📦 <b>Total Stok:</b> <code>${totalStok_admin}</code>
Silakan pilih aksi yang ingin dilakukan:
            `;
            userSessions.delete(user.id); // Hapus sesi admin
            return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard_admin);
*/


async function handleAdminMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        return;
    }
    
    const session = userSessions.get(user.id);
    if (!session) {
        return;
    }
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    try {
        switch (session.action) {
            case 'tambah_saldo':
            case 'kurangi_saldo':
                const [targetId, amountStr] = text.split(' ');
                const amount = parseInt(amountStr);
                
                if (!targetId || !amount || isNaN(amount)) {
                     await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Format salah.</b> Harap kirim <code>ID JUMLAH</code>, contoh: <code>12345 10000</code>");
                     return;
                }
                
                if (!users[targetId]) {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>User tidak ditemukan.</b>");
                    userSessions.delete(user.id);
                    return;
                }
                
                if (session.action === 'tambah_saldo') {
                    users[targetId].saldo += amount;
                } else {
                    if (users[targetId].saldo < amount) {
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ <b>Gagal.</b> Saldo user (<code>${users[targetId].saldo}</code>) lebih kecil dari jumlah yang ingin dikurangi (<code>${amount}</code>).`);
                        return;
                    }
                    users[targetId].saldo -= amount;
                }
                
                await saveDB(env.BOT_DB, users, 'users');
                
                const formattedAmount = formatNumber(amount);
                const formattedSaldo = formatNumber(users[targetId].saldo);
                
                const adminMsg = `
✅ <b>Saldo berhasil diperbarui!</b>
🆔 <b>User ID:</b> <code>${targetId}</code>
🔹 ${session.action === 'tambah_saldo' ? 'Penambahan' : 'Pengurangan'}: <code>Rp ${formattedAmount}</code>
💰 <b>Saldo saat ini:</b> <code>Rp ${formattedSaldo}</code>
                `;
                
                const userMsg = `
🔔 <b>UPDATE SALDO OLEH ADMIN</b>
${session.action === 'tambah_saldo' ? 'Penambahan' : 'Pengurangan'} Saldo: <code>Rp ${formattedAmount}</code>
<b>Saldo Anda Saat Ini:</b> <code>Rp ${formattedSaldo}</code>
                `;
                
                await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMsg);
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), userMsg);
                
                userSessions.delete(user.id);
                break;
                
            case 'tambah_akun':
                const step = session.step;
                const data = session.data;
                
                if (step === 'nama') {
                    data.name = text;
                    session.step = 'email';
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan username/email</b>");
                } else if (step === 'email') {
                    data.email = text;
                    session.step = 'password';
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan password</b>");
                } else if (step === 'password') {
                    data.password = text;
                    session.step = 'harga';
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan harga (angka saja):</b>");
                } else if (step === 'harga') {
                    data.price = parseInt(text);
                    if (isNaN(data.price)) {
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Harga harus berupa angka. Masukkan harga</b>");
                        return;
                    }
                    const formattedPrice = formatNumber(data.price);
                    session.step = 'deskripsi';
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, `<b>Masukkan deskripsi akun</b>\n💰 Harga: <code>Rp ${formattedPrice}</code>`);
                } else if (step === 'deskripsi') {
                    data.description = text;
                    session.step = 'catatan';
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan catatan akun (misal: 2FA). Ketik 'tidak ada' jika kosong.</b>");
                } else if (step === 'catatan') {
                    data.note = text.toLowerCase() !== "tidak ada" ? text : "Tidak ada catatan";
                    const formattedPrice = formatNumber(data.price);
                    
                    if (accounts[data.email]) {
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ <b>Gagal!</b> Akun dengan email/user <code>${data.email}</code> sudah ada di database.`);
                        userSessions.delete(user.id);
                        return;
                    }

                    accounts[data.email] = data;
                    await saveDB(env.BOT_DB, accounts, 'accounts');
                    
                    const addedAccountMsg = `
✅ <b>Akun berhasil ditambahkan:</b>
<b>Nama:</b> <code>${data.name}</code>
<b>Email:</b> <code>${data.email}</code>
<b>Password:</b> <code>${data.password}</code>
<b>Harga:</b> <code>Rp ${formattedPrice}</code>
<b>Deskripsi:</b> ${data.description}
<b>Catatan:</b> ${data.note}
                    `;
                    
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, addedAccountMsg);
                    userSessions.delete(user.id);
                }
                break;
                
            case 'hapus_akun':
                if (accounts[text]) {
                    delete accounts[text];
                    await saveDB(env.BOT_DB, accounts, 'accounts');
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ <b>Akun berhasil dihapus.</b>");
                } else {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ <b>Akun <code>${text}</code> tidak ditemukan.</b>`);
                }
                userSessions.delete(user.id);
                break;
        }
    } catch (error) {
        console.error('Error processing admin message:', error);
        await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Terjadi kesalahan saat memproses perintah.</b>");
        userSessions.delete(user.id);
    }
}

async function handleBroadcast(update, env) {
    const message = update.message;
    const user = message.from;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Akses Ditolak!</b>");
    }
    
    if (!message.reply_to_message) {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, "⚠️ <b>Perintah Salah!</b>\nBalas pesan yang ingin di-broadcast dengan perintah <code>/broadcast</code>.");
    }
    
    const replyMessage = message.reply_to_message;
    const specificIds = message.text.split(' ')[1]?.split(',').filter(id => id.trim()) || [];
    
    const users = await loadDB(env.BOT_DB, 'users');
    const targetUsers = specificIds.length > 0 ? specificIds : Object.keys(users);
    const targetType = specificIds.length > 0 ? "ID tertentu" : "semua pengguna";
    
    await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚀 <b>Memulai Broadcast...</b>\nTarget: ${targetType} (${targetUsers.length} user).`);

    let successCount = 0;
    let failedCount = 0;
    
    for (const targetId of targetUsers) {
        try {
            if (replyMessage.text) {
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), replyMessage.text);
            } else {
                // (Fitur broadcast media belum didukung di kode ini, kirim teks saja)
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), "📢 <b>Pesan Broadcast dari Admin</b>\n\n(Admin mengirim pesan media yang tidak dapat diteruskan, silakan cek channel info).");
            }
            successCount++;
        } catch (error) {
            failedCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit 100ms
    }
    
    const resultMessage = `
🎉 <b>Broadcast Selesai!</b>
📍 Target: <b>${targetType}</b>
✅ Berhasil terkirim: <code>${successCount}</code>
❌ Gagal terkirim: <code>${failedCount}</code>
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, user.id, resultMessage);
}

async function cleanupExpiredPayments(env) {
    try {
        const pendingPayments = await loadPendingPayments(env.BOT_DB);
        const now = new Date();
        let cleanedCount = 0;
        
        for (const [userId, payment] of Object.entries(pendingPayments)) {
            const paymentTime = new Date(payment.timestamp);
            const diffMinutes = (now - paymentTime) / (1000 * 60);
            
            if (diffMinutes > 10) { // Expired setelah 10 menit
                const expiredCaption = `
❌ <b>PEMBAYARAN EXPIRED</b>
ID Transaksi: <code>${payment.transactionId}</code>
Pembayaran telah dibatalkan. Silakan buat deposit baru.
                `;
                
                if (payment.messageId) {
                    await editMessageCaption(env.BOT_TOKEN, parseInt(userId), payment.messageId, expiredCaption);
                }
                
                await removePendingPayment(env.BOT_DB, parseInt(userId));
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`Cleaned up ${cleanedCount} expired payments`);
        }
    } catch (error) {
        console.error('Error cleaning up expired payments:', error);
    }
}

// ** (BARU) Tampilan Web Info Keren **
function handleInfo(env) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${env.BOT_NAME || 'Auto Order Bot'} Status</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap');
        body { 
            font-family: 'Poppins', sans-serif; 
            background-color: #1a1a2e; 
            color: #e9e4f5; 
            text-align: center; 
            padding: 50px; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh;
            box-sizing: border-box;
        }
        .container { 
            background: linear-gradient(145deg, #2a2a4a, #1f1f3a);
            padding: 30px 40px; 
            border-radius: 15px; 
            max-width: 600px; 
            margin: 0 auto; 
            box-shadow: 0 10px 35px rgba(0, 0, 0, 0.4); 
            border: 1px solid rgba(255, 255, 255, 0.1); 
        }
        h1 { 
            color: #f5b11a; 
            margin-bottom: 10px; 
            font-weight: 600; 
            letter-spacing: 1px;
        }
        p { 
            margin-top: 5px; 
            color: #b8b8d1; 
            font-size: 1.1em;
        }
        .status { 
            font-size: 1.8em; 
            font-weight: 600; 
            color: #4CAF50; 
            margin: 25px 0;
            text-shadow: 0 0 10px rgba(76, 175, 80, 0.7);
        }
        .link a { 
            display: inline-block;
            background-color: #f5b11a;
            color: #1a1a2e; 
            text-decoration: none; 
            font-weight: 600; 
            padding: 12px 25px;
            border-radius: 8px;
            margin-top: 20px;
            transition: all 0.3s ease;
        }
        .link a:hover { 
            background-color: #fff;
            box-shadow: 0 0 15px rgba(245, 177, 26, 0.5);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 ${env.BOT_NAME || 'Auto Order Telegram Bot'}</h1>
        <p>Worker berhasil diterapkan dan berjalan lancar.</p>
        <div class="status">STATUS: ONLINE ✅</div>
        <p>Bot ini adalah sistem order otomatis. Semua interaksi dilakukan melalui Telegram.</p>
        <div class="link">
            <a href="https://t.me/${env.BOT_USERNAME || 'YourBotUsername'}" target="_blank">Mulai Chat dengan Bot!</a>
        </div>
    </div>
</body>
</html>
    `;
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html',
        },
    });
}


// --- ROUTING (Menggunakan itty-router) ---

router.post('/', async (request, env) => {
    try {
        const update = await request.json();
        
        await cleanupExpiredPayments(env);
        
        if (update.message) {
            const text = update.message.text || '';
            const user = update.message.from;
            const session = userSessions.get(user.id);

            // Cek jika user sedang dalam sesi deposit, dahulukan.
            if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) {
                const depositResponse = await handleDepositMessage(update, env);
                if (depositResponse) return new Response(JSON.stringify(depositResponse));
            }
            // Cek jika admin sedang dalam sesi, dahulukan.
            else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) {
                 const adminResponse = await handleAdminMessage(update, env);
                 if (adminResponse) return new Response(JSON.stringify(adminResponse));
            }
            
            // Cek Perintah
            if (text.startsWith('/start')) {
                return new Response(JSON.stringify(await handleStart(update, env)));
            } else if (text.startsWith('/id')) {
                return new Response(JSON.stringify(await handleGetId(update, env)));
            } else if (text.startsWith('/admin')) {
                return new Response(JSON.stringify(await handleAdmin(update, env)));
            } else if (text.startsWith('/broadcast')) {
                return new Response(JSON.stringify(await handleBroadcast(update, env)));
            }

        } else if (update.callback_query) {
            const callbackData = update.callback_query.data;
            
            if (callbackData === 'beli_akun') {
                return new Response(JSON.stringify(await handleBeliAkunCallback(update, env)));
            } else if (callbackData.startsWith('group_')) {
                return new Response(JSON.stringify(await handleDetailAkun(update, env)));
            } else if (callbackData.startsWith('beli_')) {
                return new Response(JSON.stringify(await handleProsesPembelian(update, env)));
            } else if (callbackData === 'deposit') {
                return new Response(JSON.stringify(await handleDepositCallback(update, env)));
            } else if (callbackData.startsWith('confirm_payment_')) {
                return new Response(JSON.stringify(await handleConfirmPayment(update, env)));
            } else if (callbackData === 'cancel_payment') {
                return new Response(JSON.stringify(await handleCancelPayment(update, env)));
            } else if (callbackData.startsWith('admin_')) {
                // (Tambahkan 'admin_back' di sini jika Anda menambahkannya di handleAdminActions)
                // if (callbackData === 'admin_back') { 
                //    ... 
                // }
                return new Response(JSON.stringify(await handleAdminActions(update, env)));
            } else if (callbackData === 'back_to_main') {
                return new Response(JSON.stringify(await handleBackToMain(update, env)));
            }
        }
        
        return new Response('OK');
    } catch (error) {
        console.error('Error handling update:', error);
        return new Response('Error', { status: 500 });
    }
});

// Endpoint Tampilan Web
router.get('/info', (request, env) => handleInfo(env));
// Endpoint root
router.get('/', () => new Response('Telegram Bot is running! Use /info for status.'));
// Fallback
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
    fetch: router.handle
};
