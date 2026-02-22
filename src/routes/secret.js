const express = require('express');
const db      = require('../db');
const { logAccess }     = require('../middleware/logger');
const { publicLimiter } = require('../middleware/rateLimit');
const { deobfuscate }   = require('./create');
const { fireWebhook }   = require('../webhook');

const router = express.Router();

const getSecret = db.prepare(`
  SELECT id, content, burned, expires_at, public_token, template, webhook_url, burn_on_reveal
  FROM secrets WHERE public_token = ?
`);

const getSecretForControl = db.prepare(`
  SELECT id, public_token, burned, burned_at, expires_at, created_at, burn_on_reveal, webhook_url
  FROM secrets WHERE public_token = ?
`);

const getLogs = db.prepare(`
  SELECT accessed_at, ip_address, location, org, user_agent, referer,
         request_path, reveal_attempted, reveal_succeeded
  FROM access_logs WHERE secret_id = ?
  ORDER BY accessed_at DESC LIMIT 500
`);

const updateWebhook = db.prepare(`
  UPDATE secrets SET webhook_url = @webhookUrl WHERE public_token = @token
`);

const burnSecret = db.prepare(`
  UPDATE secrets SET burned = 1, burned_at = unixepoch()
  WHERE public_token = ?
    AND burned = 0
    AND (expires_at IS NULL OR expires_at > unixepoch())
`);

// ── GET /s/:token/control ─────────────────────────────────────────────────
// MUST be registered before /:token
router.get('/:token/control', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).render('error.njk', { message: 'Control panel not found.' });

    const logs          = getLogs.all(secret.id);
    const baseUrl       = process.env.BASE_URL || '';
    const expired       = secret.expires_at && secret.expires_at < Math.floor(Date.now() / 1000);
    const retentionDays = parseInt(process.env.RETENTION_DAYS || '30', 10);

    // All stats calculated in JS — no Nunjucks filters needed
    const stats = {
      totalViews:      logs.length,
      revealAttempts:  logs.filter(l => l.reveal_attempted === 1).length,
      revealSuccesses: logs.filter(l => l.reveal_succeeded === 1).length,
      uniqueIPs:       new Set(logs.map(l => l.ip_address).filter(Boolean)).size,
    };

    // Deduplicate IPs in JS — no Nunjucks set/append needed
    const seenIPs = new Set();
    const uniqueIPLogs = logs.filter(l => {
      if (!l.ip_address || seenIPs.has(l.ip_address)) return false;
      seenIPs.add(l.ip_address);
      return true;
    });

    return res.render('control.njk', {
      secret, logs, stats, uniqueIPLogs,
      publicUrl:    `${baseUrl}/s/${secret.public_token}`,
      controlUrl:   `${baseUrl}/s/${secret.public_token}/control`,
      burned:       !!secret.burned,
      expired,
      retentionDays,
    });
  } catch (err) {
    console.error('[Control] Error:', err);
    return res.status(500).render('error.njk', { message: 'Control panel error: ' + err.message });
  }
});


// ── POST /s/:token/webhook ────────────────────────────────────────────────
router.post('/:token/webhook', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const { webhookUrl } = req.body || {};
    const chosen = typeof webhookUrl === 'string' && webhookUrl.startsWith('http')
      ? webhookUrl.slice(0, 512) : null;

    updateWebhook.run({ webhookUrl: chosen, token: req.params.token });
    return res.json({ ok: true, webhookUrl: chosen });
  } catch (err) {
    console.error('[Webhook Update] Error:', err);
    return res.status(500).json({ error: 'Failed to update webhook.' });
  }
});

// ── POST /s/:token/webhook/test ──────────────────────────────────────────
router.post('/:token/webhook/test', async (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });
    if (!secret.webhook_url) return res.status(400).json({ error: 'No webhook URL configured.' });

    const baseUrl = process.env.BASE_URL || '';
    await fireWebhook(secret.webhook_url, {
      revealed:  false,
      publicUrl: `${baseUrl}/s/${secret.public_token}`,
      ip:        '0.0.0.0',
      location:  'Test Ping',
      userAgent: 'NullVault/test',
      referer:   null,
      test:      true,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Webhook Test] Error:', err);
    return res.status(500).json({ error: 'Test failed.' });
  }
});

// ── GET /s/:token ─────────────────────────────────────────────────────────
router.get('/:token', publicLimiter, (req, res) => {
  const secret = getSecret.get(req.params.token);
  if (!secret) return res.render('secret.njk', { state: 'unavailable', content: null, template: 'default', token: '' });

  const expired   = secret.expires_at && secret.expires_at < Math.floor(Date.now() / 1000);
  const available = !secret.burned && !expired;

  logAccess(req, secret.id, false, false);
  return res.render('secret.njk', {
    state:    available ? 'available' : 'burned',
    content:  null,
    template: secret.template,
    token:    secret.public_token,
  });
});

// ── POST /s/:token/reveal ─────────────────────────────────────────────────
router.post('/:token/reveal', publicLimiter, (req, res) => {
  const secret = getSecret.get(req.params.token);
  if (!secret) return res.render('secret.njk', { state: 'unavailable', content: null, template: 'default', token: '' });

  const expired   = secret.expires_at && secret.expires_at < Math.floor(Date.now() / 1000);
  const available = !secret.burned && !expired;

  let succeeded = false;
  if (available) {
    if (secret.burn_on_reveal) {
      const result = burnSecret.run(req.params.token);
      succeeded = result.changes === 1;
    } else {
      succeeded = true; // content is readable, no burn
    }
  }

  const { ip, geo } = logAccess(req, secret.id, true, succeeded);
  const baseUrl   = process.env.BASE_URL || '';

  if (secret.webhook_url) {
    fireWebhook(secret.webhook_url, {
      revealed:  succeeded,
      publicUrl: `${baseUrl}/s/${secret.public_token}`,
      ip,
      location:  geo ? geo.display : null,
      userAgent: req.headers['user-agent'] || null,
      referer:   req.headers['referer']    || null,
    });
  }

  const content = succeeded ? deobfuscate(secret.content, secret.public_token) : null;
  return res.render('secret.njk', {
    state:    succeeded ? 'revealed' : 'burned',
    template: secret.template,
    token:    secret.public_token,
    content,
    burnsOnReveal: !!secret.burn_on_reveal,
  });
});

module.exports = router;
