 import { Router } from 'itty-router';

const router = Router();

// In-memory storage untuk sessions & rate limiting
const userSessions = new Map();
const userMessageTimestamps = new Map(); // Untuk anti-spam

// --- (BAGIAN 1: HELPER FUNCTIONS & KONFIGURASI) ---

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

// ** Fungsi Telegram yang Diperlukan **
async function sendTelegramMessage(t, c, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendMessage`; const pl = { chat_id: c, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG sendMsg err:', e); return null; } }
async function sendTelegramPhoto(t, c, pUrl, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendPhoto`; const pl = { chat_id: c, photo: pUrl, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { console.log(`[PHOTO] Sending photo to ${c}. URL: ${pUrl}`); const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); const result = await r.json(); console.log(`[PHOTO] TG sendPhoto response for ${c}: ${JSON.stringify(result)}`); return result; } catch (e) { console.error('TG sendPhoto err:', e); return null; } }
async function editMessageText(t, c, mId, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageText`; const pl = { chat_id: c, message_id: mId, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editTxt err:', e); return null; } }
async function editMessageCaption(t, c, mId, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageCaption`; const pl = { chat_id: c, message_id: mId, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editCap err:', e); return null; } }
async function answerCallbackQuery(t, qId, txt = null, alert = false) { const url = `https://api.telegram.org/bot${t}/answerCallbackQuery`; const pl = { callback_query_id: qId }; if (txt) { pl.text = txt; pl.show_alert = alert; } try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG answerCbQ err:', e); return null; } }
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'AUTO_BAN') { msg += `🚫 <b>SPAM DETECTED & BANNED!</b>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }
function formatUptime(startTimeISO) { if (!startTimeISO) return "Baru saja"; const start = new Date(startTimeISO); const now = new Date(); const diffMs = now - start; if (diffMs < 0) return "Baru saja"; const d = Math.floor(diffMs / 86400000); const h = Math.floor((diffMs % 86400000) / 3600000); const m = Math.floor((diffMs % 3600000) / 60000); let str = ""; if (d > 0) str += `${d}H `; if (h > 0) str += `${h}J `; str += `${m}M`; return str.trim() || "0M"; }


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Sesuai Request V2)) ---

// ** ✨ Handle /start & Kembali (Teks Persis Sesuai Request + V1.1 Beta) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = `𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃`;
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    let config = await getConfig(env.BOT_DB);

    // Cek ban status
    if (users[userId]?.is_banned) {
        const bannedMessage = `🚫 Akun Anda (ID: <code>${userId}</code>) saat ini sedang <b>diblokir</b>.\nSilakan hubungi admin ${env.ADMIN_USERNAME || '@TeamNexusDev'} untuk informasi lebih lanjut.`;
        if (isEdit && messageId) { if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🚫 Akun Diblokir", true); return await editMessageText(env.BOT_TOKEN, user.id, messageId, bannedMessage); } else { return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage); }
    }

    // Init timestamp & register user baru
    let needsSave = false; if (!config.deployment_timestamp) { config.deployment_timestamp = new Date().toISOString(); needsSave = true; } if (needsSave) await saveConfig(env.BOT_DB, config);
    if (!isEdit && !users[userId]) { users[userId] = { saldo: 0, joined: new Date().toISOString(), is_banned: false }; await saveDB(env.BOT_DB, users, 'users'); }

    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const totalUsers = Object.keys(users).length;
    const totalTransactions = config.total_transactions || 0;
    const uptime = formatUptime(config.deployment_timestamp);
    const adminUsername = env.ADMIN_USERNAME || "@TeamNexusDev";
    const botName = env.BOT_NAME || "𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃";

    // ** Teks Persis Sesuai Request + Versi **
    const message = `
<i>Versi 1.0 Beta</i>

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

// ** Handle /id (untuk akses manual) **
async function handleGetId(update, env) {
    const user = update.message.from;
    const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');

    if (users[userId]?.is_banned) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚫 Akun Anda (<code>${userId}</code>) diblokir.`); }

    const saldo = users[userId]?.saldo || 0;
    const joinDate = users[userId]?.joined ? new Date(users[userId].joined).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}) : 'N/A';
    const message = `👤 ===「 <b>PROFIL ANDA</b> 」=== 👤\n\n✨ Nama: ${user.first_name || '-'} ${user.last_name || ''}\n📧 Username: @${user.username || '-'}\n🆔 User ID: <code>${user.id}</code>\n📅 Bergabung: ${joinDate}\n\n💰 Saldo: <code>Rp ${formatNumber(saldo)}</code>\n──────────────────`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message);
}

// (handleBeliAkunCallback, handleDetailAkun, handleProsesPembelian, handleDepositCallback,
// handleDepositMessage - TETAP SAMA)
async function handleBeliAkunCallback(update, env) { /* ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const saldo = usrs[uid]?.saldo || 0; if (Object.keys(accs).length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok kosong!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `⚠️ Stok kosong, <b>${user.first_name}</b>.`, { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }); } const grouped = {}; for (const [e, a] of Object.entries(accs)) { const k = `${a.name}_${a.price}`; if (!grouped[k]) grouped[k] = { c: 0, p: a.price, n: a.name }; grouped[k].c++; } const sorted = Object.entries(grouped).sort(([, a], [, b]) => a.n.localeCompare(b.n)); const kBtns = sorted.map(([k, d]) => { let ej = "🔹"; if (d.n.toLowerCase().includes('vpn')) ej = "🌐"; else if (d.n.toLowerCase().includes('premium')) ej = "⭐"; else if (d.n.toLowerCase().includes('netflix')) ej = "🎬"; else if (d.n.toLowerCase().includes('spotify')) ej = "🎵"; return [{ text: `${ej} ${d.n} [${d.c}] - Rp ${formatNumber(d.p)}`, callback_data: `group_${d.n}_${d.p}` }]; }); const kb = { inline_keyboard: [...kBtns, [{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }; const msg = `🛒 ===「 <b>KATALOG</b> 」=== 🛒\nSaldo: 💰 <code>Rp ${formatNumber(saldo)}</code>\n\nPilih produk:\n<i>(Stok: [ ])</i>`; await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb); }
async function handleDetailAkun(update, env) { /* ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const cbData = cbQ.data; const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const saldo = usrs[uid]?.saldo || 0; const [, name, price] = cbData.split('_'); const priceInt = parseInt(price); const filtered = Object.entries(accs).filter(([e, a]) => a.name === name && a.price === priceInt); if (filtered.length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok habis!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `❌ Stok <b>${name}</b> habis.`, { inline_keyboard: [[{ text: "🛒 Katalog", callback_data: "beli_akun" }]] }); } const [email] = filtered[0]; const akun = accs[email]; const canBuy = saldo >= akun.price; let msg = `💎 <b>DETAIL & KONFIRMASI</b> 💎\n──────────────────\n🏷️ <b>Produk:</b> ${akun.name}\n──────────────────\n📄 <b>Deskripsi:</b>\n   ${akun.description || '<i>N/A</i>'}\n──────────────────\n💰 <b>Harga:</b> <code>Rp ${formatNumber(akun.price)}</code>\n📦 <b>Stok:</b> ${filtered.length}\n──────────────────\n🏦 Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>\n`; const kbRow = []; if (canBuy) { msg += `\n✅ Konfirmasi pembelian?`; kbRow.push({ text: `🛒 Beli (Rp ${formatNumber(akun.price)})`, callback_data: `beli_${email}` }, { text: " Katalog", callback_data: "beli_akun" }); } else { msg += `\n⚠️ Saldo kurang: <code>Rp ${formatNumber(akun.price - saldo)}</code>`; kbRow.push({ text: "💳 Isi Saldo", callback_data: "deposit" }, { text: " Katalog", callback_data: "beli_akun" }); } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, { inline_keyboard: [kbRow] }); }
async function handleProsesPembelian(update, env) { /* ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const cbData = cbQ.data; const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const accs = await loadDB(env.BOT_DB, 'accounts'); const email = cbData.split('_')[1]; if (!accs[email]) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Akun terjual!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, "<b>⚠️ Akun sudah terjual.</b>", { inline_keyboard: [[{ text: "🛒 Kembali ke Katalog", callback_data: "beli_akun" }]] }); } const akun = accs[email]; const harga = akun.price; if (!usrs[uid]) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "⚠️ /start dulu!", true); return; } const saldo = usrs[uid].saldo; if (saldo < harga) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Saldo kurang!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `<b>🚫 SALDO KURANG</b>\nSaldo: <code>Rp ${formatNumber(saldo)}</code>\nHarga: <code>Rp ${formatNumber(harga)}</code>`, { inline_keyboard: [[{ text: "💳 Isi Saldo", callback_data: "deposit" }]] }); } usrs[uid].saldo -= harga; await saveDB(env.BOT_DB, usrs, 'users'); delete accs[email]; await saveDB(env.BOT_DB, accs, 'accounts'); const currentSaldo = usrs[uid].saldo; const cfg = await getConfig(env.BOT_DB); cfg.total_transactions = (cfg.total_transactions || 0) + 1; await saveConfig(env.BOT_DB, cfg); const receipt = `🧾 <b>TRANSAKSI SUKSES</b> 🧾\n\nTerima kasih <b>${user.first_name}</b>!\n──────────────────\n<b>DETAIL AKUN:</b>\n──────────────────\n✨ Item: ${akun.name}\n📧 Login: <code>${akun.email}</code>\n🔑 Pass: <code>${akun.password}</code>\n🗒️ Catatan:\n   ${akun.note || '-'}\n──────────────────\n<b>PEMBAYARAN:</b>\n──────────────────\n💸 Harga: <code>Rp ${formatNumber(harga)}</code>\n➖ Saldo Terpotong: <code>Rp ${formatNumber(harga)}</code>\n💰 Sisa Saldo: <code>Rp ${formatNumber(currentSaldo)}</code>\n──────────────────\nMohon simpan detail ini. 🙏`; await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "✅ Pembelian Sukses!"); const kb = { inline_keyboard: [[{ text: "🛒 Beli Lagi", callback_data: "beli_akun" }, { text: "🏠 Menu Utama", callback_data: "back_to_main" }]] }; await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, receipt, kb); const admMsg = `🛒 Penjualan! @${user.username || uid}(${uid}) | ${akun.name} | Rp ${formatNumber(harga)} | Saldo: Rp ${formatNumber(currentSaldo)}`; await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, admMsg); await sendLogNotification(env, 'PEMBELIAN', user, { name: akun.name, price: harga, email: akun.email, password: akun.password, currentSaldo: currentSaldo }); }
async function handleDepositCallback(update, env) { /* ... */ const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const usrs = await loadDB(env.BOT_DB, 'users'); if (usrs[uid]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Akun Diblokir", true); return; } const pend = await getPendingPayment(env.BOT_DB, user.id); if (pend) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "⚠️ Masih ada deposit pending.", true); return; } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); const min = parseInt(env.MIN_AMOUNT) || 1000; const maxR = parseInt(env.RANDOM_AMOUNT_MAX) || 50; const cfg = await getConfig(env.BOT_DB); userSessions.set(user.id, { action: 'awaiting_deposit_nominal' }); let msg = `💳 ===「 <b>ISI SALDO QRIS</b> 」=== 💳\n Minimal: <b>Rp ${formatNumber(min)}</b>\n Kode Unik: 1-${maxR} Rp\n`; if (cfg.bonus_percentage > 0) msg += ` Bonus: 🎁 <b>${cfg.bonus_percentage}%</b>!\n`; msg += `──────────────────\nBalas dgn <b>NOMINAL</b>:\nContoh: <code>50000</code>`; const kb = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "back_to_main" }]] }; return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb); }
async function handleDepositMessage(update, env) { /* ... */ const msg = update.message; const user = msg.from; const txt = msg.text; const sess = userSessions.get(user.id); if (sess?.action !== 'awaiting_deposit_nominal') { if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) return null; return null; } userSessions.delete(user.id); const pend = await getPendingPayment(env.BOT_DB, user.id); if (pend) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "⚠️ Masih ada deposit belum selesai."); } try { const nom = parseInt(txt); const min = parseInt(env.MIN_AMOUNT) || 1000; if (isNaN(nom) || nom <= 0) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Input Salah! Masukkan angka.\nContoh: <code>10000</code>`); } if (nom < min) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `⚠️ Min deposit: <b>Rp ${formatNumber(min)}</b>.`); } await createQrisAndConfirm(env, user, nom); return new Response('Processing QRIS'); } catch (e) { console.error("Depo msg err:", e); return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses nominal."); } }

// ** FIX QRIS: Menggunakan Logika Awal yang Stabil **
async function createQrisAndConfirm(env, user, nominal) {
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    const userId = user.id;

    try {
        console.log(`[User ${userId}] Requesting QRIS for amount: ${finalNominal}`);
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        console.log(`[User ${userId}] QRIS API Status: ${response.status}`);

        const data = await response.json();
        console.log(`[User ${userId}] QRIS API Response JSON:`, JSON.stringify(data, null, 2));

        if (data.status === "success") { // ** LOGIKA SUKSES ASLI **
            const qrisUrl = data.data.download_url; // Path asli yang stabil
            const transactionId = data.data["kode transaksi"]; // Path asli yang stabil

            if (!qrisUrl || !transactionId) {
                 console.error(`[User ${userId}] Data QRIS tidak lengkap (Missing URL/ID)`);
                 throw new Error("Data QRIS tidak lengkap dari API pembayaran.");
            }
            console.log(`[User ${userId}] Extracted QRIS URL: ${qrisUrl}`);
            console.log(`[User ${userId}] Extracted Transaction ID: ${transactionId}`);

            const pData = { nominal, finalNominal: finalNominal, transactionId: transactionId, timestamp: new Date(), status: "pending", messageId: null };
            const saveStatus = await savePendingPayment(env.BOT_DB, userId, pData);
            if (!saveStatus) { console.error(`[User ${userId}] Gagal menyimpan pending payment.`); throw new Error("Gagal menyimpan data deposit sementara."); }

            const keyboard = { inline_keyboard: [[{ text: "✅ Saya Sudah Transfer", callback_data: `confirm_payment_${transactionId}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }]] };
            const caption = `⏳ ===「 <b>INSTRUKSI DEPOSIT</b> 」=== ⏳\n\nTransfer <b>TEPAT</b> <code>Rp ${formatNumber(finalNominal)}</code>\n──────────────────\nID: <code>${transactionId}</code>\nNominal: <code>Rp ${formatNumber(nominal)}</code>\nKode Unik: <code>Rp ${randomAddition}</code>\n<b>TOTAL:</b> 👉 <h1><code>Rp ${formatNumber(finalNominal)}</code></h1> 👈\n──────────────────\nScan QRIS.\nBatas waktu: ⏱️ <b>10 menit</b>.\n\nKlik "✅ Sudah Transfer" <b>SETELAH</b> transfer.`;

            // ** Menggunakan sendTelegramPhoto (Logika Stabil) **
            const sent = await sendTelegramPhoto(env.BOT_TOKEN, userId, qrisUrl, caption, keyboard);

            if (sent?.ok) {
                pData.messageId = sent.result.message_id;
                await savePendingPayment(env.BOT_DB, userId, pData);
                console.log(`[User ${userId}] QRIS Photo sent successfully, msg_id: ${pData.messageId}`);
            } else {
                // ** LOGIKA PENCEGAHAN ERROR VITAL: Memberi tahu user dan menghapus pending **
                console.error(`[User ${userId}] Failed to send QRIS Photo. TG Response:`, JSON.stringify(sent));
                await sendTelegramMessage(env.BOT_TOKEN, userId, "❌ Gagal menampilkan gambar QRIS saat ini. Mohon ulangi proses deposit.");
                await removePendingPayment(env.BOT_DB, userId);
                return; // Gagal, hentikan.
            }

            const admMsg = `⏳ Depo Pending: @${user.username || userId} | ${transactionId} | Rp ${formatNumber(finalNominal)}`;
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, admMsg);

        } else {
            // Jika API tidak merespons success, gunakan pesan error dari API
            const errorMsg = data.message || data.error || "Gagal membuat QRIS. Cek log Worker untuk detail.";
            await sendTelegramMessage(env.BOT_TOKEN, userId, `❌ <b>Gagal membuat QRIS:</b> ${errorMsg}.`);
            console.error(`[User ${userId}] QRIS API returned failure status: ${errorMsg}`);
        }
    } catch (e) {
        console.error(`[User ${userId}] Create QRIS overall err:`, e);
        await sendTelegramMessage(env.BOT_TOKEN, userId, `❌ Terjadi kesalahan sistem saat membuat QRIS. Mohon coba lagi nanti.`);
        try { await removePendingPayment(env.BOT_DB, userId); } catch (removeErr) {}
    }
}
async function handleConfirmPayment(update, env) { /* ... */ }
async function handleCancelPayment(update, env) { /* ... */ }

// --- (BAGIAN 3: LOGIKA ADMIN (FINAL FIX)) ---
async function handleAdmin(update, env) {
    const message = update.message; const user = message.from;
    if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); }
    const users = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); const cfg = await getConfig(env.BOT_DB);
    const totalMembers = Object.keys(users).length; const bannedCount = Object.values(users).filter(u => u.is_banned).length;
    const keyboard = {
        inline_keyboard: [
            [{ text: "➕ Saldo", cb: "admin_tambah_saldo_start" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo_start" }],
            [{ text: "🛒+ Akun", cb: "admin_tambah_akun_start" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun_start" }],
            [{ text: "🚫 Ban User", cb: "admin_ban_user" }, { text: "✅ Unban User", cb: "admin_unban_user" }],
            [{ text: "👥 Member List", cb: "admin_cek_member" }, { text: "📢 Broadcast", cb: "admin_broadcast" }],
            [{ text: "⏰ Cek Pending", cb: "admin_cek_pending" }, { text: "❌ Batalkan Deposit", cb: "admin_cancel_deposit_start" }],
            [{ text: `⚙️ Bonus (${cfg.bonus_percentage || 0}%)`, cb: "admin_set_bonus_start" }]
        ].map(r => r.map(b => ({ text: b.text, callback_data: b.cb })))
    };
    const adminMsg = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n\nSelamat datang, <b>${user.first_name}</b>!\n\n📊 Member: <code>${totalMembers}</code> (Diblokir: ${bannedCount})\n📦 Stok: <code>${Object.keys(accs).length}</code>\n🎁 Bonus: <code>${cfg.bonus_percentage || 0}%</code>\n\nPilih menu:`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMsg, keyboard);
}

async function handleDisplayAdminMenu(env, user, messageId) {
    const users = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); const cfg = await getConfig(env.BOT_DB);
    const totalMembers = Object.keys(users).length; const bannedCount = Object.values(users).filter(u => u.is_banned).length;
    const kb_a = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo_start" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo_start" }], [{ text: "🛒+ Akun", cb: "admin_tambah_akun_start" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun_start" }], [{ text: "🚫 Ban User", cb: "admin_ban_user" }, { text: "✅ Unban User", cb: "admin_unban_user" }], [{ text: "👥 Member", cb: "admin_cek_member" }, { text: "📢 Broadcast", cb: "admin_broadcast" }], [{ text: "⏰ Cek Pending", cb: "admin_cek_pending" }, { text: "❌ Batalkan Deposit", cb: "admin_cancel_deposit_start" }], [{ text: `⚙️ Bonus (${cfg.bonus_percentage || 0}%)`, cb: "admin_set_bonus_start" }]].map(r => r.map(b => ({ text: b.text, callback_data: b.cb }))) };
    const msga = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n\nSelamat datang, <b>${user.first_name}</b>!\n\n📊 Member: <code>${totalMembers}</code> (Diblokir: ${bannedCount})\n📦 Stok: <code>${Object.keys(accs).length}</code>\n🎁 Bonus: <code>${cfg.bonus_percentage || 0}%</code>\n\nPilih menu:`;
    return await editMessageText(env.BOT_TOKEN, user.id, messageId, msga, kb_a);
}

async function handleAdminActions(update, env) { /* ... */ const cbQ = update.callback_query; const user = cbQ.from; const cbData = cbQ.data; if (user.id.toString() !== env.ADMIN_ID) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "❌ Akses ditolak!", true); return new Response('Forbidden'); } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); let msg = ""; let action = ""; let kb_sub = { inline_keyboard: [[{ text: "🔙 Kembali ke Dashboard", callback_data: "admin_back" }]] }; switch (cbData) { case "admin_tambah_saldo_start": msg = `➕ <b>Tambah Saldo</b>\nMasukkan <code>USER_ID JUMLAH</code>:`; action = 'tambah_saldo'; break; case "admin_kurangi_saldo_start": msg = `➖ <b>Kurangi Saldo</b>\nMasukkan <code>USER_ID JUMLAH</code>:`; action = 'kurangi_saldo'; break; case "admin_tambah_akun_start": msg = `🛒 <b>Tambah Akun</b>\nStep 1/6: Masukkan <b>Nama Produk</b>:`; action = 'tambah_akun'; userSessions.set(user.id, { action, step: 'nama', data: {} }); break; case "admin_hapus_akun_start": msg = `🗑️ <b>Hapus Akun</b>\nMasukkan <b>Email/Username</b> akun:`; action = 'hapus_akun'; break; case "admin_set_bonus_start": msg = `⚙️ <b>Atur Bonus (%)</b>\nMasukkan persentase baru (0-100):`; action = 'set_bonus'; break; case "admin_cancel_deposit_start": msg = `❌ <b>Batalkan Deposit Pending</b>\nMasukkan <b>User ID</b> yang depositnya ingin dibatalkan:`; action = 'cancel_deposit'; break; case "admin_ban_user": msg = `🚫 <b>Blokir Pengguna</b>\nMasukkan <b>User ID</b> yang ingin diblokir:`; action = 'ban_user'; break; case "admin_unban_user": msg = `✅ <b>Buka Blokir</b>\nMasukkan <b>User ID</b> yang ingin dibuka blokirnya:`; action = 'unban_user'; break; case "admin_cek_member": const usrs = await loadDB(env.BOT_DB, 'users'); const totalM = Object.keys(usrs).length; msg = `👥 <b>Member (${totalM})</b>\n${totalM === 0 ? '<i>Kosong.</i>' : Object.entries(usrs).map(([id, d]) => `🆔 <code>${id}</code> ${d.is_banned ? '🚫' : ''}: Rp ${formatNumber(d.saldo)}`).join('\n')}`; break; case "admin_broadcast": msg = `📢 <b>Broadcast</b>\nBalas pesan ini dgn <code>/broadcast</code>`; break; case "admin_cek_pending": const pend = await loadPendingPayments(env.BOT_DB); msg = `⏰ <b>Pending (${Object.keys(pend).length})</b>\n${Object.keys(pend).length === 0 ? '<i>Kosong.</i>' : Object.entries(pend).map(([id, p]) => `<code>${id}</code>|${p.transactionId}|${Math.max(0, 10 - Math.floor((new Date() - new Date(p.timestamp)) / 60000))}m`).join('\n')}`; break; case "admin_back": userSessions.delete(user.id); return handleDisplayAdminMenu(env, user, cbQ.message.message_id); default: msg = "❓ Aksi admin tidak dikenal."; break; } if (action && !action.startsWith('admin_')) { userSessions.set(user.id, { action }); } return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb_sub); }
async function handleAdminMessage(update, env) { /* ... */ const message = update.message; const user = message.from; const text = message.text.trim(); if (user.id.toString() !== env.ADMIN_ID) return; const session = userSessions.get(user.id); if (!session) return; const users = await loadDB(env.BOT_DB, 'users'); const accounts = await loadDB(env.BOT_DB, 'accounts'); if (session.action !== 'tambah_akun') { userSessions.delete(user.id); } try { switch (session.action) { case 'tambah_saldo': case 'kurangi_saldo': const [tid_s, aStr_s] = text.split(' '); const amt_s = parseInt(aStr_s); if (!tid_s || !amt_s || isNaN(amt_s)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Format salah. <code>ID JUMLAH</code>"); return new Response('Invalid Format'); } if (!users[tid_s]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ User ID tidak ada."); return new Response('User Not Found'); } if (session.action === 'tambah_saldo') { users[tid_s].saldo += amt_s; } else { if (users[tid_s].saldo < amt_s) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Saldo user kurang.`); return new Response('Insufficient Balance'); } users[tid_s].saldo -= amt_s; } await saveDB(env.BOT_DB, users, 'users'); const admMsg_s = `✅ Saldo <code>${tid_s}</code> ${session.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt_s)}</code>.\nSaldo baru: <code>Rp ${formatNumber(users[tid_s].saldo)}</code>`; const usrMsg_s = `🔔 Saldo Anda ${session.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt_s)}</code> oleh admin.\nSaldo Baru: <code>Rp ${formatNumber(users[tid_s].saldo)}</code>`; await sendTelegramMessage(env.BOT_TOKEN, user.id, admMsg_s); await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid_s), usrMsg_s); break; case 'tambah_akun': const step_a = session.step; const d_a = session.data; if (step_a === 'nama') { d_a.name = text; session.step = 'email'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "📧 Step 2/6: Email/User:"); userSessions.set(user.id, session); } else if (step_a === 'email') { d_a.email = text; session.step = 'password'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🔑 Step 3/6: Password:"); userSessions.set(user.id, session); } else if (step_a === 'password') { d_a.password = text; session.step = 'harga'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "💰 Step 4/6: Harga:"); userSessions.set(user.id, session); } else if (step_a === 'harga') { d_a.price = parseInt(text); if (isNaN(d_a.price)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Harga angka."); return new Response('Invalid Price'); } sess.step = 'deskripsi'; await sendTelegramMessage(env.BOT_TOKEN, user.id, `📝 Step 5/6: Deskripsi:\nHarga: Rp ${formatNumber(d_a.price)}`); userSessions.set(user.id, session); } else if (step_a === 'deskripsi') { d_a.description = text; sess.step = 'catatan'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🗒️ Step 6/6: Catatan ('-' jika kosong):"); userSessions.set(user.id, session); } else if (step_a === 'catatan') { d_a.note = text.toLowerCase() !== "-" ? text : "-"; if (accounts[d_a.email]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${d_a.email}</code> sudah ada.`); return new Response('Account Exists'); } accounts[d_a.email] = d_a; await saveDB(env.BOT_DB, accounts, 'accounts'); const added_a = `✅ Akun <b>${d_a.name}</b> ditambahkan:\n<code>${d_a.email}</code> | Rp ${formatNumber(d_a.price)}`; await sendTelegramMessage(env.BOT_TOKEN, user.id, added_a); } break; case 'hapus_akun': if (accounts[text]) { delete accounts[text]; await saveDB(env.BOT_DB, accounts, 'accounts'); await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ Akun dihapus."); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${text}</code> tidak ada.`); } break; case 'set_bonus': const bonus = parseInt(text); if (isNaN(bonus) || bonus < 0 || bonus > 100) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Masukkan angka 0 - 100."); return new Response('Invalid Bonus %'); } const cfg = await getConfig(env.BOT_DB); cfg.bonus_percentage = bonus; if (await saveConfig(env.BOT_DB, cfg)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `✅ Bonus deposit diatur ke <b>${bonus}%</b>.`); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal simpan bonus."); } break; case 'ban_user': case 'unban_user': const targetUserId = text; const targetUserExists = users[targetUserId]; const shouldBan = session.action === 'ban_user'; if (!targetUserExists) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ User ID <code>${targetUserId}</code> tidak ditemukan.`); } else if (targetUserId === env.ADMIN_ID) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Tidak bisa memblokir akun admin.`); } else { const currentBanStatus = users[targetUserId].is_banned || false; if (shouldBan === currentBanStatus) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `ℹ️ User ID <code>${targetUserId}</code> sudah dalam status yang sama.`); } else { users[targetUserId].is_banned = shouldBan; await saveDB(env.BOT_DB, users, 'users'); const actionText = shouldBan ? 'diblokir' : 'dibuka blokirnya'; const userNotifText = `🚫 Akun Anda telah <b>${actionText}</b> oleh admin.`; const adminConfirmText = `✅ User ID <code>${targetUserId}</code> berhasil <b>${actionText}</b>.`; await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetUserId), userNotifText); await sendTelegramMessage(env.BOT_TOKEN, user.id, adminConfirmText); } } break; case 'cancel_deposit': const cancelUserId = text; const pendingToCancel = await getPendingPayment(env.BOT_DB, cancelUserId); if (!pendingToCancel) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `ℹ️ User ID <code>${cancelUserId}</code> tidak memiliki deposit pending.`); } else { const transactionId = pendingToCancel.transactionId; await removePendingPayment(env.BOT_DB, cancelUserId); const cancelCaption = `🚫 <b>DEPOSIT DIBATALKAN ADMIN</b>\nID: <code>${transactionId}</code>\nDeposit ini dibatalkan oleh admin.`; if (pendingToCancel.messageId) { try { await editMessageCaption(env.BOT_TOKEN, parseInt(cancelUserId), pendingToCancel.messageId, cancelCaption); } catch (e) {} } const userCancelNotif = `🚫 Deposit Anda (ID: <code>${transactionId}</code>) telah <b>dibatalkan oleh admin</b>.`; await sendTelegramMessage(env.BOT_TOKEN, parseInt(cancelUserId), userCancelNotif); const adminCancelConfirm = `✅ Deposit pending untuk User ID <code>${cancelUserId}</code> (ID: <code>${transactionId}</code>) berhasil dibatalkan.`; await sendTelegramMessage(env.BOT_TOKEN, user.id, adminCancelConfirm); } break; default: break; } } catch (e) { console.error('Admin msg err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses admin."); } return new Response('OK'); }
async function handleBroadcast(update, env) { /* ... */ }
async function cleanupExpiredPayments(env) { /* ... */ }
function handleInfo(env) { /* ... */ }


// --- (BAGIAN 4: ROUTING MENGGUNAKAN ITTY-ROUTER + ANTI-SPAM + PERBAIKAN /ADMIN) ---

router.post('/', async (request, env, ctx) => {
    try {
        const update = await request.json();
        ctx.waitUntil(cleanupExpiredPayments(env));
        let responseObj = null;

        // Anti-Spam Logic
        if (update.message) {
            const user = update.message.from; const userId = user.id.toString(); const isAdmin = userId === env.ADMIN_ID;
            const users = await loadDB(env.BOT_DB, 'users');
            if (!isAdmin && !(users[userId]?.is_banned)) {
                const now = Date.now(); const limit = parseInt(env.SPAM_MESSAGE_COUNT) || 5; const window = parseInt(env.SPAM_TIME_WINDOW_MS) || 5000;
                const timestamps = userMessageTimestamps.get(userId) || []; const recent = timestamps.filter(ts => now - ts < window);
                recent.push(now); userMessageTimestamps.set(userId, recent);
                if (recent.length > limit) { console.log(`Auto-banning user ${userId} for spam.`); if (!users[userId]) users[userId] = { saldo: 0, joined: new Date().toISOString() }; users[userId].is_banned = true; await saveDB(env.BOT_DB, users, 'users'); await sendTelegramMessage(env.BOT_TOKEN, userId, "🚫 Anda terdeteksi spam & diblokir sementara."); await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, `🚫 Auto Ban: @${user.username || userId} (<code>${userId}</code>) diblokir karena spam.`); await sendLogNotification(env, 'AUTO_BAN', user, {}); userMessageTimestamps.delete(userId); return new Response('OK (Banned)'); }
            }
        }
        // End Anti-Spam

        // Main Routing Logic
        if (update.message) {
            const text = update.message.text || ''; const user = update.message.from; const session = userSessions.get(user.id);
            const usersData = await loadDB(env.BOT_DB, 'users');

            // ** PERBAIKAN KRITIS /ADMIN (Prioritas Tertinggi) **
            if (text.startsWith('/admin') && user.id.toString() === env.ADMIN_ID) {
                 if (session) userSessions.delete(user.id);
                 responseObj = await handleAdmin(update, env);
            }
            // Cek Ban (setelah cek /admin)
            else if (usersData[user.id.toString()]?.is_banned && text.startsWith('/')) {
                 await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚫 Akun Anda diblokir.`);
                 responseObj = null;
            }
            // Prioritas 3: Sesi Deposit
            else if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) {
                responseObj = await handleDepositMessage(update, env);
            }
            // Prioritas 4: Sesi Admin (Input setelah tombol)
            else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) {
                responseObj = await handleAdminMessage(update, env);
            }
            // Prioritas 5: Perintah Dasar
            else if (text.startsWith('/start'))   responseObj = await handleStart(update, env);
            else if (text.startsWith('/id'))      responseObj = await handleGetId(update, env);
            else if (text.startsWith('/broadcast') && user.id.toString() === env.ADMIN_ID) {
                 responseObj = await handleBroadcast(update, env);
            }
            // Abaikan teks biasa dari non-admin di luar sesi
            else if (user.id.toString() !== env.ADMIN_ID && !session && !text.startsWith('/')) {
                 responseObj = null;
            }

        } else if (update.callback_query) {
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
router.get('/', (req, env) => new Response('💎 Bot Aktif! /info untuk status.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
router.all('*', () => new Response('404 Not Found - Endpoint tidak valid.', { status: 404 }));

// Export handler
export default { fetch: router.handle };
