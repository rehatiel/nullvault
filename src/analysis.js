/**
 * NullVault — Heuristic Analysis Module
 *
 * Operates exclusively on data already present in access_logs.
 * No new data is collected. No external requests are made.
 * All output is labelled as approximate / best-effort.
 *
 * IMPORTANT: Nothing produced here constitutes identity attribution,
 * physical location confirmation, or legal evidence of any kind.
 */

'use strict';

const RAPID_REVISIT_SECS  = 60;
const CLUSTER_WINDOW_SECS = 300;
const CLUSTER_THRESHOLD   = 3;

// ── Event classification ──────────────────────────────────────────────────────

function classifyEvent(log, index, allLogs, secret) {
  const labels = [];
  const ip = log.ip_address;
  const ua = log.user_agent || '';
  const ts = log.accessed_at;

  // Older entries sit later in the array (logs are newest-first)
  const priorSameIP = allLogs.slice(index + 1).filter(l => l.ip_address === ip);
  const anyOtherIP  = allLogs.slice(index + 1).some(l => l.ip_address && l.ip_address !== ip);

  if (priorSameIP.length === 0) {
    labels.push('first_visit');
    if (anyOtherIP) labels.push('repeat_visit_new_ip');
  } else {
    labels.push('repeat_visit_same_ip');
    const hasRapid = priorSameIP.some(l => Math.abs(ts - l.accessed_at) <= RAPID_REVISIT_SECS);
    if (hasRapid) labels.push('rapid_revisit');
  }

  if (secret.expires_at && ts > secret.expires_at) labels.push('expired_link_access');
  if (secret.burned_at  && ts > secret.burned_at)  labels.push('burned_link_access');
  if (ua && !/^Mozilla\//i.test(ua))                labels.push('non_browser_user_agent');

  return labels;
}

function classifyLogs(logs, secret) {
  logs.forEach((log, i) => { log._labels = classifyEvent(log, i, logs, secret); });
  return logs;
}

const LABEL_META = {
  first_visit:           { text: 'First visit',         color: 'green'  },
  repeat_visit_same_ip:  { text: 'Repeat — same IP',    color: 'yellow' },
  repeat_visit_new_ip:   { text: 'Repeat — new IP',     color: 'yellow' },
  rapid_revisit:         { text: 'Rapid revisit (<60s)',color: 'orange' },
  expired_link_access:   { text: 'Expired link',        color: 'red'    },
  burned_link_access:    { text: 'Burned link',         color: 'red'    },
  non_browser_user_agent:{ text: 'Non-browser agent',  color: 'purple' },
};

// ── Correlation hints ─────────────────────────────────────────────────────────

function buildCorrelationHints(logs) {
  const hints      = [];
  const ipToUAs    = new Map();
  const uaToIPs    = new Map();

  logs.forEach(log => {
    const ip = log.ip_address;
    const ua = log.user_agent;
    if (!ip || !ua) return;
    if (!ipToUAs.has(ip)) ipToUAs.set(ip, new Set());
    ipToUAs.get(ip).add(ua);
    if (!uaToIPs.has(ua)) uaToIPs.set(ua, new Set());
    uaToIPs.get(ua).add(ip);
  });

  ipToUAs.forEach((uas, _ip) => {
    if (uas.size > 1) {
      hints.push({
        type: 'multi_ua_same_ip',
        description:
          `An IP address was observed using ${uas.size} different User-Agent strings. ` +
          `This may indicate multiple browsers, browser updates, or different apps on the same device or network.`,
        severity: 'notice',
      });
    }
  });

  uaToIPs.forEach((ips, ua) => {
    if (ips.size > 1 && /^Mozilla\//i.test(ua)) {
      const short = ua.length > 55 ? ua.slice(0, 52) + '\u2026' : ua;
      hints.push({
        type: 'same_ua_multi_ip',
        description:
          `The User-Agent "${short}" appeared from ${ips.size} different IP addresses. ` +
          `This is a low-confidence observation — many devices share common User-Agent strings.`,
        severity: 'info',
      });
    }
  });

  const sorted = [...logs].sort((a, b) => a.accessed_at - b.accessed_at);
  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].accessed_at - sorted[i].accessed_at <= CLUSTER_WINDOW_SECS) count++;
      else break;
    }
    if (count >= CLUSTER_THRESHOLD) {
      const startTime = new Date(sorted[i].accessed_at * 1000).toISOString().slice(11, 19);
      hints.push({
        type: 'rapid_cluster',
        description:
          `${count} accesses occurred within a 5-minute window around ${startTime} UTC. ` +
          `This may reflect link-preview bots, automated tools, or multiple manual loads.`,
        severity: 'notice',
      });
      break;
    }
  }

  return hints;
}

// ── Network type inference ────────────────────────────────────────────────────

const HOSTING_RE = [
  /amazon/i,/\baws\b/i,/google\s+cloud/i,/microsoft\s+azure/i,/azure/i,
  /digital\s*ocean/i,/linode/i,/vultr/i,/\bovh\b/i,/hetzner/i,
  /cloudflare/i,/fastly/i,/rackspace/i,/leaseweb/i,/choopa/i,
  /quadranet/i,/data\s*center/i,/datacenter/i,/colocation/i,
  /\bhosting\b/i,/vserver/i,/dedicated\s+server/i,
];
const MOBILE_RE = [
  /t-mobile/i,/verizon\s+wireless/i,/at&t\s+mobility/i,/sprint/i,
  /cricket\s+wireless/i,/boost\s+mobile/i,/metro\s+pcs/i,
  /dish\s+wireless/i,/us\s+cellular/i,/c\s+spire/i,/\bcellular\b/i,
];

function inferNetworkType(org) {
  if (!org) return 'Unknown';
  if (HOSTING_RE.some(re => re.test(org))) return 'Hosting / data center';
  if (MOBILE_RE.some(re => re.test(org)))  return 'Mobile carrier';
  return 'Residential / ISP';
}

function annotateNetworkTypes(uniqueIPLogs) {
  uniqueIPLogs.forEach(log => { log._networkType = inferNetworkType(log.org || ''); });
  return uniqueIPLogs;
}

// ── Narrative summary ─────────────────────────────────────────────────────────

function buildNarrativeSummary(logs, secret, stats) {
  if (!logs.length) return 'No access events have been recorded for this link yet.';

  const sorted   = [...logs].sort((a, b) => a.accessed_at - b.accessed_at);
  const first    = sorted[0];
  const last     = sorted[sorted.length - 1];
  const spanSecs = last.accessed_at - first.accessed_at;

  const countries = new Set();
  logs.forEach(l => {
    if (!l.location) return;
    const code = l.location.split(',').pop().trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) countries.add(code);
  });

  const ipCounts = {};
  logs.forEach(l => { if (l.ip_address) ipCounts[l.ip_address] = (ipCounts[l.ip_address] || 0) + 1; });
  const repeatIPCount   = Object.values(ipCounts).filter(n => n > 1).length;
  const nonBrowserCount = logs.filter(l => l.user_agent && !/^Mozilla\//i.test(l.user_agent)).length;

  const lines = [];

  lines.push(
    `Between ${fmtDatetime(first.accessed_at)} and ${fmtDatetime(last.accessed_at)} UTC, ` +
    `this link recorded ${stats.totalViews} access event${stats.totalViews !== 1 ? 's' : ''} ` +
    `spanning ${formatDuration(spanSecs)}.`
  );

  lines.push(
    `${stats.uniqueIPs} distinct IP address${stats.uniqueIPs !== 1 ? 'es were' : ' was'} observed. ` +
    (countries.size > 0
      ? `Traffic appeared to originate from ${countries.size} countr${countries.size !== 1 ? 'ies' : 'y'} based on offline IP geolocation.`
      : 'No geolocation data was available for these requests.')
  );

  if (stats.revealSuccesses > 0) {
    lines.push(`The secret content was successfully revealed ${stats.revealSuccesses} time${stats.revealSuccesses !== 1 ? 's' : ''}.`);
  } else if (stats.revealAttempts > 0) {
    lines.push(
      `There ${stats.revealAttempts === 1 ? 'was' : 'were'} ${stats.revealAttempts} ` +
      `reveal attempt${stats.revealAttempts !== 1 ? 's' : ''}, none of which succeeded ` +
      `(the link was already burned or expired at the time).`
    );
  } else {
    lines.push('No reveal attempts were recorded — the link was viewed but the reveal button was not clicked.');
  }

  if (repeatIPCount > 0) {
    lines.push(
      `${repeatIPCount} IP address${repeatIPCount !== 1 ? 'es' : ''} ` +
      `accessed the link more than once, suggesting revisits, retries, or link-preview requests.`
    );
  }

  if (nonBrowserCount > 0) {
    lines.push(
      `${nonBrowserCount} request${nonBrowserCount !== 1 ? 's' : ''} used a non-browser User-Agent string, ` +
      `which may indicate automated tools, messaging app link previews, or scripted access.`
    );
  }

  lines.push(
    `Note: All observations are derived from server-side access logs and are subject to the ` +
    `inherent limitations of IP geolocation, shared IPs, NAT, and User-Agent spoofing. ` +
    `This data does not establish identity, physical location, or intent with certainty.`
  );

  return lines.join('\n\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(secs) {
  if (secs < 2)     return 'less than a second';
  if (secs < 60)    return `${secs} second${secs !== 1 ? 's' : ''}`;
  if (secs < 3600)  { const m = Math.round(secs / 60);   return `${m} minute${m !== 1 ? 's' : ''}`; }
  if (secs < 86400) { const h = Math.round(secs / 3600); return `${h} hour${h !== 1 ? 's' : ''}`; }
  const d = Math.round(secs / 86400); return `${d} day${d !== 1 ? 's' : ''}`;
}

function fmtDatetime(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function maskIP(ip) {
  if (!ip) return '\u2014';
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return v4[1] + '.xxx';
  const v6 = ip.split(':');
  if (v6.length >= 3) return v6.slice(0, 2).join(':') + ':xxxx\u2026';
  return ip.slice(0, 6) + '\u2026';
}

module.exports = {
  classifyLogs,
  buildCorrelationHints,
  annotateNetworkTypes,
  inferNetworkType,
  buildNarrativeSummary,
  maskIP,
  LABEL_META,
};
