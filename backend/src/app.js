const express = require('express');
const { nanoid } = require('nanoid');
const rateLimit = require('express-rate-limit');
const { pool, init } = require('./db');
const { client: redis, connect } = require('./cache');
require('dotenv').config();

const app = express();
app.use(express.json());

// ─── CORS ────────────────────────────────────────────────────────────────────
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

// ─── RATE LIMITER ────────────────────────────────────────────────────────────
// 50 requests per 3 seconds per IP
const limiter = rateLimit({
  windowMs: 3000,          // 3 seconds
  max: 50,                 // max 50 requests in that window
  standardHeaders: true,   // sends RateLimit-* headers back to client
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Slow down — you are not that important.',
    retryAfter: '3 seconds',
  },
});

app.use(limiter);          // applies to ALL routes

// ─── URL VALIDATOR ───────────────────────────────────────────────────────────
const validateUrl = (url) => {
  // Must be a non-empty string
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL must be a non-empty string.' };
  }

  // Trim whitespace
  const trimmed = url.trim();

  // Reject obviously garbage input (too short to be a real URL)
  if (trimmed.length < 11) {
    return { valid: false, reason: 'That is not a real URL.' };
  }

  // Reject absurdly long input (prevent DB abuse)
  if (trimmed.length > 2048) {
    return { valid: false, reason: 'URL exceeds maximum allowed length (2048 chars).' };
  }

  // Must start with http:// or https:// — no ftp, javascript:, data:, etc.
  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, reason: 'URL must start with http:// or https://' };
  }

  // Use the built-in URL parser — if it throws, it's garbage
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  // Must have a real hostname (not just "http://")
  if (!parsed.hostname || parsed.hostname.length < 3) {
    return { valid: false, reason: 'URL is missing a valid hostname.' };
  }

  // Block localhost and private IPs — you are not shortening your own router
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (blockedHosts.includes(parsed.hostname)) {
    return { valid: false, reason: 'Shortening local/private URLs is not allowed.' };
  }

  // Block private IP ranges (basic check)
  const privateIpPattern = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
  if (privateIpPattern.test(parsed.hostname)) {
    return { valid: false, reason: 'Shortening private network URLs is not allowed.' };
  }

  // Hostname must have at least one dot (e.g. "google.com" not "google")
  if (!parsed.hostname.includes('.')) {
    return { valid: false, reason: 'URL must have a valid domain (e.g. example.com).' };
  }

  return { valid: true, url: trimmed };
};

// ─── POST /shorten ───────────────────────────────────────────────────────────
app.post('/shorten', async (req, res) => {
  const { originalUrl } = req.body;

  // Validate
  const validation = validateUrl(originalUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason });
  }

  const cleanUrl = validation.url;

  try {
    // ── Duplicate check: if this exact URL was already shortened, return existing one ──
    const existing = await pool.query(
      'SELECT short_code FROM urls WHERE original_url = $1',
      [cleanUrl]
    );

    if (existing.rows.length > 0) {
      const existingCode = existing.rows[0].short_code;
      return res.json({
        shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/${existingCode}`,
        shortCode: existingCode,
        duplicate: true,   // tells frontend this was already shortened before
      });
    }

    // ── New URL — generate a unique short code ──
    let shortCode;
    let attempts = 0;

    // Collision loop — nanoid is very unlikely to collide but handle it gracefully
    while (attempts < 5) {
      shortCode = nanoid(6);
      const collision = await pool.query(
        'SELECT 1 FROM urls WHERE short_code = $1',
        [shortCode]
      );
      if (collision.rows.length === 0) break;  // unique, we're good
      attempts++;
    }

    if (attempts === 5) {
      return res.status(500).json({ error: 'Could not generate a unique code. Try again.' });
    }

    // Save to Postgres
    await pool.query(
      'INSERT INTO urls (short_code, original_url) VALUES ($1, $2)',
      [shortCode, cleanUrl]
    );

    // Pre-warm Redis cache
    await redis.set(shortCode, cleanUrl, { EX: 3600 });

    return res.status(201).json({
      shortUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/${shortCode}`,
      shortCode,
      duplicate: false,
    });

  } catch (err) {
    console.error('POST /shorten error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /:code — redirect ───────────────────────────────────────────────────
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  // Sanity check — short codes are exactly 6 alphanumeric chars
  if (!/^[A-Za-z0-9_-]{4,10}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid short code format.' });
  }

  try {
    // Check Redis first
    const cached = await redis.get(code);
    if (cached) {
      await pool.query(
        'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
        [code]
      );
      return res.redirect(302, cached);
    }

    // Cache miss — hit Postgres
    const result = await pool.query(
      'SELECT original_url FROM urls WHERE short_code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }

    const originalUrl = result.rows[0].original_url;

    // Repopulate cache
    await redis.set(code, originalUrl, { EX: 3600 });

    await pool.query(
      'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
      [code]
    );

    return res.redirect(302, originalUrl);

  } catch (err) {
    console.error('GET /:code error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/stats ──────────────────────────────────────────────────────────
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

// ─── START ───────────────────────────────────────────────────────────────────
const start = async () => {
  await connect();
  await init();
  app.listen(5000, () => console.log('Backend running on port 5000'));
};

start();
