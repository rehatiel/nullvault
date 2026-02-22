const db           = require('../db');
const { lookupIP } = require('../geo');

const MAX_UA_LEN   = 512;
const MAX_REF_LEN  = 512;
const MAX_IP_LEN   = 45;
const MAX_LANG_LEN = 128;
const MAX_CH_LEN   = 256;
const MAX_FETCH_LEN = 32;

function extractIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.trim().slice(0, MAX_IP_LEN);
  return (req.ip || '').slice(0, MAX_IP_LEN);
}

const stmt = db.prepare(`
  INSERT INTO access_logs
    (secret_id, ip_address, location, org, timezone,
     user_agent, accept_language, sec_ch_ua, sec_fetch_site,
     referer, request_path, reveal_attempted, reveal_succeeded)
  VALUES
    (@secretId, @ip, @location, @org, @timezone,
     @ua, @acceptLanguage, @secChUa, @secFetchSite,
     @referer, @path, @attempted, @succeeded)
`);

function logAccess(req, secretId, revealAttempted = false, revealSucceeded = false) {
  const ip  = extractIP(req);
  const geo = lookupIP(ip);

  stmt.run({
    secretId,
    ip,
    location:      geo ? geo.display  : null,
    org:           geo ? geo.org      : null,
    timezone:      geo ? geo.timezone : null,
    ua:            (req.headers['user-agent']    || '').slice(0, MAX_UA_LEN),
    acceptLanguage:(req.headers['accept-language']|| '').slice(0, MAX_LANG_LEN) || null,
    // Sec-CH-UA: "Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"
    secChUa:       (req.headers['sec-ch-ua']     || '').slice(0, MAX_CH_LEN)   || null,
    // Sec-Fetch-Site: none | same-origin | same-site | cross-site
    secFetchSite:  (req.headers['sec-fetch-site']|| '').slice(0, MAX_FETCH_LEN)|| null,
    referer:       (req.headers['referer'] || req.headers['referrer'] || '').slice(0, MAX_REF_LEN) || null,
    path:          (req.path || '').slice(0, 512),
    attempted:     revealAttempted ? 1 : 0,
    succeeded:     revealSucceeded ? 1 : 0,
  });
  return { ip, geo };
}

module.exports = { logAccess, extractIP };
