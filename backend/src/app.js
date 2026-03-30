const express = require('express');
const { nanoid } = require('nanoid');
const rateLimit = require('express-rate-limit');
const { pool, init } = require('./db');
const { client: redis, connect } = require('./cache');
require('dotenv').config();

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
// Called by Docker HEALTHCHECK and Kubernetes liveness probe.
// Must be BEFORE the rate limiter — health checks should never be rate limited.
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ status: 'ok' }));


// Rate limiter for API only
const limiter = rateLimit({
  windowMs: 3000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Slow down — you are not that important.',
    retryAfter: '3 seconds',
  },
});

app.use('/api', limiter);

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// URL validator
const validateUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL must be a non-empty string.' };
  }

  const trimmed = url.trim();

  if (trimmed.length < 11) {
    return { valid: false, reason: 'That is not a real URL.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, reason: 'URL exceeds maximum allowed length (2048 chars).' };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, reason: 'URL must start with http:// or https://' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  if (!parsed.hostname || parsed.hostname.length < 3) {
    return { valid: false, reason: 'URL is missing a valid hostname.' };
  }

  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (blockedHosts.includes(parsed.hostname)) {
    return { valid: false, reason: 'Shortening local/private URLs is not allowed.' };
  }

  const privateIpPattern = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
  if (privateIpPattern.test(parsed.hostname)) {
    return { valid: false, reason: 'Shortening private network URLs is not allowed.' };
  }

  if (!parsed.hostname.includes('.')) {
    return { valid: false, reason: 'URL must have a valid domain (e.g. example.com).' };
  }

  return { valid: true, url: trimmed };
};

// POST /api/shorten
app.post('/api/shorten', async (req, res) => {
  const { originalUrl } = req.body;

  const validation = validateUrl(originalUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason });
  }

  const cleanUrl = validation.url;

  try {
    const existing = await pool.query(
      'SELECT short_code FROM urls WHERE original_url = $1',
      [cleanUrl]
    );

    if (existing.rows.length > 0) {
      const existingCode = existing.rows[0].short_code;
      return res.json({
        shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/api/${existingCode}`,
        shortCode: existingCode,
        duplicate: true,
      });
    }

    let shortCode;
    let attempts = 0;

    while (attempts < 5) {
      shortCode = nanoid(6);
      const collision = await pool.query(
        'SELECT 1 FROM urls WHERE short_code = $1',
        [shortCode]
      );
      if (collision.rows.length === 0) break;
      attempts++;
    }

    if (attempts === 5) {
      return res.status(500).json({ error: 'Could not generate a unique code. Try again.' });
    }

    await pool.query(
      'INSERT INTO urls (short_code, original_url) VALUES ($1, $2)',
      [shortCode, cleanUrl]
    );

    await redis.set(shortCode, cleanUrl, { EX: 3600 });

    return res.status(201).json({
      shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/api/${shortCode}`,
      shortCode,
      duplicate: false,
    });
  } catch (err) {
    console.error('POST /api/shorten error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/:code
app.get('/api/:code', async (req, res) => {
  const { code } = req.params;

  if (!/^[A-Za-z0-9_-]{4,10}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid short code format.' });
  }

  try {
    const cached = await redis.get(code);
    if (cached) {
      await pool.query(
        'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
        [code]
      );
      return res.redirect(302, cached);
    }

    const result = await pool.query(
      'SELECT original_url FROM urls WHERE short_code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }

    const originalUrl = result.rows[0].original_url;

    await redis.set(code, originalUrl, { EX: 3600 });

    await pool.query(
      'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
      [code]
    );

    return res.redirect(302, originalUrl);
  } catch (err) {
    console.error('GET /api/:code error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT short_code, original_url, click_count, created_at FROM urls ORDER BY created_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/stats error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start
const start = async () => {
  await connect();
  await init();
  app.listen(5000, () => console.log('Backend running on port 5000'));
};

start();