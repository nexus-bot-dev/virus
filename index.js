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
async function sendTelegramPhoto(t, c, pUrl, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendPhoto`; const pl = { chat_id: c, photo: pUrl, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG sendPhoto err:', e); return null; } }
async function editMessageText(t, c, mId, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageText`; const pl = { chat_id: c, message_id: mId, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editTxt err:', e); return null; } }
async function editMessageCaption(t, c, mId, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageCaption`; const pl = { chat_id: c, message_id: mId, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editCap err:', e); return null; } }
async function answerCallbackQuery(t, qId, txt = null, alert = false) { const url = `https://api.telegram.org/bot${t}/answerCallbackQuery`; const pl = { callback_query_id: qId }; if (txt) { pl.text = txt; pl.show_alert = alert; } try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG answerCbQ err:', e); return null; } }
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'AUTO_BAN') { msg += `🚫 <b>SPAM DETECTED & BANNED!</b>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }
function formatUptime(startTimeISO) { if (!startTimeISO) return "Baru saja"; const start = new Date(startTimeISO); const now = new Date(); const diffMs = now - start; if (diffMs < 0) return "Baru saja"; const d = Math.floor(diffMs / 86400000); const h = Math.floor((diffMs % 86400000) / 3600000); const m = Math.floor((diffMs % 3600000) / 60000); let str = ""; if (d > 0) str += `${d}H `; if (h > 0) str += `${h}J `; str += `${m}M`; return str.trim() || "0M"; }


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Sesuai Request)) ---

// ** ✨ Handle /start & Kembali (Teks Sesuai Request + Tanpa Tombol Akun) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = `𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃`; // Nama bold khusus
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    let config = await getConfig(env.BOT_DB);

    // Cek ban status
    if (users[userId]?.is_banned) {
        const bannedMessage = `🚫 Akun Anda (ID: <code>${userId}</code>) saat ini sedang <b>diblokir</b>.\nSilakan hubungi admin ${env.ADMIN_USERNAME || '@TeamNexusDev'} untuk informasi lebih lanjut.`;
        if (isEdit && messageId) {
             if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🚫 Akun Diblokir", true);
             return await editMessageText(env.BOT_TOKEN, user.id, messageId, bannedMessage);
        } else {
             return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage);
        }
    }

    // Init timestamp
    let needsSave = false; if (!config.deployment_timestamp) { config.deployment_timestamp = new Date().toISOString(); needsSave = true; } if (needsSave) await saveConfig(env.BOT_DB, config);
    // Register user baru
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
        return await editMessageText(env.BOT_TOKEN, user.id, messageId, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
    }
}
async function handleStart(update, env) { return displayMainMenu(env, update.message.from); }
async function handleBackToMain(update, env) { return displayMainMenu(env, update.callback_query.from, true, update.callback_query.message.message_id, update.callback_query.id); }

// ** ✨ Handle /id (Tetap ada, tapi tidak ada tombolnya) ✨ **
async function handleGetId(update, env) {
    const user = update.message.from;
    const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');

    // Cek Ban
    if (users[userId]?.is_banned) {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚫 Akun Anda (<code>${userId}</code>) diblokir.`);
    }

    const saldo = users[userId]?.saldo || 0;
    const joinDate = users[userId]?.joined ? new Date(users[userId].joined).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}) : 'N/A';
    const message = `👤 ===「 <b>PROFIL ANDA</b> 」=== 👤\n\n✨ Nama: ${user.first_name || '-'} ${user.last_name || ''}\n📧 Username: @${user.username || '-'}\n🆔 User ID: <code>${user.id}</code>\n📅 Bergabung: ${joinDate}\n\n💰 Saldo: <code>Rp ${formatNumber(saldo)}</code>\n──────────────────`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message);
}
// (handleGetInfoAkun dihapus karena tombolnya hilang)


// (handleBeliAkunCallback, handleDetailAkun, handleProsesPembelian, handleDepositCallback,
// handleDepositMessage, createQrisAndConfirm, handleConfirmPayment, handleCancelPayment - TETAP SAMA)
async function handleBeliAkunCallback(update, env) { /* ... (Kode V3 Premium) ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const saldo = usrs[uid]?.saldo || 0; if (Object.keys(accs).length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok kosong!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `⚠️ Stok kosong, <b>${user.first_name}</b>.`, { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }); } const grouped = {}; for (const [e, a] of Object.entries(accs)) { const k = `${a.name}_${a.price}`; if (!grouped[k]) grouped[k] = { c: 0, p: a.price, n: a.name }; grouped[k].c++; } const sorted = Object.entries(grouped).sort(([, a], [, b]) => a.n.localeCompare(b.n)); const kBtns = sorted.map(([k, d]) => { let ej = "🔹"; if (d.n.toLowerCase().includes('vpn')) ej = "🌐"; else if (d.n.toLowerCase().includes('premium')) ej = "⭐"; else if (d.n.toLowerCase().includes('netflix')) ej = "🎬"; else if (d.n.toLowerCase().includes('spotify')) ej = "🎵"; return [{ text: `${ej} ${d.n} [${d.c}] - Rp ${formatNumber(d.p)}`, callback_data: `group_${d.n}_${d.p}` }]; }); const kb = { inline_keyboard: [...kBtns, [{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }; const msg = `🛒 ===「 <b>KATALOG</b> 」=== 🛒\nSaldo: 💰 <code>Rp ${formatNumber(saldo)}</code>\n\nPilih produk:\n<i>(Stok: [ ])</i>`; await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb); }
async function handleDetailAkun(update, env) { /* ... (Kode V3 Premium) ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const cbData = cbQ.data; const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const saldo = usrs[uid]?.saldo || 0; const [, name, price] = cbData.split('_'); const priceInt = parseInt(price); const filtered = Object.entries(accs).filter(([e, a]) => a.name === name && a.price === priceInt); if (filtered.length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok habis!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `❌ Stok <b>${name}</b> habis.`, { inline_keyboard: [[{ text: "🛒 Katalog", callback_data: "beli_akun" }]] }); } const [email] = filtered[0]; const akun = accs[email]; const canBuy = saldo >= akun.price; let msg = `💎 <b>DETAIL & KONFIRMASI</b> 💎\n──────────────────\n🏷️ <b>Produk:</b> ${akun.name}\n──────────────────\n📄 <b>Deskripsi:</b>\n   ${akun.description || '<i>N/A</i>'}\n──────────────────\n💰 <b>Harga:</b> <code>Rp ${formatNumber(akun.price)}</code>\n📦 <b>Stok:</b> ${filtered.length}\n──────────────────\n🏦 Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>\n`; const kbRow = []; if (canBuy) { msg += `\n✅ Konfirmasi pembelian?`; kbRow.push({ text: `🛒 Beli (Rp ${formatNumber(akun.price)})`, callback_data: `beli_${email}` }, { text: " Katalog", callback_data: "beli_akun" }); } else { msg += `\n⚠️ Saldo kurang: <code>Rp ${formatNumber(akun.price - saldo)}</code>`; kbRow.push({ text: "💳 Isi Saldo", callback_data: "deposit" }, { text: " Katalog", callback_data: "beli_akun" }); } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, { inline_keyboard: [kbRow] }); }
async function handleProsesPembelian(update, env) { /* ... (Kode V3 Premium dengan update counter) ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const cbData = cbQ.data; const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const email = cbData.split('_')[1]; if (!accs[email]) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Akun terjual!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, "<b>⚠️ Akun sudah terjual.</b>", { inline_keyboard: [[{ text: "🛒 Kembali ke Katalog", callback_data: "beli_akun" }]] }); } const akun = accs[email]; const harga = akun.price; if (!usrs[uid]) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "⚠️ /start dulu!", true); return; } const saldo = usrs[uid].saldo; if (saldo < harga) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Saldo kurang!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `<b>🚫 SALDO KURANG</b>\nSaldo: <code>Rp ${formatNumber(saldo)}</code>\nHarga: <code>Rp ${formatNumber(harga)}</code>`, { inline_keyboard: [[{ text: "💳 Isi Saldo", callback_data: "deposit" }]] }); } usrs[uid].saldo -= harga; await saveDB(env.BOT_DB, usrs, 'users'); delete accs[email]; await saveDB(env.BOT_DB, accs, 'accounts'); const currentSaldo = usrs[uid].saldo; const cfg = await getConfig(env.BOT_DB); cfg.total_transactions = (cfg.total_transactions || 0) + 1; await saveConfig(env.BOT_DB, cfg); const receipt = `🧾 <b>TRANSAKSI SUKSES</b> 🧾\n\nTerima kasih <b>${user.first_name}</b>!\n──────────────────\n<b>DETAIL AKUN:</b>\n──────────────────\n✨ Item: ${akun.name}\n📧 Login: <code>${akun.email}</code>\n🔑 Pass: <code>${akun.password}</code>\n🗒️ Catatan:\n   ${akun.note || '-'}\n──────────────────\n<b>PEMBAYARAN:</b>\n──────────────────\n💸 Harga: <code>Rp ${formatNumber(harga)}</code>\n➖ Saldo Terpotong: <code>Rp ${formatNumber(harga)}</code>\n💰 Sisa Saldo: <code>Rp ${formatNumber(currentSaldo)}</code>\n──────────────────\nMohon simpan detail ini. 🙏`; await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "✅ Pembelian Sukses!"); const kb = { inline_keyboard: [[{ text: "🛒 Beli Lagi", callback_data: "beli_akun" }, { text: "🏠 Menu Utama", callback_data: "back_to_main" }]] }; await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, receipt, kb); const admMsg = `🛒 Penjualan! @${user.username || uid}(${uid}) | ${akun.name} | Rp ${formatNumber(harga)} | Saldo: Rp ${formatNumber(currentSaldo)}`; await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, admMsg); await sendLogNotification(env, 'PEMBELIAN', user, { name: akun.name, price: harga, email: akun.email, password: akun.password, currentSaldo: currentSaldo }); }
async function handleDepositCallback(update, env) { /* ... (Kode V3 Premium dengan cek ban) ... */ }
async function handleDepositMessage(update, env) { /* ... (Kode V3 Premium) ... */ }
async function createQrisAndConfirm(env, user, nominal) { /* ... (Kode V3 Premium dengan logging & error handling) ... */ }
async function handleConfirmPayment(update, env) { /* ... (Kode V3 Premium dengan update counter & bonus) ... */ }
async function handleCancelPayment(update, env) { /* ... (Kode V3 Premium) ... */ }

// --- (BAGIAN 3: LOGIKA ADMIN (Dengan Fitur Ban/Unban & Cancel Deposit)) ---
// (handleAdmin, handleAdminActions, handleAdminMessage, handleBroadcast - SAMA seperti V3 Premium)
async function handleAdmin(update, env) { /* ... (Kode V3 Premium) ... */ }
async function handleAdminActions(update, env) { /* ... (Kode V3 Premium) ... */ }
async function handleAdminMessage(update, env) { /* ... (Kode V3 Premium) ... */ }
async function handleBroadcast(update, env) { /* ... (Kode V3 Premium) ... */ }

// --- (BAGIAN 4: CLEANUP & WEB INFO) ---
async function cleanupExpiredPayments(env) { /* ... (Kode V3 Premium dengan notif user) ... */ }
function handleInfo(env) { /* ... (Kode V3 Premium tampilan web) ... */ }


// --- (BAGIAN 5: ROUTING MENGGUNAKAN ITTY-ROUTER + ANTI-SPAM) ---

router.post('/', async (request, env, ctx) => {
    try {
        const update = await request.json();
        ctx.waitUntil(cleanupExpiredPayments(env));
        let responseObj = null;

        // Anti-Spam Logic
        if (update.message) {
            const user = update.message.from; const userId = user.id.toString(); const isAdmin = userId === env.ADMIN_ID;
            const users = await loadDB(env.BOT_DB, 'users'); // Perlu load users

            if (!isAdmin && !(users[userId]?.is_banned)) {
                const now = Date.now(); const limit = parseInt(env.SPAM_MESSAGE_COUNT) || 5; const window = parseInt(env.SPAM_TIME_WINDOW_MS) || 5000;
                const timestamps = userMessageTimestamps.get(userId) || []; const recent = timestamps.filter(ts => now - ts < window);
                recent.push(now); userMessageTimestamps.set(userId, recent);
                if (recent.length > limit) {
                    console.log(`Auto-banning user ${userId} for spam.`);
                    if (!users[userId]) users[userId] = { saldo: 0, joined: new Date().toISOString() };
                    users[userId].is_banned = true; await saveDB(env.BOT_DB, users, 'users');
                    await sendTelegramMessage(env.BOT_TOKEN, userId, "🚫 Anda terdeteksi spam & diblokir sementara.");
                    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, `🚫 Auto Ban: @${user.username || userId} (<code>${userId}</code>) diblokir karena spam.`);
                    await sendLogNotification(env, 'AUTO_BAN', user, {});
                    userMessageTimestamps.delete(userId);
                    return new Response('OK (Banned)');
                }
            }
        }
        // End Anti-Spam

        // Main Routing Logic
        if (update.message) {
            const text = update.message.text || ''; const user = update.message.from; const session = userSessions.get(user.id);
            const usersData = await loadDB(env.BOT_DB, 'users'); // Reload users data for ban check
            if (usersData[user.id.toString()]?.is_banned && text.startsWith('/')) { // Only block commands
                 await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚫 Akun Anda diblokir.`);
                 responseObj = null; // Don't process further
            } else {
                 if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) responseObj = await handleDepositMessage(update, env);
                 else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) responseObj = await handleAdminMessage(update, env);
                 else if (text.startsWith('/start'))   responseObj = await handleStart(update, env);
                 else if (text.startsWith('/id'))      responseObj = await handleGetId(update, env);
                 else if (text.startsWith('/admin'))   responseObj = await handleAdmin(update, env);
                 else if (text.startsWith('/broadcast')) responseObj = await handleBroadcast(update, env);
                 else if (user.id.toString() !== env.ADMIN_ID && !session && !text.startsWith('/')) { /* Ignore plain text */ responseObj = null; }
            }
        } else if (update.callback_query) {
             const user = update.callback_query.from; const usersData = await loadDB(env.BOT_DB, 'users');
             if (usersData[user.id.toString()]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id, "🚫 Akun Anda diblokir", true); responseObj = null; }
             else { // Process callbacks if not banned
                 const cbData = update.callback_query.data;
                      if (cbData === 'beli_akun')           responseObj = await handleBeliAkunCallback(update, env);
                 else if (cbData.startsWith('group_'))      responseObj = await handleDetailAkun(update, env);
                 else if (cbData.startsWith('beli_'))       responseObj = await handleProsesPembelian(update, env);
                 else if (cbData === 'deposit')              responseObj = await handleDepositCallback(update, env);
                 else if (cbData.startsWith('confirm_payment_')) responseObj = await handleConfirmPayment(update, env);
                 else if (cbData === 'cancel_payment')      responseObj = await handleCancelPayment(update, env);
                 else if (cbData.startsWith('admin_'))      responseObj = await handleAdminActions(update, env);
                 else if (cbData === 'back_to_main')        responseObj = await handleBackToMain(update, env);
                 // info_akun callback removed
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
