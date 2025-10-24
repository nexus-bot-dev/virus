import { Router } from 'itty-router';

const router = Router();

// In-memory storage untuk sessions (sementara)
const userSessions = new Map();

// Helper functions untuk KV storage
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

// Helper functions untuk pending payments
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
            timestamp: paymentData.timestamp.toISOString() // Convert Date to string
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
            // Convert string back to Date object
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

// Format number dengan titik
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Generate random number dengan konfigurasi dari environment
function getRandomAmount(env) {
    const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1;
    const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Kirim request ke Telegram API
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

// Kirim photo ke Telegram
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

// Edit message text
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

// Edit message caption
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

// Answer callback query
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

// Handle command /start
async function handleStart(update, env) {
    const user = update.message.from;
    const userId = user.id.toString();
    const username = user.username || "Tidak Ada";
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    if (!users[userId]) {
        users[userId] = { saldo: 0 };
        await saveDB(env.BOT_DB, users, 'users');
    }
    
    const saldo = users[userId].saldo;
    const formattedSaldo = formatNumber(saldo);
    const stok = Object.keys(accounts).length;
    
    // Ambil username admin dari environment
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    
    const message = `
👋 <b>Selamat Datang Di Bot Order Otomatis</b>

🆔 <b>User ID:</b> <code>${userId}</code>
👤 <b>Username:</b> <code>@${username}</code>

💰 <b>Saldo Anda:</b> <code>Rp ${formattedSaldo}</code>
📦 <b>Stok Akun Tersedia:</b> <code>${stok}</code>

👨‍💼 <b>Admin:</b> ${adminUsername}

⚙️ <b>Gunakan menu di bawah ini untuk melanjutkan pembelian atau deposit.</b>
    `;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
            [{ text: "💳 Deposit Saldo", callback_data: "deposit" }]
        ]
    };
    
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
}

// Handle command /id
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

// Handle callback beli akun
async function handleBeliAkunCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    if (Object.keys(accounts).length === 0) {
        const message = `
⚠️ <b>Maaf, saat ini item tidak tersedia.</b>  
Silakan cek kembali nanti! 🙏
        `;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
    }
    
    const groupedAccounts = {};
    for (const [email, akun] of Object.entries(accounts)) {
        const key = `${akun.name}_${akun.price}`;
        if (!groupedAccounts[key]) {
            groupedAccounts[key] = [];
        }
        groupedAccounts[key].push(email);
    }
    
    const keyboard = {
        inline_keyboard: [
            ...Object.entries(groupedAccounts).map(([key, emails]) => {
                const [name, price] = key.split('_');
                const count = emails.length;
                const formattedPrice = formatNumber(parseInt(price));
                return [{
                    text: `${name} - Rp ${formattedPrice} (x${count})`,
                    callback_data: `group_${name}_${price}`
                }];
            }),
            [{ text: "🔙 Kembali", callback_data: "back_to_main" }] // Tombol kembali
        ]
    };
    
    const message = `
🛒 <b>Silakan pilih produk yang tersedia di bawah ini:</b>

📋 <b>Total akun tersedia:</b> <code>${Object.keys(accounts).length}</code>

Klik tombol di bawah untuk melihat detail atau memesan akun.
    `;
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// Handle detail akun
async function handleDetailAkun(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const callbackData = callbackQuery.data;
    
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    const [, name, price] = callbackData.split('_');
    const priceInt = parseInt(price);
    
    const filteredAccounts = Object.entries(accounts).filter(([email, akun]) => 
        akun.name === name && akun.price === priceInt
    );
    
    if (filteredAccounts.length === 0) {
        const message = `
❌ <b>Akun yang dipilih tidak tersedia.</b>  
Silakan pilih akun lain dari daftar yang tersedia.
        `;
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
    }
    
    const randomIndex = Math.floor(Math.random() * filteredAccounts.length);
    const [email, akun] = filteredAccounts[randomIndex];
    const formattedPrice = formatNumber(akun.price);
    
    const message = `
<b>Detail Produk</b>

<b>Nama:</b> <code>${akun.name}</code>
<b>Harga:</b> <code>Rp ${formattedPrice}</code>
<b>Deskripsi Produk:</b>  
${akun.description}

❓ <b>Apakah Anda ingin membeli produk ini?</b>
    `;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Iya", callback_data: `beli_${email}` },
                { text: "❌ Tidak", callback_data: "beli_akun" }
            ]
        ]
    };
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// Handle kembali ke menu utama
async function handleBackToMain(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const username = user.username || "Tidak Ada";
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    const saldo = users[userId].saldo;
    const formattedSaldo = formatNumber(saldo);
    const stok = Object.keys(accounts).length;
    
    // Ambil username admin dari environment
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    
    const message = `
👋 <b>Selamat Datang Di Bot Order Otomatis</b>

🆔 <b>User ID:</b> <code>${userId}</code>
👤 <b>Username:</b> <code>@${username}</code>

💰 <b>Saldo Anda:</b> <code>Rp ${formattedSaldo}</code>
📦 <b>Stok Akun Tersedia:</b> <code>${stok}</code>

👨‍💼 <b>Admin:</b> ${adminUsername}

⚙️ <b>Gunakan menu di bawah ini untuk melanjutkan pembelian atau deposit.</b>
    `;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
            [{ text: "💳 Deposit Saldo", callback_data: "deposit" }]
        ]
    };
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}

// Handle proses pembelian
async function handleProsesPembelian(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const callbackData = callbackQuery.data;
    
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    const email = callbackData.split('_')[1];
    
    if (!accounts[email]) {
        const message = "<b>⚠️ Akun yang dipilih tidak tersedia.</b>";
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
    }
    
    const akun = accounts[email];
    const harga = akun.price;
    
    if (!users[userId]) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda belum terdaftar!", true);
        return;
    }
    
    const saldo = users[userId].saldo;
    if (saldo < harga) {
        const message = `
<b>💰 Saldo Anda tidak cukup untuk pembelian ini.</b>
Silakan top-up terlebih dahulu.
        `;
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
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
<b>Pembelian Berhasil!</b>

<b>Nama Produk:</b> <code>${akun.name}</code>
<b>Email/Username:</b> <code>${akun.email}</code>
<b>Password:</b> <code>${akun.password}</code>
<b>Total yang Dibayar:</b> <code>Rp ${formattedPrice}</code>
<b>Catatan Produk:</b>
${akun.note || 'Tidak ada catatan'}

<b>Saldo Anda Saat Ini:</b> <code>Rp ${formattedSaldo}</code>
    `;
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, akunStr);
    
    // Kirim notifikasi ke admin
    const username = user.username || "null";
    const adminMessage = `
<b>Notifikasi Pembelian</b>

<b>Username:</b> <code>@${username}</code>
<b>User ID:</b> <code>${userId}</code>
<b>Nama Produk:</b> <code>${akun.name}</code>
<b>Email/Username:</b> <code>${akun.email}</code>
<b>Password:</b> <code>${akun.password}</code>
<b>Harga:</b> <code>Rp ${formattedPrice}</code>
<b>Catatan Produk:</b>
${akun.note || 'Tidak ada catatan'}

<b>Saldo Setelah Pembelian:</b> <code>Rp ${formattedSaldo}</code>
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
}

// Handle deposit callback
async function handleDepositCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    
    // Cek apakah ada deposit pending di database
    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda masih memiliki deposit yang belum selesai. Silakan selesaikan atau batalkan deposit sebelumnya.", true);
        return;
    }
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    const formattedMinAmount = formatNumber(minAmount);
    
    const message = `
<b>Masukkan nominal deposit</b>

💰 <b>Minimal deposit:</b> <code>Rp ${formattedMinAmount}</code>

Silakan ketik jumlah saldo yang ingin Anda deposit:
    `;
    
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
}

// Handle message deposit
async function handleDepositMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;
    
    // Cek apakah ada deposit pending di database
    const pendingPayment = await getPendingPayment(env.BOT_DB, user.id);
    if (pendingPayment) {
        const responseMessage = `
⚠️ <b>Anda masih memiliki deposit yang belum selesai.</b>

Silakan selesaikan atau batalkan deposit sebelumnya sebelum melakukan deposit baru.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    try {
        const nominal = parseInt(text);
        const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
        
        if (isNaN(nominal) || nominal <= 0) {
            throw new Error("Nominal tidak valid");
        }
        
        if (nominal < minAmount) {
            const formattedMinAmount = formatNumber(minAmount);
            const responseMessage = `⚠️ <b>Nominal deposit minimal Rp ${formattedMinAmount}.</b>`;
            return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
        }
        
        // Buat QRIS dan konfirmasi
        await createQrisAndConfirm(env, user, nominal);
        
    } catch (error) {
        const responseMessage = "⚠️ <b>Nominal tidak valid. Harap masukkan angka.</b>";
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
}

// Buat QRIS dan konfirmasi
async function createQrisAndConfirm(env, user, nominal) {
    // Gunakan fungsi getRandomAmount yang baru dengan konfigurasi dari env
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    
    try {
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        const data = await response.json();
        
        if (data.status === "success") {
            const qrisUrl = data.data.download_url;
            const transactionId = data.data["kode transaksi"];
            
            // Simpan data pembayaran pending ke database
            const paymentData = {
                nominal: nominal,
                finalNominal: finalNominal,
                transactionId: transactionId,
                timestamp: new Date(),
                status: "pending",
                messageId: null // akan diisi setelah mengirim pesan
            };
            
            await savePendingPayment(env.BOT_DB, user.id, paymentData);
            
            const formattedNominal = formatNumber(nominal);
            const formattedFinal = formatNumber(finalNominal);
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ Konfirmasi Pembayaran", callback_data: `confirm_payment_${transactionId}` },
                        { text: "❌ Batalkan Pembayaran", callback_data: "cancel_payment" }
                    ]
                ]
            };
            
            const caption = `
<b>Top Up Pending</b>

🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>
💰 <b>Nominal:</b> <code>Rp ${formattedNominal}</code>
📊 <b>Fee Random:</b> <code>Rp ${randomAddition}</code>
💳 <b>Total:</b> <code>Rp ${formattedFinal}</code>
⏰ <b>Expired:</b> <code>10 minutes</code>

<b>Scan QRIS di atas untuk melakukan pembayaran.</b>

✅ <i>Setelah melakukan pembayaran, klik tombol "Konfirmasi Pembayaran" di bawah</i>
❌ <i>Jika ingin membatalkan, klik "Batalkan Pembayaran"</i>
            `;
            
            // Kirim photo QRIS dan simpan message ID
            const sentMessage = await sendTelegramPhoto(env.BOT_TOKEN, user.id, qrisUrl, caption, keyboard);
            if (sentMessage && sentMessage.ok) {
                // Update payment data dengan message ID
                paymentData.messageId = sentMessage.result.message_id;
                await savePendingPayment(env.BOT_DB, user.id, paymentData);
            }
            
            // Kirim notifikasi ke admin
            const adminMessage = `
<b>Pembayaran Pending</b>
<b>Username:</b> <code>@${user.username || 'N/A'}</code>
<b>User ID:</b> <code>${user.id}</code>
<b>Id Transaksi:</b> <code>${transactionId}</code>
<b>Nominal:</b> <code>${nominal}</code>
<b>Fee Random:</b> <code>${randomAddition}</code>
<b>Total Bayar:</b> <code>${finalNominal}</code>
            `;
            
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
        } else {
            await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Gagal membuat QRIS. Silakan coba lagi.</b>");
        }
    } catch (error) {
        console.error('Error creating QRIS:', error);
        await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Terjadi kesalahan saat membuat QRIS. Silakan coba lagi.</b>");
    }
}

// Handle konfirmasi pembayaran
async function handleConfirmPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const callbackData = callbackQuery.data;
    
    // Cek apakah ada pembayaran pending di database
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit yang pending. Silakan mulai deposit baru.", true);
        return;
    }
    
    const transactionId = callbackData.split('_')[2];
    
    // Pastikan transaction_id sesuai
    if (paymentData.transactionId !== transactionId) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ ID transaksi tidak sesuai.", true);
        return;
    }
    
    // Cek apakah pembayaran sudah expired
    const now = new Date();
    const paymentTime = new Date(paymentData.timestamp);
    const diffMinutes = (now - paymentTime) / (1000 * 60);
    
    if (diffMinutes > 10) {
        await removePendingPayment(env.BOT_DB, userId);
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran telah expired. Silakan buat deposit baru.", true);
        
        // Update pesan
        const expiredCaption = `
❌ <b>Pembayaran Expired</b>

🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>

Pembayaran telah expired. Silakan buat deposit baru.
        `;
        
        if (paymentData.messageId) {
            await editMessageCaption(env.BOT_TOKEN, user.id, paymentData.messageId, expiredCaption);
        }
        return;
    }
    
    // Cek pembayaran via API
    try {
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
                    // Pembayaran ditemukan, tambahkan saldo
                    const users = await loadDB(env.BOT_DB, 'users');
                    const userIdStr = userId.toString();
                    
                    if (!users[userIdStr]) {
                        users[userIdStr] = { saldo: 0 };
                    }
                    
                    users[userIdStr].saldo += paymentData.nominal;
                    await saveDB(env.BOT_DB, users, 'users');
                    
                    const formattedNominal = formatNumber(paymentData.nominal);
                    const formattedSaldo = formatNumber(users[userIdStr].saldo);
                    
                    // Hapus dari pending payments di database
                    await removePendingPayment(env.BOT_DB, userId);
                    
                    // Edit pesan asli
                    const newCaption = `
✅ <b>Pembayaran Berhasil Dikonfirmasi!</b>

🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>
💰 <b>Nominal:</b> <code>Rp ${formattedNominal}</code>
💳 <b>Saldo Anda Sekarang:</b> <code>Rp ${formattedSaldo}</code>

Terima kasih telah melakukan top-up! 😊
                    `;
                    
                    if (paymentData.messageId) {
                        await editMessageCaption(
                            env.BOT_TOKEN,
                            user.id,
                            paymentData.messageId,
                            newCaption
                        );
                    }
                    
                    // Kirim notifikasi ke admin
                    const adminMessage = `
<b>Pembayaran Dikonfirmasi</b>
<b>Username:</b> <code>@${user.username || 'null'}</code>
<b>User ID:</b> <code>${userId}</code>
<b>Id Transaksi:</b> <code>${transactionId}</code>
<b>Nominal:</b> <code>${paymentData.nominal}</code>
<b>Saldo Baru:</b> <code>${users[userIdStr].saldo}</code>
                    `;
                    
                    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
                    
                    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "✅ Pembayaran berhasil dikonfirmasi! Saldo telah ditambahkan.", true);
                } else {
                    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Pembayaran belum terdeteksi. Silakan tunggu beberapa menit atau hubungi admin jika sudah melakukan pembayaran.", true);
                }
            } else {
                await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal memeriksa pembayaran. Silakan coba lagi.", true);
            }
        } else {
            await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Gagal terhubung ke sistem pembayaran. Silakan coba lagi.", true);
        }
    } catch (error) {
        console.error('Error checking payment:', error);
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, `❌ Terjadi kesalahan: ${error.message}`, true);
    }
}

// Handle batalkan pembayaran
async function handleCancelPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    
    // Cek apakah ada pembayaran pending di database
    const paymentData = await getPendingPayment(env.BOT_DB, userId);
    if (!paymentData) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit yang pending.", true);
        return;
    }
    
    // Hapus dari pending payments di database
    const transactionId = paymentData.transactionId;
    await removePendingPayment(env.BOT_DB, userId);
    
    // Edit pesan asli
    const newCaption = `
❌ <b>Pembayaran Dibatalkan</b>

🆔 <b>ID Transaksi:</b> <code>${transactionId}</code>

Pembayaran telah dibatalkan. Anda dapat melakukan deposit kembali kapan saja.
    `;
    
    if (paymentData.messageId) {
        await editMessageCaption(
            env.BOT_TOKEN,
            user.id,
            paymentData.messageId,
            newCaption
        );
    }
    
    // Kirim notifikasi ke admin
    const adminMessage = `
<b>Pembayaran Dibatalkan</b>
<b>Username:</b> <code>@${user.username || 'null'}</code>
<b>User ID:</b> <code>${userId}</code>
<b>Id Transaksi:</b> <code>${transactionId}</code>
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran telah dibatalkan.", true);
}

// Handle admin command
async function handleAdmin(update, env) {
    const message = update.message;
    const user = message.from;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        const responseMessage = `
❌ <b>Akses ditolak!</b>

Hanya admin yang dapat menggunakan perintah ini.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    const users = await loadDB(env.BOT_DB, 'users');
    const totalMembers = Object.keys(users).length;
    
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
                { text: "👥 Cek Member", callback_data: "admin_cek_member" }
            ],
            [
                { text: "📢 Broadcast", callback_data: "admin_broadcast" }
            ],
            [
                { text: "⏰ Cek Pending Payments", callback_data: "admin_cek_pending" }
            ]
        ]
    };
    
    const adminMessage = `
👮 <b>Admin Menu</b>

👥 <b>Total Member:</b> <code>${totalMembers}</code>

Silakan pilih aksi yang ingin dilakukan dengan menekan tombol di bawah ini:
    `;
    
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMessage, keyboard);
}

// Handle admin actions callback
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

Kirimkan ID user dan jumlah saldo yang ingin ditambahkan.
<b>Format:</b> <code>id jumlah</code>

Contoh:
<code>12345 100</code>
            `;
            userSessions.set(user.id, { action: 'tambah_saldo' });
            break;
            
        case "admin_kurangi_saldo":
            message = `
📝 <b>Kurangi Saldo</b>

Kirimkan ID user dan jumlah saldo yang ingin dikurangi.
<b>Format:</b> <code>id jumlah</code>

Contoh:
<code>12345 50</code>
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

Kirimkan <b>email akun</b> yang ingin dihapus.
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

Balas pesan ini dengan perintah <code>/broadcast</code> untuk mengirim pesan ke semua user.

Atau gunakan format:
<code>/broadcast id1,id2,id3</code> untuk mengirim ke user tertentu.
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

📋 <b>Total:</b> <code>${pendingCount}</code>

${pendingInfo}
                `;
            }
            break;
    }
    
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
}

// Handle admin message processing
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
                
                if (!users[targetId]) {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>User tidak ditemukan.</b>");
                    userSessions.delete(user.id);
                    return;
                }
                
                if (session.action === 'tambah_saldo') {
                    users[targetId].saldo += amount;
                } else {
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
✅ <b>Saldo Anda telah diperbarui!</b>
🔹 ${session.action === 'tambah_saldo' ? 'Penambahan' : 'Pengurangan'}: <code>Rp ${formattedAmount}</code>
💰 <b>Saldo saat ini:</b> <code>Rp ${formattedSaldo}</code>
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
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan harga:</b>");
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
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "<b>Masukkan catatan akun (misal: detail login/2FA)</b>");
                } else if (step === 'catatan') {
                    data.note = text.toLowerCase() !== "tidak ada" ? text : "Tidak ada catatan";
                    const formattedPrice = formatNumber(data.price);
                    
                    accounts[data.email] = data;
                    await saveDB(env.BOT_DB, accounts, 'accounts');
                    
                    const addedAccountMsg = `
<b>Akun berhasil ditambahkan:</b>
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
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Akun tidak ditemukan.</b>");
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

// Handle broadcast command
async function handleBroadcast(update, env) {
    const message = update.message;
    const user = message.from;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        const responseMessage = `
❌ <b>Akses Ditolak!</b>

Anda tidak memiliki akses ke perintah ini.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    if (!message.reply_to_message) {
        const responseMessage = `
⚠️ <b>Perintah Tidak Lengkap!</b>

Silakan balas pesan yang ingin di-broadcast dengan perintah <code>/broadcast</code>, atau tambahkan ID spesifik dengan format <code>/broadcast id1,id2,...</code> di balasan.
        `;
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, responseMessage);
    }
    
    const replyMessage = message.reply_to_message;
    const specificIds = message.text.split(' ')[1]?.split(',').filter(id => id.trim()) || [];
    
    const users = await loadDB(env.BOT_DB, 'users');
    const targetUsers = specificIds.length > 0 ? specificIds : Object.keys(users);
    const targetType = specificIds.length > 0 ? "ID tertentu" : "semua pengguna";
    
    let successCount = 0;
    let failedCount = 0;
    
    // Kirim broadcast ke setiap user
    for (const targetId of targetUsers) {
        try {
            if (replyMessage.text) {
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), replyMessage.text);
            } else {
                // Untuk tipe media lain, kirim pesan teks sederhana
                await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetId), "📢 <b>Pesan Broadcast dari Admin</b>\n\nHubungi admin untuk informasi lebih lanjut.");
            }
            successCount++;
        } catch (error) {
            failedCount++;
        }
        
        // Tunggu sebentar untuk menghindari rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const resultMessage = `
🎉 <b>Broadcast Selesai!</b>

📍 Target: <b>${targetType}</b>
✅ <b>Berhasil terkirim:</b> <code>${successCount}</code>
❌ <b>Gagal terkirim:</b> <code>${failedCount}</code>

Terima kasih telah menggunakan bot ini! 😊
    `;
    
    await sendTelegramMessage(env.BOT_TOKEN, user.id, resultMessage);
}

// Cleanup expired payments secara otomatis
async function cleanupExpiredPayments(env) {
    try {
        const pendingPayments = await loadPendingPayments(env.BOT_DB);
        const now = new Date();
        let cleanedCount = 0;
        
        for (const [userId, payment] of Object.entries(pendingPayments)) {
            const paymentTime = new Date(payment.timestamp);
            const diffMinutes = (now - paymentTime) / (1000 * 60);
            
            if (diffMinutes > 10) { // Expired setelah 10 menit
                // Kirim notifikasi expired ke user
                const expiredCaption = `
❌ <b>Pembayaran Expired</b>

🆔 <b>ID Transaksi:</b> <code>${payment.transactionId}</code>

Pembayaran telah expired. Silakan buat deposit baru.
                `;
                
                if (payment.messageId) {
                    await editMessageCaption(env.BOT_TOKEN, parseInt(userId), payment.messageId, expiredCaption);
                }
                
                // Hapus dari database
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

// Main router handler
router.post('/', async (request, env) => {
    try {
        const update = await request.json();
        
        // Cleanup expired payments setiap kali ada request
        await cleanupExpiredPayments(env);
        
        // Handle different types of updates
        if (update.message) {
            const text = update.message.text || '';
            
            if (text.startsWith('/start')) {
                return new Response(JSON.stringify(await handleStart(update, env)));
            } else if (text.startsWith('/id')) {
                return new Response(JSON.stringify(await handleGetId(update, env)));
            } else if (text.startsWith('/admin')) {
                return new Response(JSON.stringify(await handleAdmin(update, env)));
            } else if (text.startsWith('/broadcast')) {
                return new Response(JSON.stringify(await handleBroadcast(update, env)));
            } else if (update.message.text && !text.startsWith('/')) {
                // Handle regular messages
                const user = update.message.from;
                
                // Cek jika admin sedang dalam session
                if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) {
                    return new Response(JSON.stringify(await handleAdminMessage(update, env)));
                }
                
                // Handle deposit message untuk user biasa
                return new Response(JSON.stringify(await handleDepositMessage(update, env)));
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

router.get('/', () => new Response('Telegram Bot is running!'));

export default {
    fetch: router.handle
};
