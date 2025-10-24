 import { Router } from 'itty-router'; // Make sure this is imported

const router = Router();

// In-memory storage for sessions (temporary)
const userSessions = new Map();

// --- (BAGIAN 1: HELPER FUNCTIONS & KONFIGURASI) ---
// (All helper functions: loadDB, saveDB, loadPendingPayments, savePendingPayment,
// removePendingPayment, getPendingPayment, getConfig, saveConfig, formatNumber,
// getRandomAmount, sendTelegramMessage, sendTelegramPhoto, editMessageText,
// editMessageCaption, answerCallbackQuery, sendLogNotification - remain the same
// as the previous itty-router version with bonus logic in sendLogNotification)

async function loadDB(binding, dbType) { try { const d = await binding.get(dbType, 'json'); return d || {}; } catch (e) { console.error(`KV ${dbType} load err:`, e); return {}; } }
async function saveDB(binding, data, dbType) { try { await binding.put(dbType, JSON.stringify(data)); return true; } catch (e) { console.error(`KV ${dbType} save err:`, e); return false; } }
async function loadPendingPayments(binding) { try { const d = await binding.get('pending_payments', 'json'); return d || {}; } catch (e) { console.error(`KV pending load err:`, e); return {}; } }
async function savePendingPayment(binding, userId, pData) { try { const p = await loadPendingPayments(binding); p[String(userId)] = { ...pData, timestamp: pData.timestamp.toISOString() }; await binding.put('pending_payments', JSON.stringify(p)); return true; } catch (e) { console.error('KV pending save err:', e); return false; } }
async function removePendingPayment(binding, userId) { try { const p = await loadPendingPayments(binding); const uid = String(userId); if (p[uid]) { delete p[uid]; await binding.put('pending_payments', JSON.stringify(p)); } return true; } catch (e) { console.error('KV pending remove err:', e); return false; } }
async function getPendingPayment(binding, userId) { try { const p = await loadPendingPayments(binding); const uid = String(userId); const pm = p[uid]; if (pm) { return { ...pm, timestamp: new Date(pm.timestamp) }; } return null; } catch (e) { console.error('KV pending get err:', e); return null; } }
async function getConfig(binding) { try { const c = await binding.get('config', 'json'); const d = { bonus_percentage: 0 }; return c && typeof c === 'object' ? { ...d, ...c } : d; } catch (e) { console.error('KV config load err:', e); return { bonus_percentage: 0 }; } }
async function saveConfig(binding, cData) { try { await binding.put('config', JSON.stringify(cData)); return true; } catch (e) { console.error('KV config save err:', e); return false; } }
function formatNumber(n) { const num = Number(n); return isNaN(num) ? String(n) : num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function getRandomAmount(env) { const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1; const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50; return Math.floor(Math.random() * (max - min + 1)) + min; }
async function sendTelegramMessage(t, c, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendMessage`; const pl = { chat_id: c, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG sendMsg err:', e); return null; } }
async function sendTelegramPhoto(t, c, pUrl, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/sendPhoto`; const pl = { chat_id: c, photo: pUrl, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG sendPhoto err:', e); return null; } }
async function editMessageText(t, c, mId, txt, k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageText`; const pl = { chat_id: c, message_id: mId, text: txt, parse_mode: p, disable_web_page_preview: true }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editTxt err:', e); return null; } }
async function editMessageCaption(t, c, mId, cap = '', k = null, p = 'HTML') { const url = `https://api.telegram.org/bot${t}/editMessageCaption`; const pl = { chat_id: c, message_id: mId, caption: cap, parse_mode: p }; if (k) pl.reply_markup = k; try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG editCap err:', e); return null; } }
async function answerCallbackQuery(t, qId, txt = null, alert = false) { const url = `https://api.telegram.org/bot${t}/answerCallbackQuery`; const pl = { callback_query_id: qId }; if (txt) { pl.text = txt; pl.show_alert = alert; } try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) }); return await r.json(); } catch (e) { console.error('TG answerCbQ err:', e); return null; } }
async function sendLogNotification(env, type, uData, iData) { const cId = env.LOG_GROUP_ID; if (!cId) return; let msg = `🔔 <b>Log: ${type}</b> | @${uData.username || 'N/A'} (<code>${uData.id}</code>)\n`; if (type === 'PEMBELIAN') { msg += `🛒 ${iData.name} | <code>Rp ${formatNumber(iData.price)}</code>\n📧 Akun: <code>${iData.email}</code> | <code>${iData.password}</code>\n💳 Sisa Saldo: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } else if (type === 'DEPOSIT') { msg += `💳 ID: <code>${iData.transactionId}</code>\n💰 Nom: <code>Rp ${formatNumber(iData.nominal)}</code> | Bonus: <code>Rp ${formatNumber(iData.bonusAmount || 0)}</code> (${iData.bonusPercentage}%)\n➡️ Total: <code>Rp ${formatNumber(iData.totalAdded)}</code> | Bayar: <code>Rp ${formatNumber(iData.finalNominal)}</code>\n💳 Saldo Baru: <code>Rp ${formatNumber(iData.currentSaldo)}</code>`; } await sendTelegramMessage(env.BOT_TOKEN, cId, msg); }


// --- (BAGIAN 2: LOGIKA BOT (Tampilan Lebih Keren & Detail)) ---

// ** ✨ Handle /start & Kembali ke Menu Utama (Lebih Detail) ✨ **
async function displayMainMenu(env, user, isEdit = false, messageId = null, callbackQueryId = null) {
    const userId = user.id.toString();
    const userFirstName = user.first_name || "Pelanggan"; // Sapaan lebih ramah
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');

    if (!isEdit && !users[userId]) {
        users[userId] = { saldo: 0, joined: new Date().toISOString() }; // Tambah tanggal join
        await saveDB(env.BOT_DB, users, 'users');
    }

    const saldo = users[userId]?.saldo || 0;
    const stok = Object.keys(accounts).length;
    const adminUsername = env.ADMIN_USERNAME || "@admin";
    const botName = env.BOT_NAME || "Bot Toko Digital"; // Nama lebih generik
    const botEmoji = "🤖"; // Emoji bot

    const message = `
${botEmoji} Selamat Datang, <b>${userFirstName}</b>! di <b>${botName}</b> ✨
    
Saldo Anda saat ini:
💰 <b><code>Rp ${formatNumber(saldo)}</code></b>

Kami siap melayani kebutuhan digital Anda 24/7.
──────────────────
📦 Stok Tersedia: <b>${stok} Akun</b>
💬 Butuh Bantuan? Hubungi ${adminUsername}
──────────────────
👇 Silakan pilih aksi di bawah ini:
    `;
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Beli Akun", callback_data: "beli_akun" },
                { text: "💳 Isi Saldo (Deposit)", callback_data: "deposit" }
            ],
            [
                { text: "ℹ️ Info Akun Saya (/id)", callback_data: "info_akun"}, // Tombol info akun
                { text: "🔄 Perbarui Menu", callback_data: "back_to_main" }
            ]
        ]
    };

    if (isEdit && messageId) {
        if (callbackQueryId) await answerCallbackQuery(env.BOT_TOKEN, callbackQueryId, "🔄 Menu Utama Dimuat Ulang");
        return await editMessageText(env.BOT_TOKEN, user.id, messageId, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
    }
}
async function handleStart(update, env) { return displayMainMenu(env, update.message.from); }
async function handleBackToMain(update, env) { return displayMainMenu(env, update.callback_query.from, true, update.callback_query.message.message_id, update.callback_query.id); }

// ** ✨ Handle /id & Tombol Info Akun (Lebih Detail) ✨ **
async function handleGetInfoAkun(update, env, isCallback = false) {
    const user = isCallback ? update.callback_query.from : update.message.from;
    const userId = user.id.toString();
    const users = await loadDB(env.BOT_DB, 'users');
    const saldo = users[userId]?.saldo || 0;
    const joinDate = users[userId]?.joined ? new Date(users[userId].joined).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric'}) : 'Tidak Diketahui';

    const message = `
👤 <b>INFORMASI AKUN ANDA</b>

──────────────────
✨ <b>Nama:</b> ${user.first_name || '-'} ${user.last_name || ''}
📧 <b>Username:</b> @${user.username || 'Tidak Ada'}
🆔 <b>User ID:</b> <code>${user.id}</code>
📅 <b>Tanggal Bergabung:</b> ${joinDate}
💰 <b>Saldo Saat Ini:</b> <code>Rp ${formatNumber(saldo)}</code>
──────────────────
    `;

    if (isCallback) {
        await answerCallbackQuery(env.BOT_TOKEN, update.callback_query.id);
        // Edit pesan sebelumnya untuk menampilkan info, tambahkan tombol kembali
        const keyboard = { inline_keyboard: [[{ text: "🔙 Kembali ke Menu Utama", callback_data: "back_to_main" }]] };
        return await editMessageText(env.BOT_TOKEN, user.id, update.callback_query.message.message_id, message, keyboard);
    } else {
        return await sendTelegramMessage(env.BOT_TOKEN, user.id, message);
    }
}
async function handleGetId(update, env) { return handleGetInfoAkun(update, env, false); }


// ** ✨ Handle Beli Akun (List Lebih Rapi) ✨ **
async function handleBeliAkunCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const users = await loadDB(env.BOT_DB, 'users');
    const saldo = users[userId]?.saldo || 0;

    if (Object.keys(accounts).length === 0) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok produk kosong!", true);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, `⚠️ Maaf <b>${user.first_name}</b>, stok sedang kosong.`, { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "back_to_main" }]] });
    }

    const grouped = {};
    for (const [email, akun] of Object.entries(accounts)) { const key = `${akun.name}_${akun.price}`; if (!grouped[key]) grouped[key] = { count: 0, price: akun.price, name: akun.name }; grouped[key].count++; }

    // Urutkan berdasarkan nama produk A-Z
    const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => a.name.localeCompare(b.name));

    const keyboardButtons = sortedGroups.map(([key, data]) => {
        return [{
            text: ` ${data.name} [${data.count}] - Rp ${formatNumber(data.price)} `, // Emoji bisa ditambahkan jika tahu tipe produk
            callback_data: `group_${data.name}_${data.price}`
        }];
    });

    const keyboard = { inline_keyboard: [...keyboardButtons, [{ text: "🔙 Kembali ke Menu Utama", callback_data: "back_to_main" }]] };
    const message = `🛒 <b>KATALOG PRODUK</b>\n──────────────────\nSaldo Anda: 💰 <code>Rp ${formatNumber(saldo)}</code>\n\nPilih produk yang ingin Anda beli:\n(Angka dalam [...] adalah jumlah stok)`;

    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
}


// ** ✨ Handle Detail Akun (Lebih Detail) ✨ **
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
    const filteredAccounts = Object.entries(accounts).filter(([e, a]) => a.name === name && a.price === priceInt);

    if (filteredAccounts.length === 0) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Stok item ini baru saja habis!", true);
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, `❌ Stok <b>${name}</b> baru saja habis.`, { inline_keyboard: [[{ text: "🛒 Kembali ke Katalog", callback_data: "beli_akun" }]] });
    }

    const [email] = filteredAccounts[0];
    const akun = accounts[email];
    const canBuy = saldo >= akun.price;

    let message = `
✨ <b>DETAIL PRODUK & KONFIRMASI</b> ✨

──────────────────
<b>${akun.name}</b>
──────────────────
📄 <b>Deskripsi:</b>
   ${akun.description || '<i>Tidak ada deskripsi</i>'}

💰 <b>Harga:</b> <code>Rp ${formatNumber(akun.price)}</code>
📦 <b>Stok Tersedia:</b> ${filteredAccounts.length}

Saldo Anda: <code>Rp ${formatNumber(saldo)}</code>
`;

    const keyboard = [];
    if (canBuy) {
        message += `\n✅ Saldo Anda cukup. Lanjutkan pembelian?`;
        keyboard.push(
             { text: `✅ Beli (Rp ${formatNumber(akun.price)})`, callback_data: `beli_${email}` },
             { text: "🔙 Kembali ke Katalog", callback_data: "beli_akun" }
        );
    } else {
        message += `\n❌ Saldo Anda tidak cukup (kurang <code>Rp ${formatNumber(akun.price - saldo)}</code>).`;
        keyboard.push(
             { text: "💳 Isi Saldo Dulu", callback_data: "deposit" },
             { text: "🔙 Kembali ke Katalog", callback_data: "beli_akun" }
        );
    }

    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, { inline_keyboard: [keyboard] });
}


// ** ✨ Handle Proses Pembelian (Resi Lebih Detail) ✨ **
async function handleProsesPembelian(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id.toString();
    const callbackData = callbackQuery.data;
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    const email = callbackData.split('_')[1];

    if (!accounts[email]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Akun sudah terjual!", true); return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, "<b>⚠️ Akun sudah terjual.</b>", { inline_keyboard: [[{ text: "🛒 Kembali ke Katalog", callback_data: "beli_akun" }]] }); }
    const akun = accounts[email]; const harga = akun.price;
    if (!users[userId]) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Anda belum terdaftar! /start", true); return; }
    const saldo = users[userId].saldo;
    if (saldo < harga) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "Saldo tidak cukup!", true); return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, `<b>🚫 SALDO KURANG</b>\nSaldo: <code>Rp ${formatNumber(saldo)}</code>\nHarga: <code>Rp ${formatNumber(harga)}</code>`, { inline_keyboard: [[{ text: "💳 Isi Saldo", callback_data: "deposit" }]] }); }

    users[userId].saldo -= harga; await saveDB(env.BOT_DB, users, 'users');
    delete accounts[email]; await saveDB(env.BOT_DB, accounts, 'accounts');
    const currentSaldo = users[userId].saldo;

    const receipt = `
🧾 <b>TRANSAKSI BERHASIL</b> 🧾

Terima kasih, <b>${user.first_name}</b>! Pembelian Anda sukses.

──────────────────
<b>DETAIL AKUN ANDA:</b>
──────────────────
✨ <b>Produk:</b> ${akun.name}
📧 <b>Login:</b> <code>${akun.email}</code>
🔑 <b>Password:</b> <code>${akun.password}</code>
🗒️ <b>Catatan Tambahan:</b>
   ${akun.note || '<i>Tidak ada</i>'}
──────────────────
<b>RINCIAN PEMBAYARAN:</b>
──────────────────
💸 <b>Harga Produk:</b> <code>Rp ${formatNumber(harga)}</code>
💰 <b>Saldo Terpotong:</b> <code>Rp ${formatNumber(harga)}</code>
💳 <b>Sisa Saldo Anda:</b> <code>Rp ${formatNumber(currentSaldo)}</code>
──────────────────

Mohon simpan detail akun ini dengan aman. 🙏
    `;

    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "✅ Pembelian Berhasil!");
    const keyboard = { inline_keyboard: [[{ text: "🛒 Beli Produk Lain", callback_data: "beli_akun" }, { text: "🏠 Menu Utama", callback_data: "back_to_main" }]] };
    await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, receipt, keyboard);

    // Notif Admin & Log (tetap sama)
    const username = user.username || "null";
    const adminMessage = `🛒 Penjualan!\nUser: @${username} (${userId})\nProduk: ${akun.name} | Rp ${formatNumber(harga)}\nSisa Saldo: Rp ${formatNumber(currentSaldo)}`;
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMessage);
    await sendLogNotification(env, 'PEMBELIAN', user, { name: akun.name, price: akun.price, email: akun.email, password: akun.password, currentSaldo: currentSaldo });
}

// ** ✨ Handle Deposit Callback (Lebih Jelas) ✨ **
async function handleDepositCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const pending = await getPendingPayment(env.BOT_DB, user.id);
    if (pending) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⚠️ Masih ada deposit pending.", true); return; }
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
    const maxRand = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
    const config = await getConfig(env.BOT_DB);
    userSessions.set(user.id, { action: 'awaiting_deposit_nominal' });
    let message = `💳 <b>DEPOSIT SALDO VIA QRIS</b>\n──────────────────\n minimal: <code>Rp ${formatNumber(minAmount)}</code>\nKode Unik: 1-${maxRand} Rupiah akan ditambahkan.`;
    if (config.bonus_percentage > 0) message += `\n Bonus: <b>${config.bonus_percentage}%</b> akan ditambahkan!`;
    message += `\n──────────────────\nBalas pesan ini dengan <b>JUMLAH NOMINAL</b> deposit:\nContoh: <code>50000</code>`;
    const kb = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "back_to_main" }]] };
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, kb);
}


// ** ✨ Handle Deposit Message (Error Lebih Jelas) ✨ **
async function handleDepositMessage(update, env) {
    const message = update.message;
    const user = message.from;
    const text = message.text;
    const session = userSessions.get(user.id);
    if (session?.action !== 'awaiting_deposit_nominal') { if (user.id.toString() === env.ADMIN_ID && userSessions.has(user.id)) return null; return null; }
    userSessions.delete(user.id);
    const pending = await getPendingPayment(env.BOT_DB, user.id);
    if (pending) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "⚠️ Masih ada deposit yang belum selesai."); }
    try {
        const nominal = parseInt(text); const minAmount = parseInt(env.MIN_AMOUNT) || 1000;
        if (isNaN(nominal) || nominal <= 0) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Input tidak valid.\nMasukkan <b>angka nominal</b> saja, contoh: <code>10000</code>`); }
        if (nominal < minAmount) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, `⚠️ Minimal deposit adalah <b>Rp ${formatNumber(minAmount)}</b>.`); }
        await createQrisAndConfirm(env, user, nominal);
        return new Response('Processing QRIS'); // Balas OK ke Telegram
    } catch (e) { console.error("Deposit msg err:", e); return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Terjadi kesalahan saat memproses nominal."); }
}

// ** ✨ Create QRIS (Tampilan Pending Lebih Detail) ✨ **
async function createQrisAndConfirm(env, user, nominal) {
    const randomAddition = getRandomAmount(env);
    const finalNominal = nominal + randomAddition;
    try {
        const response = await fetch(`${env.API_CREATE_URL}?amount=${finalNominal}&qrisCode=${env.QRIS_CODE}`);
        const data = await response.json();
        if (data.status === "success") {
            const qrisUrl = data.data.download_url; const transactionId = data.data["kode transaksi"];
            const pData = { nominal, finalNominal, transactionId, timestamp: new Date(), status: "pending", messageId: null };
            await savePendingPayment(env.BOT_DB, user.id, pData);
            const keyboard = { inline_keyboard: [[{ text: "✅ Saya Sudah Bayar", callback_data: `confirm_payment_${transactionId}` }, { text: "❌ Batalkan", callback_data: "cancel_payment" }]] };
            const caption = `⏳ <b>INSTRUKSI PEMBAYARAN QRIS</b> ⏳\n──────────────────\n Harap transfer <b>TEPAT SEJUMLAH TOTAL</b> di bawah ini agar terdeteksi otomatis.\n\n<b>ID Transaksi:</b> <code>${transactionId}</code>\n<b>Nominal Deposit:</b> <code>Rp ${formatNumber(nominal)}</code>\n<b>Kode Unik:</b> <code>Rp ${randomAddition}</code>\n<b>TOTAL TRANSFER:</b> 👉 <b><code>Rp ${formatNumber(finalNominal)}</code></b> 👈\n──────────────────\nScan QRIS di atas.\nBatas waktu pembayaran: <b>10 menit</b>.\n\nTekan tombol "✅ Saya Sudah Bayar" <b>SETELAH</b> Anda berhasil melakukan transfer.`;
            const sent = await sendTelegramPhoto(env.BOT_TOKEN, user.id, qrisUrl, caption, keyboard);
            if (sent?.ok) { pData.messageId = sent.result.message_id; await savePendingPayment(env.BOT_DB, user.id, pData); }
            const adminMsg = `⏳ Depo Pending: @${user.username || user.id} | ID: ${transactionId} | Total: Rp ${formatNumber(finalNominal)}`;
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMsg);
        } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal membuat QRIS dari API."); }
    } catch (e) { console.error('Create QRIS err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error saat request QRIS."); }
}


// ** ✨ Handle Konfirmasi Pembayaran (Lebih Detail & Bonus) ✨ **
async function handleConfirmPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const callbackData = callbackQuery.data;
    const pData = await getPendingPayment(env.BOT_DB, userId);
    if (!pData) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Deposit tidak ditemukan.", true); return; }
    const transactionId = callbackData.split('_')[2];
    if (pData.transactionId !== transactionId) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ ID Transaksi salah.", true); return; }
    const now = new Date(); const pTime = new Date(pData.timestamp); const diffMins = (now - pTime) / 60000;

    if (diffMins > 10) {
        await removePendingPayment(env.BOT_DB, userId);
        const expiredNotif = `⌛️ <b>Deposit Expired</b>\nID: <code>${transactionId}</code>\nBatas waktu terlewati.`;
        await sendTelegramMessage(env.BOT_TOKEN, userId, expiredNotif);
        const expiredCap = `❌ <b>EXPIRED</b>\nID: <code>${transactionId}</code>\nBatas waktu habis.`;
        if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, expiredCap); } catch(e){} }
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Pembayaran expired.", true); return;
    }

    try {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "🔍 Mengecek status pembayaran...");
        const response = await fetch(`${env.API_CHECK_PAYMENT}?merchant=${env.MERCHANT_ID}&key=${env.API_KEY}`);
        if (!response.ok) throw new Error(`API check failed: ${response.status}`);
        const data = await response.json();
        if (data.status !== "success") throw new Error(`API returned status: ${data.status}`);

        const payments = data.data || []; let found = false;
        for (const p of payments) { if (p && typeof p === 'object' && p.amount === pData.finalNominal) { found = true; break; } }

        if (found) {
            const users = await loadDB(env.BOT_DB, 'users'); const config = await getConfig(env.BOT_DB); const uidStr = userId.toString();
            if (!users[uidStr]) users[uidStr] = { saldo: 0, joined: new Date().toISOString() };
            const bonusPerc = config.bonus_percentage || 0; const bonusAmt = Math.floor(pData.nominal * (bonusPerc / 100)); const totalAdd = pData.nominal + bonusAmt;
            users[uidStr].saldo += totalAdd; await saveDB(env.BOT_DB, users, 'users');
            const newSaldo = users[uidStr].saldo;
            await removePendingPayment(env.BOT_DB, userId);

            let newCaption = `🎉 <b>DEPOSIT BERHASIL!</b> 🎉\n\nSaldo Anda telah ditambahkan.\n──────────────────\n<b>RINCIAN TRANSAKSI:</b>\n──────────────────\n🆔 <b>ID:</b> <code>${transactionId}</code>\n💸 <b>Nominal:</b> <code>Rp ${formatNumber(pData.nominal)}</code>`;
            if (bonusAmt > 0) newCaption += `\n🎁 <b>Bonus (${bonusPerc}%):</b> <code>Rp ${formatNumber(bonusAmt)}</code>\n➡️ <b>Total Masuk:</b> <code>Rp ${formatNumber(totalAdd)}</code>`;
            newCaption += `\n💰 <b>Saldo Akhir:</b> <b><code>Rp ${formatNumber(newSaldo)}</code></b>\n──────────────────\nTerima kasih, <b>${user.first_name}</b>! 🙏`;

            if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, newCaption); } catch(e){} }

            let adminMsg = `✅ Depo Sukses: @${user.username || uidStr} | ID: ${transactionId} | Nom: Rp ${formatNumber(pData.nominal)}`;
            if (bonusAmt > 0) adminMsg += ` | Bonus: Rp ${formatNumber(bonusAmt)}`;
            adminMsg += ` | Saldo Baru: Rp ${formatNumber(newSaldo)}`;
            await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMsg);

            await sendLogNotification(env, 'DEPOSIT', user, { transactionId: transactionId, nominal: pData.nominal, bonusPercentage: bonusPerc, bonusAmount: bonusAmt, totalAdded: totalAdd, finalNominal: pData.finalNominal, currentSaldo: newSaldo });

        } else { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "⏳ Pembayaran belum terdeteksi. Mohon tunggu & coba konfirmasi lagi.", true); }
    } catch (error) { console.error('Confirm payment err:', error); await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, `❌ Error: ${error.message || 'Gagal cek pembayaran.'}`, true); }
}

// ** ✨ Handle Batal Pembayaran (Lebih Jelas) ✨ **
async function handleCancelPayment(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    const pData = await getPendingPayment(env.BOT_DB, userId);
    if (!pData) { await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Tidak ada deposit pending.", true); return; }
    const transactionId = pData.transactionId;
    await removePendingPayment(env.BOT_DB, userId);
    const newCaption = `🚫 <b>PEMBAYARAN DIBATALKAN</b>\n\nID Transaksi: <code>${transactionId}</code>\n\nDeposit ini telah dibatalkan atas permintaan Anda.`;
    if (pData.messageId) { try { await editMessageCaption(env.BOT_TOKEN, userId, pData.messageId, newCaption); } catch(e){} }
    const adminMsg = `🚫 Depo Batal: @${user.username || userId} | ID: ${transactionId}`;
    await sendTelegramMessage(env.BOT_TOKEN, env.ADMIN_ID, adminMsg);
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "🚫 Deposit dibatalkan.", true);
}


// --- (BAGIAN 3: LOGIKA ADMIN (Termasuk Perbaikan Back & Bonus)) ---
// (handleAdmin, handleAdminActions, handleAdminMessage, handleBroadcast)

async function handleAdmin(update, env) {
    const message = update.message; const user = message.from;
    if (user.id.toString() !== env.ADMIN_ID) { return await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Akses Ditolak!"); }
    const users = await loadDB(env.BOT_DB, 'users'); const accs = await loadDB(env.BOT_DB, 'accounts'); const cfg = await getConfig(env.BOT_DB);
    const kb = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }], [{ text: "🛒 Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Akun", cb: "admin_hapus_akun" }], [{ text: "👥 Member", cb: "admin_cek_member" }, { text: "📢 BC", cb: "admin_broadcast" }], [{ text: "⏰ Pending", cb: "admin_cek_pending" }, { text: `⚙️ Bonus (${cfg.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]].map(row => row.map(btn => ({ text: btn.text, callback_data: btn.cb }))) };
    const adminMsg = `🛡️ <b>ADMIN PANEL</b> 🛡️\n<i>${env.BOT_NAME || 'Bot'}</i>\n\n📊 Member: <code>${Object.keys(users).length}</code> | Stok: <code>${Object.keys(accs).length}</code> | Bonus: <code>${cfg.bonus_percentage || 0}%</code>\n\nPilih menu:`;
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, adminMsg, kb);
}

async function handleAdminActions(update, env) {
    const cbQ = update.callback_query; const user = cbQ.from; const cbData = cbQ.data;
    if (user.id.toString() !== env.ADMIN_ID) { await answerCallbackQuery(env.BOT_TOKEN, cbQ.id, "❌ Akses ditolak!", true); return new Response('Forbidden'); }
    await answerCallbackQuery(env.BOT_TOKEN, cbQ.id); let msg = ""; let kb_sub = { inline_keyboard: [[{ text: "🔙 Kembali ke Panel Admin", callback_data: "admin_back" }]] };
    switch (cbData) {
        case "admin_tambah_saldo": msg = `➕ Tambah Saldo:\nFormat: <code>id jumlah</code>`; userSessions.set(user.id, { action: 'tambah_saldo' }); break;
        case "admin_kurangi_saldo": msg = `➖ Kurangi Saldo:\nFormat: <code>id jumlah</code>`; userSessions.set(user.id, { action: 'kurangi_saldo' }); break;
        case "admin_tambah_akun": msg = `🛒 Tambah Akun:\nMasukkan <b>nama produk</b>:`; userSessions.set(user.id, { action: 'tambah_akun', step: 'nama', data: {} }); break;
        case "admin_hapus_akun": msg = `🗑️ Hapus Akun:\nMasukkan <b>email/username</b>:`; userSessions.set(user.id, { action: 'hapus_akun' }); break;
        case "admin_cek_member": const usrs = await loadDB(env.BOT_DB, 'users'); msg = `👥 Member: <code>${Object.keys(usrs).length}</code>\n${Object.entries(usrs).map(([id, d]) => `<code>${id}</code>: Rp ${formatNumber(d.saldo)}`).join('\n')}`; break;
        case "admin_broadcast": msg = `📢 Broadcast:\nBalas pesan ini dgn <code>/broadcast</code>`; break;
        case "admin_cek_pending": const pend = await loadPendingPayments(env.BOT_DB); msg = `⏰ Pending: <code>${Object.keys(pend).length}</code>\n${Object.entries(pend).map(([id, p]) => `<code>${id}</code>: ${p.transactionId} (${Math.max(0, 10 - Math.floor((new Date() - new Date(p.timestamp)) / 60000))}m)`).join('\n')}`; break;
        case "admin_set_bonus": const cfg = await getConfig(env.BOT_DB); msg = `⚙️ Atur Bonus (%)\nSaat ini: <b>${cfg.bonus_percentage || 0}%</b>\nMasukkan angka baru (0 nonaktif):`; userSessions.set(user.id, { action: 'set_bonus' }); break;
        case "admin_back": // Perbaikan tombol back
            userSessions.delete(user.id);
            const users_a = await loadDB(env.BOT_DB, 'users'); const acc_a = await loadDB(env.BOT_DB, 'accounts'); const conf_a = await getConfig(env.BOT_DB);
            const kb_a = { inline_keyboard: [[{ text: "➕ Saldo", cb: "admin_tambah_saldo" }, { text: "➖ Saldo", cb: "admin_kurangi_saldo" }], [{ text: "🛒 Akun", cb: "admin_tambah_akun" }, { text: "🗑️ Akun", cb: "admin_hapus_akun" }], [{ text: "👥 Member", cb: "admin_cek_member" }, { text: "📢 BC", cb: "admin_broadcast" }], [{ text: "⏰ Pending", cb: "admin_cek_pending" }, { text: `⚙️ Bonus (${conf_a.bonus_percentage || 0}%)`, cb: "admin_set_bonus" }]].map(r => r.map(b => ({ text: b.text, callback_data: b.cb }))) };
            const msg_a = `🛡️ <b>ADMIN PANEL</b> 🛡️\n<i>${env.BOT_NAME || 'Bot'}</i>\n\n📊 Member: <code>${Object.keys(users_a).length}</code> | Stok: <code>${Object.keys(acc_a).length}</code> | Bonus: <code>${conf_a.bonus_percentage || 0}%</code>\n\nPilih menu:`;
            await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg_a, kb_a);
            return new Response('OK'); // Kembalikan OK setelah edit
        default: msg = "❓ Aksi admin tidak dikenal."; break;
    }
    return await editMessageText(env.BOT_TOKEN, user.id, cbQ.message.message_id, msg, kb_sub);
}

async function handleAdminMessage(update, env) {
    const message = update.message; const user = message.from; const text = message.text;
    if (user.id.toString() !== env.ADMIN_ID) return; const session = userSessions.get(user.id); if (!session) return;
    const users = await loadDB(env.BOT_DB, 'users'); const accounts = await loadDB(env.BOT_DB, 'accounts');
    try {
        switch (session.action) {
            case 'tambah_saldo': case 'kurangi_saldo': const [tid, aStr] = text.split(' '); const amt = parseInt(aStr); if (!tid || !amt || isNaN(amt)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Format: <code>ID JUMLAH</code>"); return new Response('Invalid Format'); } if (!users[tid]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ User ID tidak ada."); return new Response('User Not Found'); } if (session.action === 'tambah_saldo') { users[tid].saldo += amt; } else { if (users[tid].saldo < amt) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Saldo user kurang.`); return new Response('Insufficient Balance'); } users[tid].saldo -= amt; } await saveDB(env.BOT_DB, users, 'users'); const admMsg = `✅ Saldo <code>${tid}</code> ${session.action === 'tambah_saldo' ? 'ditambah' : 'dikurangi'} <code>Rp ${formatNumber(amt)}</code>.\nSaldo baru: <code>Rp ${formatNumber(users[tid].saldo)}</code>`; const usrMsg = `🔔 Saldo Anda ${session.action === 'tambah_saldo' ? 'ditambah' : 'dikurangi'} <code>Rp ${formatNumber(amt)}</code> oleh admin.\nSaldo baru: <code>Rp ${formatNumber(users[tid].saldo)}</code>`; await sendTelegramMessage(env.BOT_TOKEN, user.id, admMsg); await sendTelegramMessage(env.BOT_TOKEN, parseInt(tid), usrMsg); userSessions.delete(user.id); break;
            case 'tambah_akun': const step = session.step; const d = session.data; if (step === 'nama') { d.name = text; session.step = 'email'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "📧 Email/User:"); } else if (step === 'email') { d.email = text; session.step = 'password'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🔑 Password:"); } else if (step === 'password') { d.password = text; session.step = 'harga'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "💰 Harga:"); } else if (step === 'harga') { d.price = parseInt(text); if (isNaN(d.price)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Harga angka."); return new Response('Invalid Price'); } session.step = 'deskripsi'; await sendTelegramMessage(env.BOT_TOKEN, user.id, `📝 Deskripsi:\nHarga: Rp ${formatNumber(d.price)}`); } else if (step === 'deskripsi') { d.description = text; session.step = 'catatan'; await sendTelegramMessage(env.BOT_TOKEN, user.id, "🗒️ Catatan ('tidak ada' jika kosong):"); } else if (step === 'catatan') { d.note = text.toLowerCase() !== "tidak ada" ? text : "-"; if (accounts[d.email]) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${d.email}</code> sudah ada.`); userSessions.delete(user.id); return new Response('Account Exists'); } accounts[d.email] = d; await saveDB(env.BOT_DB, accounts, 'accounts'); const added = `✅ Akun ditambahkan:\n<code>${d.name}</code> | ${d.email} | ${d.password} | Rp ${formatNumber(d.price)}`; await sendTelegramMessage(env.BOT_TOKEN, user.id, added); userSessions.delete(user.id); } break;
            case 'hapus_akun': if (accounts[text]) { delete accounts[text]; await saveDB(env.BOT_DB, accounts, 'accounts'); await sendTelegramMessage(env.BOT_TOKEN, user.id, "✅ Akun dihapus."); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, `❌ Akun <code>${text}</code> tidak ada.`); } userSessions.delete(user.id); break;
            case 'set_bonus': const bonus = parseInt(text); if (isNaN(bonus) || bonus < 0) { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Masukkan angka persen bonus (0 atau lebih)."); return new Response('Invalid Bonus'); } const cfg = await getConfig(env.BOT_DB); cfg.bonus_percentage = bonus; if (await saveConfig(env.BOT_DB, cfg)) { await sendTelegramMessage(env.BOT_TOKEN, user.id, `✅ Bonus deposit diatur ke <b>${bonus}%</b>.`); } else { await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Gagal simpan bonus."); } userSessions.delete(user.id); break;
            default: userSessions.delete(user.id); break;
        }
    } catch (e) { console.error('Admin msg err:', e); await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ Error proses perintah admin."); userSessions.delete(user.id); }
    return new Response('OK'); // Kembalikan OK setelah proses admin
}


async function handleBroadcast(update, env) { /* ... (Kode handleBroadcast tetap sama) ... */ }
async function cleanupExpiredPayments(env) { /* ... (Kode cleanupExpiredPayments dengan notif user) ... */ }
function handleInfo(env) { /* ... (Kode handleInfo tampilan web) ... */ }


// --- (BAGIAN 4: ROUTING MENGGUNAKAN ITTY-ROUTER) ---

router.post('/', async (request, env, ctx) => {
    try {
        const update = await request.json();
        ctx.waitUntil(cleanupExpiredPayments(env)); // Jalankan cleanup di background

        let responseObj = null; // Untuk menyimpan hasil return dari handler

        if (update.message) {
            const text = update.message.text || '';
            const user = update.message.from;
            const session = userSessions.get(user.id);

            // Prioritas 1: Sesi Deposit
            if (session?.action === 'awaiting_deposit_nominal' && !text.startsWith('/')) {
                responseObj = await handleDepositMessage(update, env);
            }
            // Prioritas 2: Sesi Admin
            else if (user.id.toString() === env.ADMIN_ID && session && !text.startsWith('/')) {
                responseObj = await handleAdminMessage(update, env); // handleAdminMessage mengembalikan Response atau null
            }
            // Prioritas 3: Perintah
            else if (text.startsWith('/start'))   responseObj = await handleStart(update, env);
            else if (text.startsWith('/id'))      responseObj = await handleGetId(update, env);
            else if (text.startsWith('/admin'))   responseObj = await handleAdmin(update, env);
            else if (text.startsWith('/broadcast')) responseObj = await handleBroadcast(update, env);

        } else if (update.callback_query) {
            const callbackData = update.callback_query.data;
                 if (callbackData === 'beli_akun')           responseObj = await handleBeliAkunCallback(update, env);
            else if (callbackData.startsWith('group_'))      responseObj = await handleDetailAkun(update, env);
            else if (callbackData.startsWith('beli_'))       responseObj = await handleProsesPembelian(update, env);
            else if (callbackData === 'deposit')              responseObj = await handleDepositCallback(update, env);
            else if (callbackData.startsWith('confirm_payment_')) responseObj = await handleConfirmPayment(update, env);
            else if (callbackData === 'cancel_payment')      responseObj = await handleCancelPayment(update, env);
            else if (callbackData.startsWith('admin_'))      responseObj = await handleAdminActions(update, env); // Mengembalikan Response
            else if (callbackData === 'back_to_main')        responseObj = await handleBackToMain(update, env);
            else if (callbackData === 'info_akun')           responseObj = await handleGetInfoAkun(update, env, true); // Panggil handler info akun
        }

        // Cek tipe hasil return
        if (responseObj instanceof Response) {
            return responseObj; // Jika sudah Response, langsung return
        } else if (responseObj) {
            return new Response(JSON.stringify(responseObj)); // Jika objek, jadikan JSON Response
        } else {
            return new Response('OK'); // Default jika tidak ada handler atau return null
        }

    } catch (error) {
        console.error('Error handling Telegram update:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
});

// Endpoint Tampilan Web & Fallback
router.get('/info', (request, env) => handleInfo(env));
router.get('/', () => new Response('🤖 Bot Aktif! Akses /info untuk status web.'));
router.all('*', () => new Response('404 Not Found', { status: 404 }));

// Export handler
export default {
    fetch: router.handle
};
