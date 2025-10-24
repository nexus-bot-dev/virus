import { Router } from 'itty-router';

const router = Router();

// In-memory storage untuk sessions (sementara)
const userSessions = new Map();

// --- (BAGIAN 1: HELPER FUNCTIONS & KONFIGURASI) ---

// (loadDB, saveDB, load/save/remove/get PendingPayments, getConfig, saveConfig,
// formatNumber, getRandomAmount, send/edit Messages/Photos, answerCallbackQuery,
// sendLogNotification - TETAP SAMA seperti versi itty-router sebelumnya)

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
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }

// ** BARU: Fungsi Format Uptime **
function formatUptime(startTimeISO) {
    if (!startTimeISO) return "Baru saja dimulai";
    const startTime = new Date(startTimeISO);
    const now = new Date();
    const diffMs = now - startTime;

    if (diffMs < 0) return "Baru saja dimulai";

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    let uptimeString = "";
    if (days > 0) uptimeString += `${days} Hari `;
    if (hours > 0) uptimeString += `${hours} Jam `;
    uptimeString += `${minutes} Menit`;

    return uptimeString.trim();
}


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Premium V2)) ---

// ** ✨ Handle /start & Kembali ke Menu Utama (Premium V2 + Counters) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = user.first_name || "Pelanggan";
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const config = await getConfig(env.BOT_DB); // Ambil config

    // Inisialisasi timestamp jika belum ada (hanya saat pertama kali config diakses)
    let needsSave = false;
    if (!config.deployment_timestamp) {
        config.deployment_timestamp = new Date().toISOString();
        needsSave = true;
    }
    if (needsSave) {
        await saveConfig(env.BOT_DB, config);
    }

    if (!isEdit && !users[userId]) {
        users[userId] = { saldo: 0, joined: new Date().toISOString() };
        await saveDB(env.BOT_DB, users, 'users');
    }

    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const totalUsers = Object.keys(users).length; // Hitung total user
    const totalTransactions = config.total_transactions || 0; // Ambil total transaksi
    const uptime = formatUptime(config.deployment_timestamp); // Format uptime

    const adminUsername = env.ADMIN_USERNAME || "@admin";
    // ** Nama Bot dengan Font Khusus **
    const botName = env.BOT_NAME || "𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃"; // Ganti default atau pakai ENV
    const botEmoji = "🚀"; // Emoji baru

    const message = `
Halo, <b>${userFirstName}</b>! 👋

Selamat datang di ${botName}.
Solusi digital otomatis Anda.

┌ <b>INFORMASI AKUN ANDA</b>
├ 🆔 User ID: <code>${userId}</code>
└ 💰 Saldo: <code>Rp ${formatNumber(saldo)}</code>

┌ <b>STATISTIK BOT</b>
├ 👥 Total Pengguna: ${totalUsers}
├ ✅ Transaksi Sukses: ${totalTransactions}
├ 📦 Stok Tersedia: ${stok} Akun
└ ⏱️ Bot Aktif Sejak: ${uptime}

┌ <b>BANTUAN</b>
└ 👨‍💼 Admin: ${adminUsername}

👇 Silakan pilih menu di bawah ini:
    `;
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Katalog Produk", callback_data: "beli_akun" },
                { text: "💳 Isi Saldo (Deposit)", callback_data: "deposit" }
            ],
            [
                { text: "👤 Akun Saya", callback_data: "info_akun"},
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

// (handleGetId, handleGetInfoAkun, handleBeliAkunCallback, handleDetailAkun - TETAP SAMA seperti V1 Premium)
async function handleGetInfoAkun(update, env, isCallback = false) { const user = isCallback ? update.callback_query.from : update.message.from; const userId = user.id.toString(); const users = await loadDB(env.BOT_DB, 'users'); const saldo = users[userId]?.saldo || 0; const joinDate = users[userId]?.joined ? new Date(users[userId].joined).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}) : 'N/A'; const message = `👤 ===「 <b>PROFIL ANDA</b> 」=== 👤\n\n✨ <b>Nama:</b> ${user.first_name || '-'} ${user.last_name || ''}\n📧 <b>Username:</b> @${user.username || 'Tidak Ada'}\n🆔 <b>User ID:</b> <code>${user.id}</code>\n📅 <b>Bergabung Sejak:</b> ${joinDate}\n\n💰 <b>Saldo Tersedia:</b> <code>Rp ${formatNumber(saldo)}</code>\n────────────────────────`; if (isCallback) { await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id); const keyboard = { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }; return await editMessageText(env.BOT_TOKEN, user.id, update.callback_query.message.message_id, message, keyboard); } else { return await sendTelegramMessage(env.BOT_TOKEN, user.id, message); } }
async function handleGetId(update, env) { return handleGetInfoAkun(update, env, false); }
async function handleBeliAkunCallback(update, env) { const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const accs = await loadDB(env.BOT_DB, 'accounts'); const usrs = await loadDB(env.BOT_DB, 'users'); const saldo = usrs[uid]?.saldo || 0; if (Object.keys(accs).length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok kosong!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `⚠️ Stok kosong, <b>${user.first_name}</b>.`, { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }); } const grouped = {}; for (const [e, a] of Object.entries(accs)) { const k = `${a.name}_${a.price}`; if (!grouped[k]) grouped[k] = { c: 0, p: a.price, n: a.name }; grouped[k].c++; } const sorted = Object.entries(grouped).sort(([, a], [, b]) => a.n.localeCompare(b.n)); const kBtns = sorted.map(([k, d]) => { let ej = "🔹"; if (d.n.toLowerCase().includes('vpn')) ej = "🌐"; else if (d.n.toLowerCase().includes('premium')) ej = "⭐"; else if (d.n.toLowerCase().includes('netflix')) ej = "🎬"; else if (d.n.toLowerCase().includes('spotify')) ej = "🎵"; return [{ text: `${ej} ${d.n} [${d.c}] - Rp ${formatNumber(d.p)}`, callback_data: `group_${d.n}_${d.p}` }]; }); const kb = { inline_keyboard: [...kBtns, [{ text: "🔙 Kembali", callback_data: "back_to_main" }]] }; const msg = `🛒 ===「 <b>KATALOG</b> 」=== 🛒\nSaldo: 💰 <code>Rp ${formatNumber(saldo)}</code>\n\nPilih produk:\n<i>(Stok: [ ])</i>`; await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb); }
async function handleDetailAkun(update, env) { const cbQ = update.callback_query; const user = cbQ.from; const uid = user.id.toString(); const cbData = cbQ.data; const accs = await loadDB(env.BOT_DB, 'accounts'); const usrs = await loadDB(env.BOT_DB, 'users'); const saldo = usrs[uid]?.saldo || 0; const [, name, price] = cbData.split('_'); const priceInt = parseInt(price); const filtered = Object.entries(accs).filter(([e, a]) => a.name === name && a.price === priceInt); if (filtered.length === 0) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "Stok habis!", true); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, `❌ Stok <b>${name}</b> habis.`, { inline_keyboard: [[{ text: "🛒 Katalog", callback_data: "beli_akun" }]] }); } const [email] = filtered[0]; const akun = accs[email]; const canBuy = saldo >= akun.price; let msg = `💎 <b>DETAIL & KONFIRMASI</b> 💎\n──────────────────\n🏷️ <b>Produk:</b> ${akun.name}\n──────────────────\n📄 <b>Deskripsi:</b>\n   ${akun.description || '<i>N/A</i>'}\n──────────────────\n💰 <b>Harga:</b> <code>Rp ${formatNumber(akun.price)}</code>\n📦 <b>Stok:</b> ${filtered.length}\n──────────────────\n🏦 Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>\n`; const kbRow = []; if (canBuy) { msg += `\n✅ Konfirmasi pembelian?`; kbRow.push({ text: `🛒 Beli (Rp ${formatNumber(akun.price)})`, callback_data: `beli_${email}` }, { text: " Katalog", callback_data: "beli_akun" }); } else { msg += `\n⚠️ Saldo kurang: <code>Rp ${formatNumber(akun.price - saldo)}</code>`; kbRow.push({ text: "💳 Isi Saldo", callback_data: "deposit" }, { text: " Katalog", callback_data: "beli_akun" }); } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, { inline_keyboard: [kbRow] }); }

// ** ✨ Handle Proses Pembelian (Premium Receipt + Update Config) ✨ **
async function handleProsesPembelian(update, env) {
    const callbackQuery = update.callback_query; const user = callbackQuery.from; const userId = user.id.toString(); const cbData = callbackQuery.data;
    const users = await loadDB(env.BOT_DB, 'users'); const accounts = await loadDB(env.BOT_DB, 'accounts'); const email = cbData.split('_')[1];
    if (!accounts[email]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Akun terjual!", true); return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, "<b>⚠️ Akun sudah terjual.</b>", { inline_keyboard: [[{ text: "🛒 Kembali ke Katalog", callback_data: "beli_akun" }]] }); }
    const akun = accounts[email]; const harga = akun.price;
    if (!users[userId]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ /start dulu!", true); return; }
    const saldo = users[userId].saldo;
    if (saldo < harga) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Saldo kurang!", true); return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, `<b>🚫 SALDO KURANG</b>\nSaldo: <code>Rp ${formatNumber(saldo)}</code>\nHarga: <code>Rp ${formatNumber(harga)}</code>`, { inline_keyboard: [[{ text: "💳 Isi Saldo", callback_data: "deposit" }]] }); }

    // Proses pembelian
    users[userId].saldo -= harga; await saveDB(env.BOT_DB, users, 'users');
    delete accounts[email]; await saveDB(env.BOT_DB, accounts, 'accounts');
    const currentSaldo = users[userId].saldo;

    // ** BARU: Update Total Transaksi di Config **
    const config = await getConfig(env.BOT_DB);
    config.total_transactions = (config.total_transactions || 0) + 1;
    await saveConfig(env.BOT_DB, config);
    // ** AKHIR UPDATE **

    const receipt = `🧾 <b>TRANSAKSI SUKSES</b> 🧾\n\nTerima kasih <b>${user.first_name}</b>!\n──────────────────\n<b>DETAIL AKUN ANDA:</b>\n──────────────────\n✨ Item: ${akun.name}\n📧 Login: <code>${akun.email}</code>\n🔑 Pass: <code>${akun.password}</code>\n🗒️ Catatan:\n   ${akun.note || '-'}\n──────────────────\n<b>PEMBAYARAN:</b>\n──────────────────\n💸 Harga: <code>Rp ${formatNumber(harga)}</code>\n➖ Saldo Terpotong: <code>Rp ${formatNumber(harga)}</code>\n💰 Sisa Saldo: <code>Rp ${formatNumber(currentSaldo)}</code>\n──────────────────\nMohon simpan detail ini. 🙏`;
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "✅ Pembelian Sukses!");
    const keyboard = { inline_keyboard: [[{ text: "🛒 Beli Lagi", callback_data: "beli_akun" }, { text: "🏠 Menu Utama", callback_data: "back_to_main" }]] };
    await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, receipt, keyboard);

    const username = user.username || "null";
    const adminMessage = `🛒 Penjualan! @${username}(${userId}) | ${akun.name} | Rp ${formatNumber(harga)} | Saldo: Rp ${formatNumber(currentSaldo)}`;
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    await sendLogNotification(env, 'PEMBELIAN', user, { name: akun.name, price: akun.price, email: akun.email, password: akun.password, currentSaldo: currentSaldo });
}

// (handleDepositCallback, handleDepositMessage, createQrisAndConfirm - TETAP SAMA seperti V1 Premium)
async function handleDepositCallback(update, env) { const cbQ = update.callback_query; const user = cbQ.from; const pending = await getPendingPayment(env.BOT_DB, user.id); if (pending) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "⚠️ Masih ada deposit pending.", true); return; } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); const min = parseInt(env.MIN_AMOUNT) || 1000; const maxR = parseInt(env.RANDOM_AMOUNT_MAX) || 50; const cfg = await getConfig(env.BOT_DB); userSessions.set(user.id, { action: 'awaiting_deposit_nominal' }); let msg = `💳 ===「 <b>ISI SALDO QRIS</b> 」=== 💳\n Minimal: <b>Rp ${formatNumber(min)}</b>\n Kode Unik: 1-${maxR} Rp\n`; if (cfg.bonus_percentage > 0) msg += ` Bonus Aktif: 🎁 <b>${cfg.bonus_percentage}%</b>!\n`; msg += `──────────────────\nBalas dgn <b>NOMINAL</b>:\nContoh: <code>50000</code>`; const kb = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "back_to_main" }]] }; return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb); }
async function handleDepositMessage(update, env) { const msg = update.message; const user = msg.from; const txt = msg.text; const sess = userSessions.get(user.id); if (sess?.action !== 'awaiting_deposit_nominal') { if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) return null; return null; } userSessions.delete(user.id); const pend = await getPendingPayment(env.BOT_DB, user.id); if (pend) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "⚠️ Masih ada deposit belum selesai."); } try { const nom = parseInt(txt); const min = parseInt(env.MIN_AMOUNT) || 1000; if (isNaN(nom) || nom <= 0) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Input Salah! Masukkan angka.\nContoh: <code>10000</code>`); } if (nom < min) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `⚠️ Min deposit: <b>Rp ${formatNumber(min)}</b>.`); } await createQrisAndConfirm(env, user, nom); return new Response('Processing QRIS'); } catch (e) { console.error("Depo msg err:", e); return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses nominal."); } }
async function createQrisAndConfirm(env, user, nom) { const rand = getRandomAmount(env); const final = nom + rand; try { const resp = await fetch(`${env.API_CREATE_URL}?amount=${final}&qrisCode=${env.QRIS_CODE}`); const data = await resp.json(); if (data.status === "success") { const url = data.data.download_url; const tid = data.data["kode transaksi"]; const pData = { nominal: nom, finalNominal: final, transactionId: tid, timestamp: new Date(), status: "pending", messageId: null }; await savePendingPayment(env.BOT_DB, user.id, pData); const kb = { inline_keyboard: [[{ text: "✅ Saya Sudah Transfer", callback_data: `confirm_payment_${tid}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }]] }; const cap = `⏳ ===「 <b>INSTRUKSI DEPOSIT</b> 」=== ⏳\nTransfer <b>TEPAT</b> <code>Rp ${formatNumber(final)}</code>\n──────────────────\nID: <code>${tid}</code>\nNominal: <code>Rp ${formatNumber(nom)}</code>\nKode Unik: <code>Rp ${rand}</code>\n<b>TOTAL:</b> 👉 <h1><code>Rp ${formatNumber(final)}</code></h1> 👈\n──────────────────\nScan QRIS.\nBatas waktu: ⏱️ <b>10 menit</b>.\n\nKlik "✅ Sudah Transfer" <b>SETELAH</b> transfer.`; const sent = await sendTelegramPhoto(env.BOT_TOKEN, user.id, url, cap, kb); if (sent?.ok) { pData.messageId = sent.result.message_id; await savePendingPayment(env.BOT_DB, user.id, pData); } const admMsg = `⏳ Depo Pending: @${user.username || user.id} | ${tid} | Rp ${formatNumber(final)}`; await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, admMsg); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Gagal buat QRIS: ${data.message || 'Error API'}`); } } catch (e) { console.error('QRIS err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error request QRIS."); } }

// ** ✨ Handle Konfirmasi Pembayaran (Premium Success + Bonus + Update Config) ✨ **
async function handleConfirmPayment(update, env) {
    const callbackQuery = update.callback_query; const user = callbackQuery.from; const userId = user.id; const cbData = callbackQuery.data;
    const pData = await getPendingPayment(env.BOT_DB, userId);
    if (!pData) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Deposit tidak ditemukan.", true); return; }
    const transactionId = cbData.split('_')[2];
    if (pData.transactionId !== transactionId) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ ID Transaksi salah.", true); return; }
    const now = new Date(); const pTime = new Date(pData.timestamp); const diffMins = (now - pTime) / 60000;

    if (diffMins > 10) { /* ... Handle Expired (sama seperti V1 Premium) ... */ await removePendingPayment(env.BOT_DB, userId); const expiredNotif = `⌛️ <b>Deposit Expired</b>\nID: <code>${transactionId}</code>\nBatas waktu terlewati.`; await sendTelegramMessage(env.BOT_TOKEN, userId, expiredNotif); const expiredCap = `❌ <b>EXPIRED</b>\nID: <code>${transactionId}</code>\nBatas waktu habis.`; if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, expiredCap); } catch(e){} } await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran expired.", true); return; }

    try {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "🔍 Mengecek...");
        const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
        if (!response.ok) throw new Error(`API Gagal: ${response.status}`);
        const data = await response.json(); if (data.status !== "success") throw new Error(`API Status: ${data.status}`);
        const payments = data.data || []; let found = false; for (const p of payments) { if (p?.amount === pData.finalNominal) { found = true; break; } }

        if (found) { // Ditemukan
            const users = await loadDB(env.BOT_DB, 'users'); const config = await getConfig(env.BOT_DB); const uidStr = userId.toString();
            if (!users[uidStr]) users[uidStr] = { saldo: 0, joined: new Date().toISOString() };
            const bonusPerc = config.bonus_percentage || 0; const bonusAmt = Math.floor(pData.nominal * (bonusPerc / 100)); const totalAdd = pData.nominal + bonusAmt;
            users[uidStr].saldo += totalAdd; await saveDB(env.BOT_DB, users, 'users');
            const newSaldo = users[uidStr].saldo;

            // ** BARU: Update Total Transaksi **
            config.total_transactions = (config.total_transactions || 0) + 1;
            await saveConfig(env.BOT_DB, config);
            // ** AKHIR UPDATE **

            await removePendingPayment(env.BOT_DB, userId);
            let successCaption = `✅ ===「 <b>DEPOSIT SUKSES</b> 」=== ✅\n\nSaldo Anda bertambah, <b>${user.first_name}</b>! 🎉\n──────────────────\n<b>RINCIAN:</b>\n──────────────────\n🆔 ID: <code>${transactionId}</code>\n💸 Nominal: <code>Rp ${formatNumber(pData.nominal)}</code>`;
            if (bonusAmt > 0) { successCaption += `\n🎁 Bonus (${bonusPerc}%): <code>Rp ${formatNumber(bonusAmt)}</code>\n➡️ Total Masuk: <code>Rp ${formatNumber(totalAdd)}</code>`; }
            successCaption += `\n💰 Saldo Akhir: <b><code>Rp ${formatNumber(newSaldo)}</code></b>\n──────────────────\nTerima kasih! 🙏`;
            if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, successCaption); } catch(e){} }
            let adminMsg = `✅ Depo Sukses: @${user.username || uidStr} | ${transactionId} | Nom: Rp ${formatNumber(pData.nominal)}`; if (bonusAmt > 0) adminMsg += ` | Bonus: Rp ${formatNumber(bonusAmt)}`; adminMsg += ` | Saldo: Rp ${formatNumber(newSaldo)}`;
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMsg);
            await sendLogNotification(env, 'DEPOSIT', user, { transactionId, nominal: pData.nominal, bonusPercentage: bonusPerc, bonusAmount: bonusAmt, totalAdded: totalAdd, finalNominal: pData.finalNominal, currentSaldo: newSaldo });
        } else { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⏳ Belum masuk. Tunggu & coba lagi.", true); }
    } catch (error) { console.error('Confirm err:', error); await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, `❌ Error: ${error.message || 'Gagal cek.'}`, true); }
}

// (handleCancelPayment - TETAP SAMA seperti V1 Premium)
async function handleCancelPayment(update, env) { const cbQ = update.callback_query; const user = cbQ.from; const userId = user.id; const pData = await getPendingPayment(env.BOT_DB, userId); if (!pData) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "❌ Tidak ada deposit pending.", true); return; } const tid = pData.transactionId; await removePendingPayment(env.BOT_DB, userId); const cap = `🚫 <b>DEPOSIT DIBATALKAN</b> 🚫\nID: <code>${tid}</code>\nDeposit dibatalkan.`; if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, cap); } catch(e){} } const admMsg = `🚫 Depo Batal: @${user.username || userId} | ID: ${tid}`; await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, admMsg); await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "🚫 Deposit dibatalkan.", true); }

// --- (BAGIAN 3: LOGIKA ADMIN (Premium Look + Perbaikan Back + Bonus)) ---

// (handleAdmin, handleAdminActions, handleAdminMessage, handleBroadcast - SAMA seperti V1 Premium dengan perbaikan back & bonus)
async function handleAdmin(update, env) { const msg = update.message; const user = msg.from; if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); } const usrs = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); const cfg = await getConfig(env.BOT_DB); const kb = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }], [{ text: "🛒+ Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun" }], [{ text: "👥 Member List", cb: "admin_cek_member" }, { text: "📢 Broadcast", cb: "admin_broadcast" }], [{ text: "⏰ Cek Pending", cb: "admin_cek_pending" }, { text: `⚙️ Bonus (${cfg.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]].map(r => r.map(b => ({ text: b.text, callback_data: b.cb }))) }; const admMsg = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n    <i>${env.BOT_NAME || 'Bot'}</i>\n\nHalo, <b>${user.first_name}</b>!\n\n📊 Member: <code>${Object.keys(usrs).length}</code> | Stok: <code>${Object.keys(accs).length}</code> | Bonus: <code>${cfg.bonus_percentage || 0}%</code>\n\nPilih menu:`; return await sendTelegramMessage(env.BOT_TOKEN, user.id, admMsg, kb); }
async function handleAdminActions(update, env) { const cbQ = update.callback_query; const user = cbQ.from; const cbData = cbQ.data; if (user.id.toString() !== env.ADMIN_ID) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "❌ Akses ditolak!", true); return new Response('Forbidden'); } await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); let msg = ""; let kb_sub = { inline_keyboard: [[{ text: "🔙 Kembali ke Dashboard", callback_data: "admin_back" }]] }; switch (cbData) { case "admin_tambah_saldo": msg = `➕ <b>Tambah Saldo</b>\nFormat: <code>ID JUMLAH</code>`; userSessions.set(user.id, { action: 'tambah_saldo' }); break; case "admin_kurangi_saldo": msg = `➖ <b>Kurangi Saldo</b>\nFormat: <code>ID JUMLAH</code>`; userSessions.set(user.id, { action: 'kurangi_saldo' }); break; case "admin_tambah_akun": msg = `🛒 <b>Tambah Akun</b>\nStep 1/6: Nama Produk:`; userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} }); break; case "admin_hapus_akun": msg = `🗑️ <b>Hapus Akun</b>\nEmail/Username Akun:`; userSessions.set(user.id, { action: 'hapus_akun' }); break; case "admin_cek_member": const usrs = await loadDB(env.BOT_DB, 'users'); msg = `👥 <b>Member (${Object.keys(usrs).length})</b>\n${Object.keys(usrs).length === 0 ? '<i>Kosong.</i>' : Object.entries(usrs).map(([id, d]) => `<code>${id}</code>: Rp ${formatNumber(d.saldo)}`).join('\n')}`; break; case "admin_broadcast": msg = `📢 <b>Broadcast</b>\nBalas dgn <code>/broadcast</code>`; break; case "admin_cek_pending": const pend = await loadPendingPayments(env.BOT_DB); msg = `⏰ <b>Pending (${Object.keys(pend).length})</b>\n${Object.keys(pend).length === 0 ? '<i>Kosong.</i>' : Object.entries(pend).map(([id, p]) => `<code>${id}</code>|${p.transactionId}|${Math.max(0, 10 - Math.floor((new Date() - new Date(p.timestamp)) / 60000))}m`).join('\n')}`; break; case "admin_set_bonus": const cfg = await getConfig(env.BOT_DB); msg = `⚙️ <b>Set Bonus (%)</b>\nSaat ini: <b>${cfg.bonus_percentage || 0}%</b>\nInput angka baru (0-100):`; userSessions.set(user.id, { action: 'set_bonus' }); break; case "admin_back": userSessions.delete(user.id); const ua = await loadDB(env.BOT_DB, 'users'); const aa = await loadDB(env.BOT_DB, 'accounts'); const ca = await getConfig(env.BOT_DB); const kba = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }], [{ text: "🛒+ Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun" }], [{ text: "👥 Member", cb: "admin_cek_member" }, { text: "📢 BC", cb: "admin_broadcast" }], [{ text: "⏰ Pending", cb: "admin_cek_pending" }, { text: `⚙️ Bonus (${ca.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]].map(r => r.map(b => ({ text: b.text, callback_data: b.cb }))) }; const msga = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n<i>${env.BOT_NAME || 'Bot'}</i>\n\n<b>${user.first_name}</b>!\n📊 Member: <code>${Object.keys(ua).length}</code> | Stok: <code>${Object.keys(aa).length}</code> | Bonus: <code>${ca.bonus_percentage || 0}%</code>\n\nPilih menu:`; await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msga, kba); return new Response('OK'); default: msg = "❓ Aksi admin invalid."; break; } return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb_sub); }
async function handleAdminMessage(update, env) { const msg = update.message; const user = msg.from; const txt = msg.text; if (user.id.toString() !== env.ADMIN_ID) return; const sess = userSessions.get(user.id); if (!sess) return; const usrs = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); try { switch (sess.action) { case 'tambah_saldo': case 'kurangi_saldo': /* ... (Logika sama) ... */ const [tid, aStr] = txt.split(' '); const amt = parseInt(aStr); if (!tid || !amt || isNaN(amt)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Format: <code>ID JUMLAH</code>"); return new Response('Invalid Format'); } if (!usrs[tid]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ User ID tidak ada."); return new Response('User Not Found'); } if (sess.action === 'tambah_saldo') { usrs[tid].saldo += amt; } else { if (usrs[tid].saldo < amt) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Saldo user kurang.`); return new Response('Insufficient Balance'); } usrs[tid].saldo -= amt; } await saveDB(env.BOT_DB, usrs, 'users'); const admMsg = `✅ Saldo <code>${tid}</code> ${sess.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt)}</code>.\nSaldo baru: <code>Rp ${formatNumber(usrs[tid].saldo)}</code>`; const usrMsg = `🔔 Saldo Anda ${sess.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt)}</code> oleh admin.\nSaldo Baru: <code>Rp ${formatNumber(usrs[tid].saldo)}</code>`; await sendTelegramMessage(env.BOT_TOKEN, user.id, admMsg); await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid), usrMsg); userSessions.delete(user.id); break; case 'tambah_akun': /* ... (Logika sama) ... */ const step = sess.step; const d = sess.data; if (step === 'nama') { d.name = txt; sess.step = 'email'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "📧 Step 2/6: Email/User:"); } else if (step === 'email') { d.email = txt; sess.step = 'password'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🔑 Step 3/6: Password:"); } else if (step === 'password') { d.password = txt; sess.step = 'harga'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "💰 Step 4/6: Harga:"); } else if (step === 'harga') { d.price = parseInt(txt); if (isNaN(d.price)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Harga angka."); return new Response('Invalid Price'); } sess.step = 'deskripsi'; await sendTelegramMessage(env.BOT_TOKEN, user.id, `📝 Step 5/6: Deskripsi:\nHarga: Rp ${formatNumber(d.price)}`); } else if (step === 'deskripsi') { d.description = txt; sess.step = 'catatan'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🗒️ Step 6/6: Catatan ('-' jika kosong):"); } else if (step === 'catatan') { d.note = txt.toLowerCase() !== "-" ? txt : "-"; if (accs[d.email]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${d.email}</code> sudah ada.`); userSessions.delete(user.id); return new Response('Account Exists'); } accs[d.email] = d; await saveDB(env.BOT_DB, accs, 'accounts'); const added = `✅ Akun <b>${d.name}</b> ditambahkan:\n<code>${d.email}</code> | Rp ${formatNumber(d.price)}`; await sendTelegramMessage(env.BOT_TOKEN, user.id, added); userSessions.delete(user.id); } break; case 'hapus_akun': if (accs[txt]) { delete accs[txt]; await saveDB(env.BOT_DB, accs, 'accounts'); await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ Akun dihapus."); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${txt}</code> tidak ada.`); } userSessions.delete(user.id); break; case 'set_bonus': const bonus = parseInt(txt); if (isNaN(bonus) || bonus < 0 || bonus > 100) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Masukkan angka 0 - 100."); return new Response('Invalid Bonus %'); } const cfg = await getConfig(env.BOT_DB); cfg.bonus_percentage = bonus; if (await saveConfig(env.BOT_DB, cfg)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `✅ Bonus deposit diatur ke <b>${bonus}%</b>.`); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal simpan bonus."); } userSessions.delete(user.id); break; default: userSessions.delete(user.id); break; } } catch (e) { console.error('Admin msg err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses admin."); userSessions.delete(user.id); } return new Response('OK'); }
async function handleBroadcast(update, env) { /* ... (Kode handleBroadcast tetap sama) ... */ const msg = update.message; const user = msg.from; if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); } if (!msg.reply_to_message) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "⚠️ Balas pesan yg mau di-BC dgn <code>/broadcast</code>."); } const reply = msg.reply_to_message; const ids = msg.text.split(' ')[1]?.split(',').filter(id => id.trim()) || []; const usrs = await loadDB(env.BOT_DB, 'users'); const targets = ids.length > 0 ? ids : Object.keys(usrs); const targetType = ids.length > 0 ? `ID (${targets.length})` : `Semua (${targets.length})`; await sendTelegramMessage(env.BOT_TOKEN, user.id, `🚀 Mulai BC...\nTarget: ${targetType}.`); let s = 0; let f = 0; for (const tid of targets) { try { if (reply.text) { await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid), reply.text); } else { await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid), "📢 Pesan dari Admin (media tdk dpt diteruskan)."); } s++; } catch (e) { f++; } await new Promise(r => setTimeout(r, 100)); } const res = `🎉 BC Selesai!\n📍 Target: <b>${targetType}</b>\n✅ Sukses: <code>${s}</code>\n❌ Gagal: <code>${f}</code>`; await sendTelegramMessage(env.BOT_TOKEN, user.id, res); }


// --- (BAGIAN 4: CLEANUP & WEB INFO) ---

async function cleanupExpiredPayments(env) { /* ... (Kode cleanupExpiredPayments dengan notif user) ... */ try { const pends = await loadPendingPayments(env.BOT_DB); const now = new Date(); let cleaned = 0; for (const [uid, pay] of Object.entries(pends)) { const pTime = new Date(pay.timestamp); const diffM = (now - pTime) / 60000; if (diffM > 10) { await removePendingPayment(env.BOT_DB, parseInt(uid)); cleaned++; const expNotif = `⌛️ <b>Deposit Expired</b> ⌛️\nID: <code>${pay.transactionId}</code>\nNominal: Rp ${formatNumber(pay.finalNominal)}\nBatas waktu terlewati. Silakan deposit ulang.`; try { await sendTelegramMessage(env.BOT_TOKEN, parseInt(uid), expNotif); } catch (e) {} const expCap = `❌ <b>EXPIRED</b>\nID: <code>${pay.transactionId}</code>`; if (pay.messageId) { try { await editMessageCaption(env.BOT_TOKEN, parseInt(uid), pay.messageId, expCap); } catch (e) {} } } } if (cleaned > 0) console.log(`Cleaned ${cleaned} expired payments`); } catch (e) { console.error('Cleanup err:', e); } }
function handleInfo(env) { /* ... (Kode handleInfo tampilan web premium) ... */ const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${env.BOT_NAME || 'Bot Status'} - Online</title><style>@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');body{font-family:'Poppins',sans-serif;background-image:linear-gradient(135deg, #1a1a2e 0%, #1f1f3a 100%);color:#e0e0fc;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box;text-align:center}.container{background:rgba(42,42,74,0.8);padding:40px;border-radius:20px;box-shadow:0 15px 45px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-width:600px;width:90%}h1{color:#f5b11a;margin-bottom:15px;font-weight:700;font-size:2.2em;letter-spacing:1px;text-shadow:0 0 10px rgba(245,177,26,0.5)}p{color:#c0c0e0;font-size:1.1em;line-height:1.6;margin-bottom:25px}.status{font-size:2em;font-weight:600;color:#00e676;margin:30px 0;text-shadow:0 0 15px rgba(0,230,118,0.7);padding:10px;border:2px solid #00e676;border-radius:10px;display:inline-block}.link a{display:inline-block;background-color:#f5b11a;color:#1a1a2e;text-decoration:none;font-weight:600;padding:14px 30px;border-radius:10px;margin-top:20px;transition:all 0.3s ease;font-size:1.1em}.link a:hover{background-color:#fff;box-shadow:0 0 20px rgba(245,177,26,0.6);transform:translateY(-3px)}</style></head><body><div class="container"><h1>💎 ${env.BOT_NAME || 'Bot Premium'} 💎</h1><p>Sistem Bot Otomatis kami berjalan lancar.</p><div class="status">✅ STATUS: ONLINE</div><p>Semua interaksi melalui Telegram.</p><div class="link"><a href="https://t.me/${env.BOT_USERNAME || 'YourBot'}" target="_blank" rel="noopener noreferrer">🚀 Mulai Chat!</a></div></div></body></html>`; return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }


// --- (BAGIAN 5: ROUTING MENGGUNAKAN ITTY-ROUTER) ---

router.post('/', async (request, env, ctx) => {
    try {
        const update = await request.json();
        ctx.waitUntil(cleanupExpiredPayments(env));
        let responseObj = null;

        if (update.message) {
            const text = update.message.text || ''; const user = update.message.from; const session = userSessions.get(user.id);
            if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) responseObj = await handleDepositMessage(update, env);
            else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) responseObj = await handleAdminMessage(update, env);
            else if (text.startsWith('/start'))   responseObj = await handleStart(update, env);
            else if (text.startsWith('/id'))      responseObj = await handleGetId(update, env);
            else if (text.startsWith('/admin'))   responseObj = await handleAdmin(update, env);
            else if (text.startsWith('/broadcast')) responseObj = await handleBroadcast(update, env);
        } else if (update.callback_query) {
            const cbData = update.callback_query.data;
                 if (cbData === 'beli_akun')           responseObj = await handleBeliAkunCallback(update, env);
            else if (cbData.startsWith('group_'))      responseObj = await handleDetailAkun(update, env);
            else if (cbData.startsWith('beli_'))       responseObj = await handleProsesPembelian(update, env);
            else if (cbData === 'deposit')              responseObj = await handleDepositCallback(update, env);
            else if (cbData.startsWith('confirm_payment_')) responseObj = await handleConfirmPayment(update, env);
            else if (cbData === 'cancel_payment')      responseObj = await handleCancelPayment(update, env);
            else if (cbData.startsWith('admin_'))      responseObj = await handleAdminActions(update, env);
            else if (cbData === 'back_to_main')        responseObj = await handleBackToMain(update, env);
            else if (cbData === 'info_akun')           responseObj = await handleGetInfoAkun(update, env, true);
        }

        if (responseObj instanceof Response) return responseObj;
        else if (responseObj) return new Response(JSON.stringify(responseObj));
        else return new Response('OK'); // Default response if no handler matched or handler returned null/undefined
    } catch (e) {
        console.error('TG Update Err:', e);
        // Avoid sending detailed errors back to Telegram
        return new Response('Internal Server Error', { status: 500 });
    }
});

router.get('/info', (req, env) => handleInfo(env));
router.get('/', () => new Response('💎 Bot Aktif! /info untuk status.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
router.all('*', () => new Response('404 Not Found - Endpoint tidak valid.', { status: 404 }));

export default { fetch: router.handle };
