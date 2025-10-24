 import { Router } from 'itty-router';

const router = Router();

// In-memory session storage
const userSessions = new Map();

// === Utility ===
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function getRandomAmount(env) {
  const min = parseInt(env.RANDOM_AMOUNT_MIN) || 1;
  const max = parseInt(env.RANDOM_AMOUNT_MAX) || 50;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// === Telegram helpers ===
async function sendTelegramMessage(token, chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
}
async function answerCallbackQuery(token, id, text = '', showAlert = false) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ callback_query_id: id, text, show_alert: showAlert })
  });
}
async function editMessageText(token, chatId, msgId, text, markup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, message_id: msgId, text, parse_mode: parseMode };
  if (markup) payload.reply_markup = markup;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
}

// === KV helpers ===
async function loadDB(binding, key) {
  try { const data = await binding.get(key, 'json'); return data || {}; }
  catch { return {}; }
}
async function saveDB(binding, obj, key) {
  await binding.put(key, JSON.stringify(obj));
}

// === START command ===
async function handleStart(update, env) {
  const user = update.message.from;
  const userId = user.id.toString();
  const username = user.username || "Tidak ada";

  const users = await loadDB(env.BOT_DB, 'users');
  const accounts = await loadDB(env.BOT_DB, 'accounts');
  if (!users[userId]) {
    users[userId] = { saldo: 0 };
    await saveDB(env.BOT_DB, users, 'users');
  }

  const saldo = formatNumber(users[userId].saldo);
  const stok = Object.keys(accounts).length;
  const adminUsername = env.ADMIN_USERNAME || "@admin";

  const message = `
👋 <b>Selamat Datang di Bot Order Otomatis</b>

🆔 <b>User ID:</b> <code>${userId}</code>
👤 <b>Username:</b> <code>@${username}</code>
💰 <b>Saldo Anda:</b> <code>Rp ${saldo}</code>
📦 <b>Stok Akun:</b> <code>${stok}</code>
👨‍💼 <b>Admin:</b> ${adminUsername}

Gunakan menu di bawah ini.
  `;
  const keyboard = {
    inline_keyboard: [
      [{ text: "🛒 Beli Akun", callback_data: "beli_akun" }],
      [{ text: "💳 Deposit Saldo", callback_data: "deposit" }],
      [{ text: "🔐 Buat SSH Trial", callback_data: "trial_ssh" }]
    ]
  };
  await sendTelegramMessage(env.BOT_TOKEN, userId, message, keyboard);
}

// === ID command ===
async function handleId(update, env) {
  const user = update.message.from;
  const msg = `
🆔 <b>ID Anda:</b> <code>${user.id}</code>
👤 <b>Username:</b> <code>@${user.username || "Tidak ada"}</code>
  `;
  await sendTelegramMessage(env.BOT_TOKEN, user.id, msg);
}

// === SSH Trial Feature ===

// Random username generator (3 digits)
function generateRandomSshUser(prefix = 'u') {
  const digits = Math.floor(100 + Math.random() * 900);
  return `${prefix}${digits}`;
}

// Call external API
async function createTrialSSH() {
  const username = generateRandomSshUser();
  const url = `http://47.84.41.224:6969/trial-ssh?auth=tlzgmpg6p7&username=${username}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: resp.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Parse API response
function parseSshApiResponse(resp) {
  const d = resp.data?.data || resp.data || {};
  return {
    domain: d.domain || d.host || d.server || "N/A",
    username: d.username || "N/A",
    password: d.password || "N/A",
    expired: d.expired || d.exp || "N/A",
    created: d.created || d.created_at || new Date().toLocaleString()
  };
}

// Handler callback trial_ssh
async function handleTrialSshCallback(update, env) {
  const query = update.callback_query;
  const uid = query.from.id;
  await answerCallbackQuery(env.BOT_TOKEN, query.id, "🔧 Membuat akun SSH...");

  const resp = await createTrialSSH();
  if (!resp.ok) {
    const err = resp.error || "Gagal membuat akun SSH.";
    return await editMessageText(env.BOT_TOKEN, uid, query.message.message_id,
      `<b>❌ Gagal Membuat SSH Trial:</b>\n<code>${err}</code>`);
  }

  if (resp.data.raw) {
    return await editMessageText(env.BOT_TOKEN, uid, query.message.message_id,
      `<b>✅ SSH Trial (Raw Response)</b>\n<pre>${resp.data.raw}</pre>`);
  }

  const ssh = parseSshApiResponse(resp);
  const msg = `
✅ <b>SSH Trial Berhasil Dibuat!</b>

🌐 <b>Domain/IP:</b> <code>${ssh.domain}</code>
👤 <b>Username:</b> <code>${ssh.username}</code>
🔑 <b>Password:</b> <code>${ssh.password}</code>
📅 <b>Expired:</b> <code>${ssh.expired}</code>
🕒 <b>Dibuat:</b> <code>${ssh.created}</code>

<i>Data ini berasal dari API SSH</i>
  `;
  await editMessageText(env.BOT_TOKEN, uid, query.message.message_id, msg);
}

// === Router utama ===
router.post('/', async (req, env) => {
  try {
    const update = await req.json();
    console.log("📩 Update:", JSON.stringify(update, null, 2));

    if (update.message) {
      const text = update.message.text || '';
      if (text.startsWith('/start')) await handleStart(update, env);
      else if (text.startsWith('/id')) await handleId(update, env);
      // panggil handler lain (beli akun, deposit, dll) seperti sebelumnya
    } else if (update.callback_query) {
      const data = update.callback_query.data;
      if (data === 'trial_ssh') await handleTrialSshCallback(update, env);
      // callback lainnya (beli_akun, deposit, admin, dst) tetap berfungsi
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error("❌ Error:", err);
    return new Response('Error: ' + err.message, { status: 500 });
  }
});

router.get('/', () => new Response('✅ Bot aktif di Cloudflare Worker!'));

export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  }
};
