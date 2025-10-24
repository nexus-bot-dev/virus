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

// ------------------------------------------------------------------
// Pending payments functions (tetap sama)
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

// Kirim request ke Telegram API (tetap)
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

// -------------------------- NEW: SSH helper & config --------------------------

// Ambil config (ssh_ip & ssh_auth) dari DB 'config' object (disimpan di BOT_DB -> 'config')
async function loadConfig(binding) {
    const all = await loadDB(binding, 'config');
    return all || {};
}
async function saveConfig(binding, configObj) {
    const all = await loadDB(binding, 'config');
    const merged = { ...(all || {}), ...configObj };
    return await saveDB(binding, merged, 'config');
}

// Generate username random + 3 digit
function generateRandomSshUser(prefix = 'user') {
    const digits = Math.floor(100 + Math.random() * 900); // 100-999
    return `${prefix}${digits}`;
}

// Call external trial-ssh API
async function createTrialSSH(sshIp, sshAuth, username) {
    try {
        // Pastikan sshIp tidak memiliki trailing slash
        if (!sshIp) throw new Error('ssh_ip not configured');
        const base = sshIp.replace(/\/+$/, '');
        // Build URL (assume GET endpoint as contoh)
        const url = `${base}/trial-ssh?auth=${encodeURIComponent(sshAuth || '')}&username=${encodeURIComponent(username)}`;
        const resp = await fetch(url);
        const text = await resp.text();
        // Try parse JSON safely
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // jika bukan JSON, return raw text
            return { ok: resp.ok, raw: text };
        }
        return { ok: resp.ok, data };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

// Parse response data ke format yang kita inginkan (tolerant)
function parseSshApiResponse(resp) {
    // resp.data bisa berbeda struktur, coba ambil fields umum
    if (!resp) return null;
    const d = resp.data || resp;
    // beberapa API bungkus di d.result atau d.data
    const possible = d.data || d.result || d;
    // try common keys
    const domain = possible.domain || possible.host || possible.server || possible.ip || possible.hostname || possible.hostnames;
    const username = possible.username || possible.user || possible.login;
    const password = possible.password || possible.pass || possible.pwd;
    const exp = possible.expired || possible.exp || possible.expire || possible.expired_at || possible.expires_at;
    const created = possible.created_at || possible.created || possible.date || possible.createdAt;
    // return object
    return {
        domain: domain || 'N/A',
        username: username || 'N/A',
        password: password || 'N/A',
        exp: exp || 'N/A',
        created: created || 'N/A'
    };
}

// -------------------------- existing features (start, id, etc.) --------------------------

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

⚙️ <b>Gunakan menu di bawah ini untuk melanjutkan pembelian, deposit, atau membuat SSH trial.</b>
    `;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
            [{ text: "💳 Deposit Saldo", callback_data: "deposit" }],
            [{ text: "🔐 Buat SSH Trial", callback_data: "trial_ssh" }]
        ]
    };
    
    return await sendTelegramMessage(env.BOT_TOKEN, user.id, message, keyboard);
}

// Handle /id
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

// ... (sisa fungsi yang sebelumnya ada tetap sama, saya tidak mengubahnya di sini untuk ringkasan)
// Untuk ringkasan: fungsi pembelian, deposit, payment confirm, admin menu, broadcast, cleanupExpiredPayments, dsb.
// (di file asli Anda semua fungsi tersebut masih ada — tidak dihapus)

// ------------------ NEW: handler untuk membuat trial SSH ------------------

async function handleTrialSshCallback(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const userId = user.id;
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    
    // Ambil config dari DB, kalau kosong gunakan env default
    const config = await loadConfig(env.BOT_DB);
    const sshIp = config.ssh_ip || env.DEFAULT_SSH_IP || "http://47.84.41.224:6969";
    const sshAuth = config.ssh_auth || env.DEFAULT_SSH_AUTH || "";
    
    // Generate username random +3 digit
    const username = generateRandomSshUser('u');
    
    // Panggil API
    const resp = await createTrialSSH(sshIp, sshAuth, username);
    if (!resp.ok) {
        const errMsg = resp.error || resp.raw || 'Gagal memanggil API SSH';
        const message = `<b>❌ Gagal membuat SSH Trial:</b>\n<code>${errMsg}</code>\n\nSilakan hubungi admin.`;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
    }
    
    // Jika API mengembalikan JSON
    if (resp.data) {
        const parsed = parseSshApiResponse(resp);
        const msg = `
✅ <b>SSH Trial Berhasil Dibuat!</b>

🔹 <b>Domain/IP:</b> <code>${parsed.domain}</code>
🔹 <b>Username:</b> <code>${parsed.username}</code>
🔹 <b>Password:</b> <code>${parsed.password}</code>
🔹 <b>Expired:</b> <code>${parsed.exp}</code>
🔹 <b>Dibuat:</b> <code>${parsed.created}</code>

<i>Semua data mengikuti respons dari API SSH.</i>
        `;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, msg);
    } else {
        // kalau API mengembalikan text/plain
        const raw = resp.raw || 'No response';
        const message = `<b>✅ SSH Trial (raw response)</b>\n\n<pre>${raw}</pre>`;
        return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
    }
}

// ------------------ NEW: admin controls untuk SSH config ------------------

async function handleAdminActions(update, env) {
    const callbackQuery = update.callback_query;
    const user = callbackQuery.from;
    const callbackData = callbackQuery.data;
    
    if (user.id.toString() !== env.ADMIN_ID) {
        await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "❌ Akses ditolak!", true);
        return;
    }
    
    await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id);
    
    // ambil users count untuk header (tetap seperti sebelumnya)
    const users = await loadDB(env.BOT_DB, 'users');
    const totalMembers = Object.keys(users).length;
    
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
        // ... existing admin cases (admin_kurangi_saldo, admin_tambah_akun, dll) tetap di sini
        case "admin_ssh_menu":
            // Load config
            const cfg = await loadConfig(env.BOT_DB);
            const sshIp = cfg.ssh_ip || env.DEFAULT_SSH_IP || 'tidak diset';
            const sshAuth = cfg.ssh_auth ? '***hidden***' : 'tidak diset';
            message = `
🔐 <b>SSH Server Configuration</b>

🔹 <b>SSH IP / Endpoint:</b> <code>${sshIp}</code>
🔹 <b>SSH Auth:</b> <code>${sshAuth}</code>

Gunakan tombol di bawah untuk mengubah konfigurasi:
            `;
            const keyboard = {
                inline_keyboard: [
                    [{ text: "✏️ Set SSH IP", callback_data: "admin_set_ssh_ip" }],
                    [{ text: "✏️ Set SSH Auth", callback_data: "admin_set_ssh_auth" }],
                    [{ text: "✅ Tes Buat SSH (contoh)", callback_data: "admin_test_create_ssh" }],
                    [{ text: "🔙 Kembali", callback_data: "admin_back" }]
                ]
            };
            await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message, keyboard);
            return;
        case "admin_set_ssh_ip":
            userSessions.set(user.id, { action: 'set_ssh_ip' });
            message = `<b>Masukkan SSH IP / Endpoint baru</b>\nContoh: http://47.84.41.224:6969`;
            break;
        case "admin_set_ssh_auth":
            userSessions.set(user.id, { action: 'set_ssh_auth' });
            message = `<b>Masukkan SSH auth key baru</b>\nContoh: tlzgmpg6p7`;
            break;
        case "admin_test_create_ssh":
            // langsung coba create dengan username random dan kirim hasil ke admin (async)
            await answerCallbackQuery(env.BOT_TOKEN, callbackQuery.id, "✅ Mencoba membuat SSH Trial... Tunggu sebentar.", true);
            const cfg2 = await loadConfig(env.BOT_DB);
            const sshIp2 = cfg2.ssh_ip || env.DEFAULT_SSH_IP || "http://47.84.41.224:6969";
            const sshAuth2 = cfg2.ssh_auth || env.DEFAULT_SSH_AUTH || "";
            const username = generateRandomSshUser('u');
            const res = await createTrialSSH(sshIp2, sshAuth2, username);
            if (!res.ok) {
                const err = res.error || res.raw || 'Gagal';
                await sendTelegramMessage(env.BOT_TOKEN, user.id, `<b>❌ Tes Gagal:</b>\n<code>${err}</code>`);
            } else if (res.data) {
                const parsed = parseSshApiResponse(res);
                const msg = `
✅ <b>Hasil Tes Pembuatan SSH</b>

🔹 <b>Domain/IP:</b> <code>${parsed.domain}</code>
🔹 <b>Username:</b> <code>${parsed.username}</code>
🔹 <b>Password:</b> <code>${parsed.password}</code>
🔹 <b>Expired:</b> <code>${parsed.exp}</code>
🔹 <b>Dibuat:</b> <code>${parsed.created}</code>
                `;
                await sendTelegramMessage(env.BOT_TOKEN, user.id, msg);
            } else {
                await sendTelegramMessage(env.BOT_TOKEN, user.id, `<b>✅ Raw Response:</b>\n<pre>${res.raw}</pre>`);
            }
            // jangan edit pesan callback lebih lanjut
            return;
        case "admin_back":
            // kembali ke menu admin utama (simple restart of admin command)
            return await handleAdmin(update, env);
        default:
            // handle other admin callbacks (existing code)
            break;
    }
    
    return await editMessageText(env.BOT_TOKEN, user.id, callbackQuery.message.message_id, message);
}

// Handler messages dari admin untuk set ssh config
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
    
    // ambil DB accounts & users sesuai kebiasaan (agar tidak error)
    const users = await loadDB(env.BOT_DB, 'users');
    const accounts = await loadDB(env.BOT_DB, 'accounts');
    
    try {
        switch (session.action) {
            case 'tambah_saldo':
            case 'kurangi_saldo':
                // existing logic (tidak diubah)
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
            // ... other existing admin flows (tambah_akun, hapus_akun) remain unchanged ...
            case 'set_ssh_ip':
                // simpan config
                await saveConfig(env.BOT_DB, { ssh_ip: text.trim() });
                await sendTelegramMessage(env.BOT_TOKEN, user.id, `<b>✅ SSH IP disimpan:</b>\n<code>${text.trim()}</code>`);
                userSessions.delete(user.id);
                break;
            case 'set_ssh_auth':
                await saveConfig(env.BOT_DB, { ssh_auth: text.trim() });
                await sendTelegramMessage(env.BOT_TOKEN, user.id, `<b>✅ SSH auth disimpan.</b>`);
                userSessions.delete(user.id);
                break;
            default:
                // existing 'tambah_akun' flow and others (keperluan backward compatibility)
                // ... keep previous logic for those actions ...
                break;
        }
    } catch (error) {
        console.error('Error processing admin message:', error);
        await sendTelegramMessage(env.BOT_TOKEN, user.id, "❌ <b>Terjadi kesalahan saat memproses perintah.</b>");
        userSessions.delete(user.id);
    }
}

// ------------------ Router utama (sesuaikan untuk callback baru) ------------------

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
                // route admin SSH menu actions too
                if (callbackData === 'admin_ssh_menu' || callbackData === 'admin_set_ssh_ip' || callbackData === 'admin_set_ssh_auth' || callbackData === 'admin_test_create_ssh' || callbackData === 'admin_back') {
                    return new Response(JSON.stringify(await handleAdminActions(update, env)));
                }
                return new Response(JSON.stringify(await handleAdminActions(update, env)));
            } else if (callbackData === 'back_to_main') {
                return new Response(JSON.stringify(await handleBackToMain(update, env)));
            } else if (callbackData === 'trial_ssh') {
                return new Response(JSON.stringify(await handleTrialSshCallback(update, env)));
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
