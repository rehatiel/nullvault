const db           = require('../db');
const { lookupIP } = require('../geo');

const MAX_UA_LEN  = 512;
const MAX_REF_LEN = 512;
const MAX_IP_LEN  = 45;

function extractIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.trim().slice(0, MAX_IP_LEN);
  return (req.ip || '').slice(0, MAX_IP_LEN);
}

const stmt = db.prepare(`
  INSERT INTO access_logs
    (secret_id, ip_address, location, org, user_agent, referer, request_path, reveal_attempted, reveal_succeeded)
  VALUES
    (@secretId, @ip, @location, @org, @ua, @referer, @path, @attempted, @succeeded)
`);

function logAccess(req, secretId, revealAttempted = false, revealSucceeded = false) {
  const ip  = extractIP(req);
  const geo = lookupIP(ip);
  stmt.run({
    secretId,
    ip,
    location:  geo ? geo.display : null,
    org:       geo ? geo.org     : null,
    ua:        (req.headers['user-agent'] || '').slice(0, MAX_UA_LEN),
    referer:   (req.headers['referer'] || req.headers['referrer'] || '').slice(0, MAX_REF_LEN),
    path:      (req.path || '').slice(0, 512),
    attempted: revealAttempted ? 1 : 0,
    succeeded: revealSucceeded ? 1 : 0,
  });
  return { ip, geo };
}

module.exports = { logAccess, extractIP };
