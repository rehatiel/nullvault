const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const max      = parseInt(process.env.RATE_LIMIT_MAX       || '20',    10);

const publicLimiter = rateLimit({
  windowMs, max,
  standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests.' }),
});

const createLimiter = rateLimit({
  windowMs: 60_000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests.' }),
});

module.exports = { publicLimiter, createLimiter };
