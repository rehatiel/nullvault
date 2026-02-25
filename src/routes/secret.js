const express = require('express');
const db      = require('../db');
const { logAccess }     = require('../middleware/logger');
const { publicLimiter } = require('../middleware/rateLimit');
const { deobfuscate }   = require('./create');
const { fireWebhook }   = require('../webhook');
const { toSVG }         = require('../qr');
const {
  classifyLogs,
  buildCorrelationHints,
  annotateNetworkTypes,
  buildNarrativeSummary,
  LABEL_META,
} = require('../analysis');

const router = express.Router();

const getSecret = db.prepare(`
  SELECT id, content, burned, expires_at, public_token, template, webhook_url, burn_on_reveal, require_location
  FROM secrets WHERE public_token = ?
`);

const getSecretForControl = db.prepare(`
  SELECT id, public_token, burned, burned_at, expires_at, created_at, burn_on_reveal, require_location, webhook_url, note
  FROM secrets WHERE public_token = ?
`);

const getLogs = db.prepare(`
  SELECT accessed_at, ip_address, location, org, timezone,
         user_agent, accept_language, sec_ch_ua, sec_fetch_site,
         referer, request_path, reveal_attempted, reveal_succeeded, gps_lat, gps_lng
  FROM access_logs WHERE secret_id = ?
  ORDER BY accessed_at DESC LIMIT 500
`);

const updateWebhook = db.prepare(`
  UPDATE secrets SET webhook_url = @webhookUrl WHERE public_token = @token
`);

const updateNote = db.prepare(`
  UPDATE secrets SET note = @note WHERE public_token = @token
`);

const updateRequireLocation = db.prepare(`
  UPDATE secrets SET require_location = @requireLocation WHERE public_token = @token
`);

const insertBeacon = db.prepare(`
  INSERT INTO location_beacons (secret_id, gps_lat, gps_lng, accuracy, ip_address)
  VALUES (@secretId, @gpsLat, @gpsLng, @accuracy, @ip)
`);

const getBeacons = db.prepare(`
  SELECT beaconed_at, gps_lat, gps_lng, accuracy, ip_address
  FROM location_beacons WHERE secret_id = ?
  ORDER BY beaconed_at DESC LIMIT 500
`);

const burnSecret = db.prepare(`
  UPDATE secrets SET burned = 1, burned_at = unixepoch()
  WHERE public_token = ?
    AND burned = 0
    AND (expires_at IS NULL OR expires_at > unixepoch())
`);

const countLogs = db.prepare(`
  SELECT COUNT(*) AS n FROM access_logs WHERE secret_id = ?
`);

// ── GET /s/:token/qr ─────────────────────────────────────────────────────────
// Returns a self-contained SVG QR code for the public link.
router.get('/:token/qr', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url     = `${baseUrl}/s/${req.params.token}`;
    const svg     = await toSVG(url);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    console.error('[QR] Error:', err.message);
    res.status(500).send('QR generation failed');
  }
});

// ── POST /s/:token/burn ───────────────────────────────────────────────────────
// Manual "Burn Now" from the control panel — destroys the secret immediately.
router.post('/:token/burn', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });
    if (secret.burned) return res.json({ ok: true, alreadyBurned: true });

    const result = burnSecret.run(req.params.token);
    return res.json({ ok: true, burned: result.changes === 1 });
  } catch (err) {
    console.error('[Burn] Error:', err);
    return res.status(500).json({ error: 'Burn failed.' });
  }
});

// ── GET /s/:token/control ─────────────────────────────────────────────────
// MUST be registered before /:token
router.get('/:token/control', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).render('error.njk', { message: 'Control panel not found.' });

    const logs          = getLogs.all(secret.id);
    const beacons       = getBeacons.all(secret.id);
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

    // ── Heuristic analysis (additive, no new data collected) ───────────────
    classifyLogs(logs, secret);                   // adds ._labels to each log row
    annotateNetworkTypes(uniqueIPLogs);            // adds ._networkType to each unique IP
    const correlationHints = buildCorrelationHints(logs);
    const narrativeSummary = buildNarrativeSummary(logs, secret, stats);

    return res.render('control.njk', {
      secret, logs, beacons, stats, uniqueIPLogs,
      publicUrl:    `${baseUrl}/s/${secret.public_token}`,
      controlUrl:   `${baseUrl}/s/${secret.public_token}/control`,
      burned:       !!secret.burned,
      expired,
      retentionDays,
      note:         secret.note || null,
      requireLocation: !!secret.require_location,
      // Analysis data
      correlationHints,
      narrativeSummary,
      labelMeta:    LABEL_META,
      // Branding — control.njk is standalone so we pass these explicitly
      siteName:     process.env.SITE_NAME || 'NullVault',
      siteLogo:     process.env.SITE_LOGO || '🔒',
    });
  } catch (err) {
    console.error('[Control] Error:', err);
    return res.status(500).render('error.njk', { message: 'Control panel error: ' + err.message });
  }
});


// ── GET /s/:token/poll ───────────────────────────────────────────────────────
// Returns new log entries since a given timestamp, plus updated stats.
// Used by the control panel for live updates without a page reload.
router.get('/:token/poll', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const since = parseInt(req.query.since || '0', 10);

    const newLogs = db.prepare(`
      SELECT accessed_at, ip_address, location, org, timezone,
             user_agent, accept_language, sec_ch_ua, sec_fetch_site,
             referer, request_path, reveal_attempted, reveal_succeeded, gps_lat, gps_lng
      FROM access_logs WHERE secret_id = ? AND accessed_at > ?
      ORDER BY accessed_at DESC LIMIT 100
    `).all(secret.id, since);

    const allLogs = getLogs.all(secret.id);
    const stats = {
      totalViews:      allLogs.length,
      revealAttempts:  allLogs.filter(l => l.reveal_attempted === 1).length,
      revealSuccesses: allLogs.filter(l => l.reveal_succeeded === 1).length,
      uniqueIPs:       new Set(allLogs.map(l => l.ip_address).filter(Boolean)).size,
    };

    // Classify new logs using the same heuristic engine
    classifyLogs(newLogs, secret);

    return res.json({
      newLogs,
      stats,
      burned:  !!secret.burned,
      expired: !!(secret.expires_at && secret.expires_at < Math.floor(Date.now() / 1000)),
    });
  } catch (err) {
    console.error('[Poll] Error:', err);
    return res.status(500).json({ error: 'Poll failed.' });
  }
});

// ── GET /s/:token/beacon/poll ────────────────────────────────────────────────
// Returns new beacon entries since a given timestamp for live map updates.
router.get('/:token/beacon/poll', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const since = parseInt(req.query.since || '0', 10);
    const newBeacons = db.prepare(`
      SELECT beaconed_at, gps_lat, gps_lng, accuracy, ip_address
      FROM location_beacons WHERE secret_id = ? AND beaconed_at > ?
      ORDER BY beaconed_at ASC LIMIT 100
    `).all(secret.id, since);

    return res.json({ newBeacons });
  } catch (err) {
    console.error('[Beacon Poll] Error:', err);
    return res.status(500).json({ error: 'Beacon poll failed.' });
  }
});

// ── POST /s/:token/note ──────────────────────────────────────────────────────
router.post('/:token/note', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const raw  = req.body?.note;
    const note = typeof raw === 'string' ? raw.trim().slice(0, 500) || null : null;
    updateNote.run({ note, token: req.params.token });
    return res.json({ ok: true, note });
  } catch (err) {
    console.error('[Note] Error:', err);
    return res.status(500).json({ error: 'Failed to update note.' });
  }
});

// ── POST /s/:token/require-location ─────────────────────────────────────────
router.post('/:token/require-location', (req, res) => {
  try {
    const secret = getSecretForControl.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const enabled = req.body?.enabled === true ? 1 : 0;
    updateRequireLocation.run({ requireLocation: enabled, token: req.params.token });
    return res.json({ ok: true, requireLocation: !!enabled });
  } catch (err) {
    console.error('[RequireLocation] Error:', err);
    return res.status(500).json({ error: 'Failed to update setting.' });
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
      userAgent: `${process.env.SITE_NAME || 'NullVault'}/test`,
      referer:   null,
      test:      true,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Webhook Test] Error:', err);
    return res.status(500).json({ error: 'Test failed.' });
  }
});

// ── POST /s/:token/beacon ────────────────────────────────────────────────────
// Accepts periodic GPS pings from the revealed page — no page reload needed.
router.post('/:token/beacon', publicLimiter, (req, res) => {
  try {
    const secret = getSecret.get(req.params.token);
    if (!secret) return res.status(404).json({ error: 'Not found.' });

    const { lat, lng, accuracy } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number')
      return res.status(400).json({ error: 'lat and lng required.' });

    const ip = require('../middleware/logger').extractIP(req);

    insertBeacon.run({
      secretId: secret.id,
      gpsLat:   lat,
      gpsLng:   lng,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      ip,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Beacon] Error:', err);
    return res.status(500).json({ error: 'Beacon failed.' });
  }
});

// ── GET /s/:token ─────────────────────────────────────────────────────────
router.get('/:token', publicLimiter, (req, res) => {
  const secret = getSecret.get(req.params.token);
  if (!secret) return res.render('secret.njk', { state: 'unavailable', content: null, template: 'default', token: '', expiresAt: null });

  const expired   = secret.expires_at && secret.expires_at < Math.floor(Date.now() / 1000);
  const available = !secret.burned && !expired;

  // Log the visit first, then check if this was the first ever access
  const { ip, geo } = logAccess(req, secret.id, false, false);
  const baseUrl = process.env.BASE_URL || '';

  // Fire first-access webhook if this is the very first log entry for this secret
  if (secret.webhook_url && available) {
    const { n } = countLogs.get(secret.id);
    if (n === 1) {
      // n===1 means we just inserted the first log row above
      fireWebhook(secret.webhook_url, {
        event:     'first_access',
        revealed:  false,
        publicUrl: `${baseUrl}/s/${secret.public_token}`,
        ip,
        location:  geo ? geo.display : null,
        userAgent: req.headers['user-agent'] || null,
        referer:   req.headers['referer']    || null,
      });
    }
  }

  return res.render('secret.njk', {
    state:     available ? 'available' : 'burned',
    content:   null,
    template:  secret.template,
    token:     secret.public_token,
    expiresAt: secret.expires_at || null,
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

  // Extract GPS coords if provided by browser Geolocation API
  const rawLat = req.body?.gps_lat;
  const rawLng = req.body?.gps_lng;
  const gpsCoords = (typeof rawLat === 'number' && typeof rawLng === 'number')
    ? { lat: rawLat, lng: rawLng } : null;

  // Enforce location requirement — log the attempt regardless
  const { ip, geo } = logAccess(req, secret.id, true, succeeded && (!secret.require_location || !!gpsCoords), gpsCoords);

  if (secret.require_location && !gpsCoords && available) {
    return res.render('secret.njk', {
      state:    'location_required',
      template: secret.template,
      token:    secret.public_token,
      content:  null,
      expiresAt: secret.expires_at || null,
    });
  }
  const baseUrl   = process.env.BASE_URL || '';

  if (secret.webhook_url) {
    fireWebhook(secret.webhook_url, {
      revealed:  succeeded,
      publicUrl: `${baseUrl}/s/${secret.public_token}`,
      ip,
      location:  geo ? geo.display : null,
      gpsLat:    gpsCoords ? gpsCoords.lat : null,
      gpsLng:    gpsCoords ? gpsCoords.lng : null,
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
