import { Router } from 'itty-router'; // Pastikan ini ada

const router = Router();

// In-memory storage untuk sessions & rate limiting
const userSessions = new Map();
const userMessageTimestamps = new Map(); // Untuk anti-spam

// --- (BAGIAN 1: HELPER FUNCTIONS & KONFIGURASI) ---
// (Semua helper functions: loadDB, saveDB, load/save/remove/get PendingPayments,
// getConfig, saveConfig, formatNumber, getRandomAmount, send/edit Messages/Photos,
// answerCallbackQuery, sendLogNotification, formatUptime - TETAP SAMA)

async function loadDB(binding, dbType) { try { const d = await binding.get(dbType, 'json'); return d || {}; } catch (e) { console.error(`KV ${dbType} load err:`, e); return {}; } }
async function saveDB(binding, data, dbType) { try { await binding.put(dbType, JSON.stringify(data)); return true; } catch (e) { console.error(`KV ${dbType} save err:`, e); return false; } }
async function loadPendingPayments(binding) { try { const d = await binding.get('pending_payments', 'json'); return d || {}; } catch (e) { console.error(`KV pending load err:`, e); return {}; } }
async function savePendingPayment(binding, userId, pData) { try { const p = await loadPendingPayments(binding); p[String(userId)] = { ...pData, timestamp: pData.timestamp.toISOString() }; await binding.put('pending_payments', JSON.stringify(p)); return true; } catch (e) { console.error('KV pending save err:', e); return false; } }
async function removePendingPayment(binding, userId) { try { const p = await loadPendingPayments(binding); const uid = String(userId); if (p[uid]) { delete p[uid]; await binding.put('pending_payments', JSON.stringify(p)); } return true; } catch (e) { console.error('KV pending remove err:', e); return false; } }
async function getPendingPayment(binding, userId) { try { const p = await loadPendingPayments(binding); const uid = String(userId); const pm = p[uid]; if (pm) { return { ...pm, timestamp: new Date(pm.timestamp) }; } return null; } catch (e) { console.error('KV pending get err:', e); return null; } }
async function getConfig(binding) { try { const c = await binding.get('config', 'json'); const d = { bonus_percentage: 0, total_transactions: 0, deployment_timestamp: null }; return c && typeof c === 'object' ? { ...d, ...c } : d; } catch (e) { console.error('KV config load err:', e); return { bonus_percentage: 0, total_transactions: 0, deployment_timestamp: null }; } }
async function saveConfig(binding, cData) { try { await binding.put('config', JSON.stringify(cData)); return true; } catch (e) { console.error('KV config save err:', e); return false; } }
function formatNumber(n) { const num = Number(n); return isNaN(num) ? String(n) : num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function getRandomAmount(env) { const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1; const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50; return Math.floor(Math.random() * (max - min + 1)) + min; }
async function sendTelegramMessage(t, c, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendMessage`; const pl = { chat_id: c, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG sendMsg err:', e); return null; } }
async function sendTelegramPhoto(t, c, pUrl, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendPhoto`; const pl = { chat_id: c, photo: pUrl, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { console.log(`Sending photo to ${c}. URL: ${pUrl}`); const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); const result = await r.json(); console.log(`TG sendPhoto response for ${c}: ${JSON.stringify(result)}`); return result; } catch (e) { console.error('TG sendPhoto err:', e); return null; } } // Added logging
async function editMessageText(t, c, mId, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageText`; const pl = { chat_id: c, message_id: mId, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editTxt err:', e); return null; } }
async function editMessageCaption(t, c, mId, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageCaption`; const pl = { chat_id: c, message_id: mId, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editCap err:', e); return null; } }
async function answerCallbackQuery(t, qId, txt = null, alert = false) { const url = `https://api.telegram.org/bot${t}/answerCallbackQuery`; const pl = { callback_query_id: qId }; if (txt) { pl.text = txt; pl.show_alert = alert; } try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG answerCbQ err:', e); return null; } }
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'AUTO_BAN') { msg += `🚫 <b>SPAM DETECTED & BANNED!</b>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }
function formatUptime(startTimeISO) { if (!startTimeISO) return "Baru saja"; const start = new Date(startTimeISO); const now = new Date(); const diffMs = now - start; if (diffMs < 0) return "Baru saja"; const d = Math.floor(diffMs / 86400000); const h = Math.floor((diffMs % 86400000) / 3600000); const m = Math.floor((diffMs % 3600000) / 60000); let str = ""; if (d > 0) str += `${d}H `; if (h > 0) str += `${h}J `; str += `${m}M`; return str.trim() || "0M"; }


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Sesuai Request V2)) ---

// ** ✨ Handle /start & Kembali (Teks Sesuai Request + Tanpa Tombol Akun) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = `𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃`; // Nama bold khusus dari request
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    let config = await getConfig(env.BOT_DB);

    // Cek ban status
    if (users[userId]?.is_banned) {
        const bannedMessage = `🚫 Akun Anda (ID: <code>${userId}</code>) saat ini sedang <b>diblokir</b>.\nSilakan hubungi admin ${env.ADMIN_USERNAME || '@TeamNexusDev'} untuk informasi lebih lanjut.`;
        if (isEdit && messageId) {
             if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🚫 Akun Diblokir", true);
             // Jangan edit jika pesan sudah merupakan pesan ban
             if (callbackQueryId && update.callback_query.message.text !== bannedMessage) {
                 return await editMessageText(env.BOT_TOKEN, user.id, messageId, bannedMessage);
             } else if (!callbackQueryId) {
                  return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage); // Kirim jika /start
             }
        } else {
             return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage);
        }
        return new Response('OK (Banned user)'); // Kembalikan OK agar tidak error
    }


    // Init timestamp & register user baru (sama seperti V4)
    let needsSave = false; if (!config.deployment_timestamp) { config.deployment_timestamp = new Date().toISOString(); needsSave = true; } if (needsSave) await saveConfig(env.BOT_DB, config);
    if (!isEdit && !users[userId]) { users[userId] = { saldo: 0, joined: new Date().toISOString(), is_banned: false }; await saveDB(env.BOT_DB, users, 'users'); }

    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const totalUsers = Object.keys(users).length;
    const totalTransactions = config.total_transactions || 0;
    const uptime = formatUptime(config.deployment_timestamp);
    const adminUsername = env.ADMIN_USERNAME || "@TeamNexusDev";
    const botName = env.BOT_NAME || "𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃";

    // ** Teks Persis Sesuai Request **
    const message = `
Halo, <b>${userFirstName}</b>! 👋

Selamat datang di ${botName}.
Solusi digital otomatis Anda.

┌ INFORMASI AKUN ANDA
├ 🆔 User ID: <code>${userId}</code>
└ 💰 Saldo: <code>Rp ${formatNumber(saldo)}</code>

┌ STATISTIK BOT
├ 👥 Total Pengguna: ${totalUsers}
├ ✅ Transaksi Sukses: ${totalTransactions}
├ 📦 Stok Tersedia: ${stok} Akun
└ ⏱️ Bot Aktif Sejak: ${uptime}

┌ BANTUAN
└ 👨‍💼 Admin: ${adminUsername}

👇 Silakan pilih menu di bawah ini:
    `;

    // ** Keyboard Tanpa Tombol Akun Saya **
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Katalog Produk", callback_data: "beli_akun" },
                { text: "💳 Isi Saldo (Deposit)", callback_data: "deposit" }
            ],
            [ // Baris kedua sekarang hanya Refresh
                { text: "🔄 Perbarui Menu", callback_data: "back_to_main" }
            ]
        ]
    };

    if (isEdit && messageId) {
        if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🔄 Menu diperbarui");
        // Hindari mengedit jika teks sudah sama (mencegah error 'message is not modified')
        if (callbackQueryId && update.callback_query.message.text === message) return new Response('OK (No change)');
        return await editMessageText(env.BOT_TOKEN, user.id, messageId, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
    }
}
async function handleStart(update, env) { return displayMainMenu(env, update.message.from); }
async function handleBackToMain(update, env) { return displayMainMenu(env, update.callback_query.from, true, update.callback_query.message.message_id, update.callback_query.id); }

// ** ✨ Handle /id (Tetap ada, tapi tidak ada tombolnya) ✨ **
async function handleGetId(update, env) { /* ... (Kode V4 Premium tetap sama) ... */ }

// (handleBeliAkunCallback, handleDetailAkun, handleProsesPembelian, handleDepositCallback,
// handleDepositMessage - TETAP SAMA seperti V4 Premium)
async function handleBeliAkunCallback(update, env) { /* ... */ }
async function handleDetailAkun(update, env) { /* ... */ }
async function handleProsesPembelian(update, env) { /* ... */ }
async function handleDepositCallback(update, env) { /* ... */ }
async function handleDepositMessage(update, env) { /* ... */ }

// ** ✨ Create QRIS (PERBAIKAN LOGGING & ERROR HANDLING V2) ✨ **
async function createQrisAndConfirm(env, user, nominal) {
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    const userId = user.id; // Ambil userId untuk logging

    try {
        console.log(`[User ${userId}] Requesting QRIS for amount: ${finalNominal} (Nominal: ${nominal}, Random: ${randomAddition})`);
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        console.log(`[User ${userId}] QRIS API Status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[User ${userId}] QRIS API Error Response Text:`, errorText);
            throw new Error(`API Pembayaran mengembalikan status ${response.status}`);
        }

        const data = await response.json();
        // Log respons lengkap untuk debugging
        console.log(`[User ${userId}] QRIS API Success Response JSON:`, JSON.stringify(data, null, 2));

        // ** PENTING: Sesuaikan path ini dengan respons API Anda **
        // Mencoba mengambil dari beberapa kemungkinan path umum
        const qrisUrl = data?.data?.download_url || data?.download_url || data?.data?.qris_url || data?.qris_url;
        const transactionId = data?.data?.["kode transaksi"] || data?.data?.transaction_id || data?.transaction_id || data?.id;
        // **********************************************************

        if (!qrisUrl || !transactionId) {
             console.error(`[User ${userId}] Missing qrisUrl or transactionId in API response structure.`);
             throw new Error("Data QRIS tidak lengkap dari API pembayaran.");
        }
        console.log(`[User ${userId}] Extracted QRIS URL: ${qrisUrl}`);
        console.log(`[User ${userId}] Extracted Transaction ID: ${transactionId}`);

        // --- Lanjutan proses jika URL dan ID didapat ---
        const pData = { nominal, finalNominal, transactionId, timestamp: new Date(), status: "pending", messageId: null };
        const saveStatus = await savePendingPayment(env.BOT_DB, userId, pData);
        if (!saveStatus) {
            console.error(`[User ${userId}] Failed to save pending payment to KV.`);
            throw new Error("Gagal menyimpan data deposit sementara.");
        }

        const keyboard = { inline_keyboard: [[{ text: "✅ Saya Sudah Transfer", callback_data: `confirm_payment_${transactionId}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }]] };
        const caption = `⏳ ===「 <b>INSTRUKSI DEPOSIT</b> 」=== ⏳\n\nTransfer <b>TEPAT</b> <code>Rp ${formatNumber(finalNominal)}</code>\n──────────────────\nID: <code>${transactionId}</code>\nNominal: <code>Rp ${formatNumber(nominal)}</code>\nKode Unik: <code>Rp ${randomAddition}</code>\n<b>TOTAL:</b> 👉 <h1><code>Rp ${formatNumber(finalNominal)}</code></h1> 👈\n──────────────────\nScan QRIS.\nBatas waktu: ⏱️ <b>10 menit</b>.\n\nKlik "✅ Sudah Transfer" <b>SETELAH</b> transfer.`;

        const sent = await sendTelegramPhoto(env.BOT_TOKEN, userId, qrisUrl, caption, keyboard);

        if (sent?.ok) {
            pData.messageId = sent.result.message_id;
            await savePendingPayment(env.BOT_DB, userId, pData); // Update message ID
            console.log(`[User ${userId}] QRIS Photo sent successfully, msg_id: ${pData.messageId}`);
        } else {
            console.error(`[User ${userId}] Failed to send QRIS photo. TG Response:`, JSON.stringify(sent));
            await sendTelegramMessage(env.BOT_TOKEN, userId, "❌ Gagal menampilkan gambar QRIS saat ini. Mohon coba lagi nanti atau hubungi admin.");
            await removePendingPayment(env.BOT_DB, userId); // Hapus pending jika gagal kirim foto
            return;
        }

        const adminMsg = `⏳ Depo Pending: @${user.username || userId} | ${transactionId} | Rp ${formatNumber(finalNominal)}`;
        await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMsg);

    } catch (e) {
        console.error(`[User ${userId}] Create QRIS overall err:`, e);
        // Beri pesan error yang lebih informatif ke user
        let userErrorMessage = "❌ Terjadi kesalahan saat membuat QRIS.";
        if (e.message.includes("API")) {
            userErrorMessage += " Masalah pada sistem pembayaran.";
        } else if (e.message.includes("menyimpan data")) {
             userErrorMessage += " Gagal menyimpan info deposit.";
        }
        userErrorMessage += " Silakan coba lagi nanti atau hubungi admin.";
        await sendTelegramMessage(env.BOT_TOKEN, userId, userErrorMessage);
        try { await removePendingPayment(env.BOT_DB, userId); } catch (removeErr) {} // Best effort cleanup
    }
}


// (handleConfirmPayment, handleCancelPayment - TETAP SAMA seperti V4 Premium)
async function handleConfirmPayment(update, env) { /* ... (Kode V4 Premium) ... */ }
async function handleCancelPayment(update, env) { /* ... (Kode V4 Premium) ... */ }


// --- (BAGIAN 3: LOGIKA ADMIN (Dengan Fitur Ban/Unban & Cancel Deposit)) ---
// (handleAdmin, handleAdminActions, handleAdminMessage, handleBroadcast - SAMA seperti V4 Premium)
async function handleAdmin(update, env) { /* ... (Kode V4 Premium) ... */ }
async function handleAdminActions(update, env) { /* ... (Kode V4 Premium) ... */ }
async function handleAdminMessage(update, env) { /* ... (Kode V4 Premium) ... */ }
async function handleBroadcast(update, env) { /* ... (Kode V4 Premium) ... */ }

// --- (BAGIAN 4: CLEANUP & WEB INFO) ---
async function cleanupExpiredPayments(env) { /* ... (Kode V4 Premium dengan notif user) ... */ }
function handleInfo(env) { /* ... (Kode V4 Premium tampilan web) ... */ }


// --- (BAGIAN 5: ROUTING MENGGUNAKAN ITTY-ROUTER + ANTI-SPAM + PERBAIKAN /ADMIN) ---

router.post('/', async (request, env, ctx) => {
    try {
        const update = await request.json();
        ctx.waitUntil(cleanupExpiredPayments(env));
        let responseObj = null;

        // Anti-Spam Logic (Sama seperti V4)
        if (update.message) {
            const user = update.message.from; const userId = user.id.toString(); const isAdmin = userId === env.ADMIN_ID;
            const users = await loadDB(env.BOT_DB, 'users');
            if (!isAdmin && !(users[userId]?.is_banned)) {
                const now = Date.now(); const limit = parseInt(env.SPAM_MESSAGE_COUNT) || 5; const window = parseInt(env.SPAM_TIME_WINDOW_MS) || 5000;
                const timestamps = userMessageTimestamps.get(userId) || []; const recent = timestamps.filter(ts => now - ts < window);
                recent.push(now); userMessageTimestamps.set(userId, recent);
                if (recent.length > limit) {
                    console.log(`Auto-banning user ${userId} for spam.`); if (!users[userId]) users[userId] = { saldo: 0, joined: new Date().toISOString() };
                    users[userId].is_banned = true; await saveDB(env.BOT_DB, users, 'users');
                    await sendTelegramMessage(env.BOT_TOKEN, userId, "🚫 Anda terdeteksi spam & diblokir sementara.");
                    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, `🚫 Auto Ban: @${user.username || userId} (<code>${userId}</code>) diblokir karena spam.`);
                    await sendLogNotification(env, 'AUTO_BAN', user, {}); userMessageTimestamps.delete(userId);
                    return new Response('OK (Banned)');
                }
            }
        }
        // End Anti-Spam

        // Main Routing Logic
        if (update.message) {
            const text = update.message.text || ''; const user = update.message.from; const session = userSessions.get(user.id);
            const usersData = await loadDB(env.BOT_DB, 'users'); // Reload users data

            // ** PERBAIKAN: Prioritaskan Perintah /admin jika dikirim oleh admin **
            if (text.startsWith('/admin') && user.id.toString() === env.ADMIN_ID) {
                 // Hapus sesi admin sebelumnya jika ada, agar tidak konflik
                 if (session) userSessions.delete(user.id);
                 responseObj = await handleAdmin(update, env);
            }
            // Cek Ban (setelah cek /admin)
            else if (usersData[user.id.toString()]?.is_banned && text.startsWith('/')) {
                 await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚫 Akun Anda diblokir.`);
                 responseObj = null;
            }
            // Prioritas Sesi Deposit
            else if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) {
                responseObj = await handleDepositMessage(update, env);
            }
            // Prioritas Sesi Admin (selain /admin)
            else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) {
                responseObj = await handleAdminMessage(update, env);
            }
            // Perintah Lainnya
            else if (text.startsWith('/start'))   responseObj = await handleStart(update, env);
            else if (text.startsWith('/id'))      responseObj = await handleGetId(update, env);
            else if (text.startsWith('/broadcast') && user.id.toString() === env.ADMIN_ID) { // Pastikan hanya admin
                 responseObj = await handleBroadcast(update, env);
            }
            // Abaikan teks biasa dari non-admin di luar sesi
            else if (user.id.toString() !== env.ADMIN_ID && !session && !text.startsWith('/')) {
                 responseObj = null; // Do nothing
            }

        } else if (update.callback_query) {
             // ... (Logika callback query tetap sama seperti V4, termasuk cek ban)
             const user = update.callback_query.from; const usersData = await loadDB(env.BOT_DB, 'users');
             if (usersData[user.id.toString()]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id, "🚫 Akun Anda diblokir", true); responseObj = null; }
             else {
                 const cbData = update.callback_query.data;
                      if (cbData === 'beli_akun')           responseObj = await handleBeliAkunCallback(update, env);
                 else if (cbData.startsWith('group_'))      responseObj = await handleDetailAkun(update, env);
                 else if (cbData.startsWith('beli_'))       responseObj = await handleProsesPembelian(update, env);
                 else if (cbData === 'deposit')              responseObj = await handleDepositCallback(update, env);
                 else if (cbData.startsWith('confirm_payment_')) responseObj = await handleConfirmPayment(update, env);
                 else if (cbData === 'cancel_payment')      responseObj = await handleCancelPayment(update, env);
                 else if (cbData.startsWith('admin_'))      responseObj = await handleAdminActions(update, env);
                 else if (cbData === 'back_to_main')        responseObj = await handleBackToMain(update, env);
                 // info_akun dihapus
             }
        }

        // Handle return values
        if (responseObj instanceof Response) return responseObj;
        else if (responseObj) return new Response(JSON.stringify(responseObj));
        else return new Response('OK');
    } catch (e) { console.error('TG Update Err:', e); return new Response('Internal Server Error', { status: 500 }); }
});

// Endpoint Tampilan Web & Fallback
router.get('/info', (req, env) => handleInfo(env));
router.get('/', () => new Response('💎 Bot Aktif! /info untuk status.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
router.all('*', () => new Response('404 Not Found - Endpoint tidak valid.', { status: 404 }));

// Export handler
export default { fetch: router.handle };
