 import { Router } from 'itty-router';

const router = Router();

// In-memory storage untuk sessions (sementara)
const userSessions = new Map();

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
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }
function formatUptime(startTimeISO) { if (!startTimeISO) return "Baru saja"; const start = new Date(startTimeISO); const now = new Date(); const diffMs = now - start; if (diffMs < 0) return "Baru saja"; const d = Math.floor(diffMs / 86400000); const h = Math.floor((diffMs % 86400000) / 3600000); const m = Math.floor((diffMs % 3600000) / 60000); let str = ""; if (d > 0) str += `${d}H `; if (h > 0) str += `${h}J `; str += `${m}M`; return str.trim() || "0M"; }


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Premium V3)) ---

// ** ✨ Handle /start & Kembali ke Menu Utama (Premium V3) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = user.first_name || "Pelanggan";
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    let config = await getConfig(env.BOT_DB);

    // Cek ban status
    if (users[userId]?.is_banned) {
        const bannedMessage = `🚫 Akun Anda (ID: <code>${userId}</code>) saat ini sedang <b>diblokir</b>.\nSilakan hubungi admin ${env.ADMIN_USERNAME || '@admin'} untuk informasi lebih lanjut.`;
        if (isEdit && messageId) {
             if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🚫 Akun Diblokir", true);
             return await editMessageText(env.BOT_TOKEN, user.id, messageId, bannedMessage);
        } else {
             return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage);
        }
    }

    // Inisialisasi timestamp jika belum ada
    let needsSave = false;
    if (!config.deployment_timestamp) { config.deployment_timestamp = new Date().toISOString(); needsSave = true; }
    if (needsSave) await saveConfig(env.BOT_DB, config);

    // Register user baru
    if (!isEdit && !users[userId]) { users[userId] = { saldo: 0, joined: new Date().toISOString(), is_banned: false }; await saveDB(env.BOT_DB, users, 'users'); }

    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const totalUsers = Object.keys(users).length;
    const totalTransactions = config.total_transactions || 0;
    const uptime = formatUptime(config.deployment_timestamp);
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "𝗧𝗲𝗮𝗺𝗡𝗲𝘅𝘂𝘀𝗗𝗲𝘃";
    const botEmoji = "🚀";

    const message = `Halo, <b>${userFirstName}</b>! 👋\nSelamat datang di ${botName}.\n\n┌ <b>AKUN ANDA</b>\n├ ID: <code>${userId}</code>\n└ Saldo: <code>Rp ${formatNumber(saldo)}</code>\n\n┌ <b>STATISTIK BOT</b>\n├ Pengguna: ${totalUsers}\n├ Transaksi: ${totalTransactions}\n├ Stok: ${stok}\n└ Aktif: ${uptime}\n\n┌ <b>BANTUAN</b>: ${adminUsername}\n\n👇 Pilih menu:`;
    const keyboard = { inline_keyboard: [[{ text: "🛒 Katalog", cb: "beli_akun" }, { text: "💳 Deposit", cb: "deposit" }], [{ text: "👤 Akun Saya", cb: "info_akun" }, { text: "🔄 Refresh", cb: "back_to_main" }]].map(r=>r.map(b=>({text:b.text, callback_data:b.cb}))) };

    if (isEdit && messageId) {
        if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🔄 Menu diperbarui");
        return await editMessageText(env.BOT_TOKEN, user.id, messageId, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
    }
}
async function handleStart(update, env) { return displayMainMenu(env, update.message.from); }
async function handleBackToMain(update, env) { return displayMainMenu(env, update.callback_query.from, true, update.callback_query.message.message_id, update.callback_query.id); }

// ** ✨ Handle /id & Tombol Info Akun (Cek Ban) ✨ **
async function handleGetInfoAkun(update, env, isCallback = false) {
    const user = isCallback ? update.callback_query.from : update.message.from;
    const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');

    // Cek ban status
    if (users[userId]?.is_banned) {
         const bannedMessage = `🚫 Akun Anda (ID: <code>${userId}</code>) <b>diblokir</b>.`;
         if (isCallback) {
             await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id, "🚫 Diblokir", true);
             return await editMessageText(env.BOT_TOKEN, user.id, update.callback_query.message.message_id, bannedMessage, {inline_keyboard: [[{ text: "Hubungi Admin", url: `https://t.me/${(env.ADMIN_USERNAME || '').replace('@','')}` }]]});
         } else {
             return await sendTelegramMessage(env.BOT_TOKEN, user.id, bannedMessage);
         }
    }


    const saldo = users[userId]?.saldo || 0;
    const joinDate = users[userId]?.joined ? new Date(users[userId].joined).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric'}) : 'N/A';
    const message = `👤 ===「 <b>PROFIL ANDA</b> 」=== 👤\n\n✨ Nama: ${user.first_name || '-'} ${user.last_name || ''}\n📧 Username: @${user.username || '-'}\n🆔 User ID: <code>${user.id}</code>\n📅 Bergabung: ${joinDate}\n\n💰 Saldo: <code>Rp ${formatNumber(saldo)}</code>\n──────────────────`;

    if (isCallback) {
        await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id);
        const keyboard = { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] };
        return await editMessageText(env.BOT_TOKEN, user.id, update.callback_query.message.message_id, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message);
    }
}
async function handleGetId(update, env) { return handleGetInfoAkun(update, env, false); }


// ** ✨ Handle Beli Akun (Cek Ban) ✨ **
async function handleBeliAkunCallback(update, env) {
    const callbackQuery = update.callback_query; const user = callbackQuery.from; const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');
    if (users[userId]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "🚫 Akun Diblokir", true); return; } // Stop jika diban

    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const saldo = users[userId]?.saldo || 0;
    if (Object.keys(accounts).length === 0) { /* ... handle stok kosong ... */ }
    const grouped = {}; /* ... grouping logic ... */ for (const [e, a] of Object.entries(accounts)) { const k = `${a.name}_${a.price}`; if (!grouped[k]) grouped[k] = { c: 0, p: a.price, n: a.name }; grouped[k].c++; }
    const sorted = Object.entries(grouped).sort(([, a], [, b]) => a.n.localeCompare(b.n));
    const kBtns = sorted.map(([k, d]) => { /* ... emoji logic ... */ let ej = "🔹"; if (d.n.toLowerCase().includes('vpn')) ej = "🌐"; else if (d.n.toLowerCase().includes('premium')) ej = "⭐"; else if (d.n.toLowerCase().includes('netflix')) ej = "🎬"; else if (d.n.toLowerCase().includes('spotify')) ej = "🎵"; return [{ text: `${ej} ${d.n} [${d.c}] - Rp ${formatNumber(d.p)}`, callback_data: `group_${d.n}_${d.p}` }]; });
    const kb = { inline_keyboard: [...kBtns, [{ text: "🔙 Kembali", callback_data: "back_to_main" }]] };
    const msg = `🛒 ===「 <b>KATALOG</b> 」=== 🛒\nSaldo: 💰 <code>Rp ${formatNumber(saldo)}</code>\n\nPilih produk:\n<i>(Stok: [ ])</i>`;
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg, kb);
}

// (handleDetailAkun, handleProsesPembelian - Tetap Sama, karena sudah ada cek saldo & user exists)
async function handleDetailAkun(update, env) { /* ... (Kode V2 Premium Tetap Sama) ... */ }
async function handleProsesPembelian(update, env) { /* ... (Kode V2 Premium dengan update counter Tetap Sama) ... */ }

// ** ✨ Handle Deposit Callback (Cek Ban) ✨ **
async function handleDepositCallback(update, env) {
    const callbackQuery = update.callback_query; const user = callbackQuery.from; const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');
    if (users[userId]?.is_banned) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "🚫 Akun Diblokir", true); return; } // Stop jika diban

    const pending = await getPendingPayment(env.BOT_DB, user.id);
    if (pending) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Masih ada deposit pending.", true); return; }
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    const min = parseInt(env.MIN_AMOUNT) || 1000; const maxR = parseInt(env.RANDOM_AMOUNT_MAX) || 50; const cfg = await getConfig(env.BOT_DB);
    userSessions.set(user.id, { action: 'awaiting_deposit_nominal' });
    let msg = `💳 ===「 <b>ISI SALDO QRIS</b> 」=== 💳\n Minimal: <b>Rp ${formatNumber(min)}</b>\n Kode Unik: 1-${maxR} Rp\n`; if (cfg.bonus_percentage > 0) msg += ` Bonus: 🎁 <b>${cfg.bonus_percentage}%</b>!\n`; msg += `──────────────────\nBalas dgn <b>NOMINAL</b>:\nContoh: <code>50000</code>`;
    const kb = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "back_to_main" }]] };
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg, kb);
}


// (handleDepositMessage - Tetap Sama)
async function handleDepositMessage(update, env) { /* ... (Kode V2 Premium Tetap Sama) ... */ }

// ** ✨ Create QRIS (Perbaikan Logging & Error Handling - Tetap Sama) ✨ **
async function createQrisAndConfirm(env, user, nominal) { /* ... (Kode V2 Premium dengan Logging Tetap Sama) ... */ }

// ** ✨ Handle Konfirmasi Pembayaran (Update Counter - Tetap Sama) ✨ **
async function handleConfirmPayment(update, env) { /* ... (Kode V2 Premium dengan Update Counter Tetap Sama) ... */ }

// ** ✨ Handle Batal Pembayaran (Premium - Tetap Sama) ✨ **
async function handleCancelPayment(update, env) { /* ... (Kode V2 Premium Tetap Sama) ... */ }


// --- (BAGIAN 3: LOGIKA ADMIN (Dengan Fitur Ban/Unban & Cancel Deposit)) ---

// ** ✨ Handle Admin Command (Menu Baru) ✨ **
async function handleAdmin(update, env) {
    const message = update.message; const user = message.from;
    if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); }
    const users = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); const cfg = await getConfig(env.BOT_DB);
    const totalMembers = Object.keys(users).length;
    const bannedCount = Object.values(users).filter(u => u.is_banned).length; // Hitung yang diban

    const keyboard = {
        inline_keyboard: [
            // Saldo & Akun
            [{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }],
            [{ text: "🛒+ Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun" }],
            // Member & Broadcast
            [{ text: "👥 Member List", cb: "admin_cek_member" }, { text: "📢 Broadcast", cb: "admin_broadcast" }],
            // Ban/Unban
            [{ text: "🚫 Ban User", cb: "admin_ban_user" }, { text: "✅ Unban User", cb: "admin_unban_user" }], // BARU
            // Deposit
            [{ text: "⏰ Cek Pending", cb: "admin_cek_pending" }, { text: "❌ Cancel Depo", cb: "admin_cancel_deposit" }], // BARU
            // Bonus
            [{ text: `⚙️ Bonus (${cfg.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]
        ].map(r => r.map(b => ({ text: b.text, callback_data: b.cb })))
    };
    const adminMessage = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n    <i>${env.BOT_NAME || 'Bot'}</i>\n\nSelamat datang, <b>${user.first_name}</b>!\n\n📊 Member: <code>${totalMembers}</code> (Diblokir: ${bannedCount})\n📦 Stok: <code>${Object.keys(accs).length}</code>\n🎁 Bonus: <code>${cfg.bonus_percentage || 0}%</code>\n\nPilih menu:`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMessage, keyboard);
}


// ** ✨ Handle Admin Actions (Tambah Case Ban/Unban, Cancel Depo) ✨ **
async function handleAdminActions(update, env) {
    const cbQ = update.callback_query; const user = cbQ.from; const cbData = cbQ.data;
    if (user.id.toString() !== env.ADMIN_ID) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "❌ Akses ditolak!", true); return new Response('Forbidden'); }
    await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); let msg = ""; let kb_sub = { inline_keyboard: [[{ text: "🔙 Kembali ke Dashboard", callback_data: "admin_back" }]] };

    switch (cbData) {
        // ... (Case Saldo, Akun, Member, Broadcast, Pending, Bonus - TETAP SAMA)
        case "admin_tambah_saldo": msg = `➕ <b>Tambah Saldo</b>\nFormat: <code>ID JUMLAH</code>`; userSessions.set(user.id, { action: 'tambah_saldo' }); break;
        case "admin_kurangi_saldo": msg = `➖ <b>Kurangi Saldo</b>\nFormat: <code>ID JUMLAH</code>`; userSessions.set(user.id, { action: 'kurangi_saldo' }); break;
        case "admin_tambah_akun": msg = `🛒 <b>Tambah Akun</b>\nStep 1/6: Nama Produk:`; userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} }); break;
        case "admin_hapus_akun": msg = `🗑️ <b>Hapus Akun</b>\nEmail/Username:`; userSessions.set(user.id, { action: 'hapus_akun' }); break;
        case "admin_cek_member": const usrs = await loadDB(env.BOT_DB, 'users'); msg = `👥 <b>Member (${Object.keys(usrs).length})</b>\n${Object.keys(usrs).length === 0 ? '<i>Kosong.</i>' : Object.entries(usrs).map(([id, d]) => `<code>${id}</code> ${d.is_banned ? '🚫' : ''}: Rp ${formatNumber(d.saldo)}`).join('\n')}`; break; // Tampilkan status ban
        case "admin_broadcast": msg = `📢 <b>Broadcast</b>\nBalas dgn <code>/broadcast</code>`; break;
        case "admin_cek_pending": const pend = await loadPendingPayments(env.BOT_DB); msg = `⏰ <b>Pending (${Object.keys(pend).length})</b>\n${Object.keys(pend).length === 0 ? '<i>Kosong.</i>' : Object.entries(pend).map(([id, p]) => `<code>${id}</code>|${p.transactionId}|${Math.max(0, 10 - Math.floor((new Date() - new Date(p.timestamp)) / 60000))}m`).join('\n')}`; break;
        case "admin_set_bonus": const cfg = await getConfig(env.BOT_DB); msg = `⚙️ <b>Set Bonus (%)</b>\nSaat ini: <b>${cfg.bonus_percentage || 0}%</b>\nInput angka baru (0-100):`; userSessions.set(user.id, { action: 'set_bonus' }); break;

        // ** BARU: Case Ban/Unban & Cancel Deposit **
        case "admin_ban_user":
            msg = `🚫 <b>Blokir Pengguna</b>\nMasukkan User ID yang ingin diblokir:`;
            userSessions.set(user.id, { action: 'ban_user' });
            break;
        case "admin_unban_user":
            msg = `✅ <b>Buka Blokir Pengguna</b>\nMasukkan User ID yang ingin dibuka blokirnya:`;
            userSessions.set(user.id, { action: 'unban_user' });
            break;
        case "admin_cancel_deposit":
            msg = `❌ <b>Batalkan Deposit Pending</b>\nMasukkan User ID yang depositnya ingin dibatalkan:`;
            userSessions.set(user.id, { action: 'cancel_deposit' });
            break;
        // ** AKHIR BARU **

        case "admin_back": // Perbaikan tombol back (Tetap Sama)
            userSessions.delete(user.id);
            const users_a = await loadDB(env.BOT_DB, 'users'); const acc_a = await loadDB(env.BOT_DB, 'accounts'); const conf_a = await getConfig(env.BOT_DB); const banned_a = Object.values(users_a).filter(u => u.is_banned).length;
            const kba = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }], [{ text: "🛒+ Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Hps Akun", cb: "admin_hapus_akun" }], [{ text: "👥 Member", cb: "admin_cek_member" }, { text: "📢 BC", cb: "admin_broadcast" }], [{ text: "🚫 Ban", cb: "admin_ban_user" }, { text: "✅ Unban", cb: "admin_unban_user" }], [{ text: "⏰ Pending", cb: "admin_cek_pending" }, { text: "❌ Cancel Depo", cb: "admin_cancel_deposit" }], [{ text: `⚙️ Bonus (${conf_a.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]].map(r => r.map(b => ({ text: b.text, callback_data: b.cb }))) };
            const msga = `🛡️ ===「 <b>ADMIN DASHBOARD</b> 」=== 🛡️\n<i>${env.BOT_NAME || 'Bot'}</i>\n\n<b>${user.first_name}</b>!\n📊 Member: <code>${Object.keys(users_a).length}</code> (${banned_a} 🚫)\n📦 Stok: <code>${Object.keys(acc_a).length}</code>\n🎁 Bonus: <code>${conf_a.bonus_percentage || 0}%</code>\n\nPilih menu:`;
            await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msga, kba);
            return new Response('OK');
        default: msg = "❓ Aksi admin invalid."; break;
    }
    return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb_sub);
}


// ** ✨ Handle Admin Message (Tambah Proses Ban/Unban, Cancel Depo) ✨ **
async function handleAdminMessage(update, env) {
    const message = update.message; const user = message.from; const text = message.text.trim(); // Trim input
    if (user.id.toString() !== env.ADMIN_ID) return; const session = userSessions.get(user.id); if (!session) return;
    const users = await loadDB(env.BOT_DB, 'users'); const accounts = await loadDB(env.BOT_DB, 'accounts');

    try {
        switch (session.action) {
            case 'tambah_saldo': case 'kurangi_saldo': /* ... (Logika sama) ... */ const [tid_s, aStr_s] = text.split(' '); const amt_s = parseInt(aStr_s); if (!tid_s || !amt_s || isNaN(amt_s)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Format: <code>ID JUMLAH</code>"); return new Response('Invalid Format'); } if (!users[tid_s]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ User ID tidak ada."); return new Response('User Not Found'); } if (session.action === 'tambah_saldo') { users[tid_s].saldo += amt_s; } else { if (users[tid_s].saldo < amt_s) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Saldo user kurang.`); return new Response('Insufficient Balance'); } users[tid_s].saldo -= amt_s; } await saveDB(env.BOT_DB, users, 'users'); const admMsg_s = `✅ Saldo <code>${tid_s}</code> ${session.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt_s)}</code>.\nSaldo baru: <code>Rp ${formatNumber(users[tid_s].saldo)}</code>`; const usrMsg_s = `🔔 Saldo Anda ${session.action === 'tambah_saldo' ? '+' : '-'} <code>Rp ${formatNumber(amt_s)}</code> oleh admin.\nSaldo Baru: <code>Rp ${formatNumber(users[tid_s].saldo)}</code>`; await sendTelegramMessage(env.BOT_TOKEN, user.id, admMsg_s); await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid_s), usrMsg_s); userSessions.delete(user.id); break;
            case 'tambah_akun': /* ... (Logika sama) ... */ const step_a = session.step; const d_a = session.data; if (step_a === 'nama') { d_a.name = text; session.step = 'email'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "📧 Step 2/6: Email/User:"); } else if (step_a === 'email') { d_a.email = text; session.step = 'password'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🔑 Step 3/6: Password:"); } else if (step_a === 'password') { d_a.password = text; session.step = 'harga'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "💰 Step 4/6: Harga:"); } else if (step_a === 'harga') { d_a.price = parseInt(text); if (isNaN(d_a.price)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Harga angka."); return new Response('Invalid Price'); } session.step = 'deskripsi'; await sendTelegramMessage(env.BOT_TOKEN, user.id, `📝 Step 5/6: Deskripsi:\nHarga: Rp ${formatNumber(d_a.price)}`); } else if (step_a === 'deskripsi') { d_a.description = text; session.step = 'catatan'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🗒️ Step 6/6: Catatan ('-' jika kosong):"); } else if (step_a === 'catatan') { d_a.note = text.toLowerCase() !== "-" ? text : "-"; if (accounts[d_a.email]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${d_a.email}</code> sudah ada.`); userSessions.delete(user.id); return new Response('Account Exists'); } accounts[d_a.email] = d_a; await saveDB(env.BOT_DB, accounts, 'accounts'); const added_a = `✅ Akun <b>${d_a.name}</b> ditambahkan:\n<code>${d_a.email}</code> | Rp ${formatNumber(d_a.price)}`; await sendTelegramMessage(env.BOT_TOKEN, user.id, added_a); userSessions.delete(user.id); } break;
            case 'hapus_akun': /* ... (Logika sama) ... */ if (accounts[text]) { delete accounts[text]; await saveDB(env.BOT_DB, accounts, 'accounts'); await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ Akun dihapus."); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${text}</code> tidak ada.`); } userSessions.delete(user.id); break;
            case 'set_bonus': /* ... (Logika sama) ... */ const bonus_b = parseInt(text); if (isNaN(bonus_b) || bonus_b < 0 || bonus_b > 100) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Masukkan angka 0 - 100."); return new Response('Invalid Bonus %'); } const cfg_b = await getConfig(env.BOT_DB); cfg_b.bonus_percentage = bonus_b; if (await saveConfig(env.BOT_DB, cfg_b)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `✅ Bonus deposit diatur ke <b>${bonus_b}%</b>.`); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal simpan bonus."); } userSessions.delete(user.id); break;

            // ** BARU: Proses Ban/Unban **
            case 'ban_user':
            case 'unban_user':
                const targetUserId = text;
                const targetUserExists = users[targetUserId];
                const shouldBan = session.action === 'ban_user';

                if (!targetUserExists) {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ User ID <code>${targetUserId}</code> tidak ditemukan.`);
                } else if (targetUserId === env.ADMIN_ID) {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Tidak bisa ${shouldBan ? 'memblokir' : 'membuka blokir'} akun admin.`);
                } else {
                    const currentBanStatus = users[targetUserId].is_banned || false;
                    if (shouldBan && currentBanStatus) {
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, `ℹ️ User ID <code>${targetUserId}</code> sudah dalam status diblokir.`);
                    } else if (!shouldBan && !currentBanStatus) {
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, `ℹ️ User ID <code>${targetUserId}</code> tidak dalam status diblokir.`);
                    } else {
                        users[targetUserId].is_banned = shouldBan;
                        await saveDB(env.BOT_DB, users, 'users');

                        const actionText = shouldBan ? 'diblokir' : 'dibuka blokirnya';
                        const userNotifText = `🚫 Akun Anda telah <b>${actionText}</b> oleh admin.\nSilakan hubungi ${env.ADMIN_USERNAME || 'admin'} jika ada pertanyaan.`;
                        const adminConfirmText = `✅ User ID <code>${targetUserId}</code> berhasil <b>${actionText}</b>.`;

                        await sendTelegramMessage(env.BOT_TOKEN, parseInt(targetUserId), userNotifText);
                        await sendTelegramMessage(env.BOT_TOKEN, user.id, adminConfirmText);
                    }
                }
                userSessions.delete(user.id);
                break;

            // ** BARU: Proses Cancel Deposit **
            case 'cancel_deposit':
                const cancelUserId = text;
                const pendingToCancel = await getPendingPayment(env.BOT_DB, cancelUserId);

                if (!pendingToCancel) {
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, `ℹ️ User ID <code>${cancelUserId}</code> tidak memiliki deposit yang sedang pending.`);
                } else {
                    const transactionId = pendingToCancel.transactionId;
                    await removePendingPayment(env.BOT_DB, cancelUserId);

                    const cancelCaption = `🚫 <b>DEPOSIT DIBATALKAN ADMIN</b>\nID: <code>${transactionId}</code>\nDeposit ini dibatalkan oleh admin. Hubungi ${env.ADMIN_USERNAME || 'admin'} jika ada pertanyaan.`;
                    if (pendingToCancel.messageId) {
                        try { await editMessageCaption(env.BOT_TOKEN, parseInt(cancelUserId), pendingToCancel.messageId, cancelCaption); } catch (e) {}
                    }

                    const userCancelNotif = `🚫 Deposit Anda (ID: <code>${transactionId}</code>) telah <b>dibatalkan oleh admin</b>.`;
                    await sendTelegramMessage(env.BOT_TOKEN, parseInt(cancelUserId), userCancelNotif);

                    const adminCancelConfirm = `✅ Deposit pending untuk User ID <code>${cancelUserId}</code> (ID: <code>${transactionId}</code>) berhasil dibatalkan.`;
                    await sendTelegramMessage(env.BOT_TOKEN, user.id, adminCancelConfirm);
                }
                userSessions.delete(user.id);
                break;

            default: userSessions.delete(user.id); break;
        }
    } catch (e) { console.error('Admin msg err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses admin."); userSessions.delete(user.id); }
    return new Response('OK'); // Kembalikan OK
}

// (handleBroadcast - TETAP SAMA)
async function handleBroadcast(update, env) { /* ... */ }

// ** ✨ Cleanup Expired Payments (Dengan Notif User - TETAP SAMA) ✨ **
async function cleanupExpiredPayments(env) { /* ... */ }

// ** ✨ Tampilan Web Info Premium (TETAP SAMA) ✨ **
function handleInfo(env) { /* ... */ }


// --- (BAGIAN 4: ROUTING MENGGUNAKAN ITTY-ROUTER) ---

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

        // Handle return values from handlers
        if (responseObj instanceof Response) return responseObj; // If handler returns Response object
        else if (responseObj) return new Response(JSON.stringify(responseObj)); // If handler returns data object
        else return new Response('OK'); // Default if no handler or null/undefined returned

    } catch (e) {
        console.error('TG Update Err:', e);
        return new Response('Internal Server Error', { status: 500 });
    }
});

// Endpoint Tampilan Web & Fallback
router.get('/info', (req, env) => handleInfo(env));
router.get('/', () => new Response('💎 Bot Aktif! /info untuk status.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
router.all('*', () => new Response('404 Not Found - Endpoint tidak valid.', { status: 404 }));

// Export handler
export default { fetch: router.handle };
