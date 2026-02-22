const express = require('express');
const crypto  = require('crypto');
const db      = require('../db');
const { createLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const insertSecret = db.prepare(`
  INSERT INTO secrets (public_token, control_token, content, note, template, expires_at, burn_on_reveal)
  VALUES (@publicToken, @controlToken, @content, @note, @template, @expiresAt, @burnOnReveal)
`);

function obfuscate(text, key) {
  const keyBuf  = Buffer.from(key);
  const textBuf = Buffer.from(text, 'utf8');
  const out     = Buffer.alloc(textBuf.length);
  for (let i = 0; i < textBuf.length; i++) out[i] = textBuf[i] ^ keyBuf[i % keyBuf.length];
  return out.toString('base64');
}

function deobfuscate(b64, key) {
  const keyBuf  = Buffer.from(key);
  const dataBuf = Buffer.from(b64, 'base64');
  const out     = Buffer.alloc(dataBuf.length);
  for (let i = 0; i < dataBuf.length; i++) out[i] = dataBuf[i] ^ keyBuf[i % keyBuf.length];
  return out.toString('utf8');
}

router.post('/', createLimiter, (req, res) => {
  const { content, expiryDays, template, burnOnReveal, note } = req.body || {};

  if (!content || typeof content !== 'string' || content.trim().length === 0)
    return res.status(400).json({ error: 'content is required.' });
  if (content.length > 4096)
    return res.status(400).json({ error: 'content must be 4096 characters or fewer.' });

  const publicToken  = crypto.randomBytes(32).toString('base64url');
  const controlToken = crypto.randomBytes(32).toString('base64url');
  const obfuscated   = obfuscate(content.trim(), publicToken);

  const validTemplates = ['default', 'banking', 'crypto', 'invoice', 'corporate', 'docs'];
  const chosenTemplate = validTemplates.includes(template) ? template : 'default';

  const defaultExpiry = parseInt(process.env.DEFAULT_EXPIRY_DAYS || '30', 10);
  const days          = typeof expiryDays === 'number' ? expiryDays : defaultExpiry;
  const expiresAt     = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : null;

  const chosenNote = typeof note === 'string' ? note.trim().slice(0, 500) || null : null;

  insertSecret.run({
    publicToken, controlToken,
    content:      obfuscated,
    note:         chosenNote,
    template:     chosenTemplate,
    expiresAt,
    burnOnReveal: burnOnReveal ? 1 : 0,
  });

  const baseUrl = process.env.BASE_URL || '';
  return res.status(201).json({
    publicUrl:  `${baseUrl}/s/${publicToken}`,
    controlUrl: `${baseUrl}/s/${publicToken}/control`,
    expiresAt,
  });
});

module.exports = router;
module.exports.deobfuscate = deobfuscate;
