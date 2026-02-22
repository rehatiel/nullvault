const geoip = require('geoip-lite');

function lookupIP(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  try {
    const geo = geoip.lookup(ip);
    if (!geo) return null;
    const parts = [geo.city, geo.region, geo.country].filter(Boolean);
    return {
      display:  parts.join(', ') || 'Unknown',
      city:     geo.city     || null,
      region:   geo.region   || null,
      country:  geo.country  || null,
      ll:       geo.ll       || null,
      org:      geo.org      || null,
      timezone: geo.timezone || null,
    };
  } catch {
    return null;
  }
}

module.exports = { lookupIP };
