// ── Tab navigation ──────────────────────────────────────────────────────────
const tabs = ['overview','timeline','devices','ips','analysis','logs','settings'];

tabs.forEach(name => {
  const btn = document.getElementById('nav-' + name);
  if (btn) btn.addEventListener('click', () => showTab(name));
});

function showTab(name) {
  tabs.forEach(t => {
    document.getElementById('tab-' + t).classList.remove('active');
    document.getElementById('nav-' + t).classList.remove('active');
  });
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  if (name === 'devices')  buildDeviceCharts();
  if (name === 'overview') buildOverview();
  if (name === 'settings') initSettings();
}

// ── IP masking ───────────────────────────────────────────────────────────────
// Display-only: masks/reveals IP addresses across the whole page.
// Stored data is never altered.

let ipsMasked = true; // default: masked

function maskIPDisplay(ip) {
  if (!ip) return '—';
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return v4[1] + '.xxx';
  const v6 = ip.split(':');
  if (v6.length >= 3) return v6.slice(0, 2).join(':') + ':xxxx…';
  return ip.slice(0, 6) + '…';
}

function applyIPMask() {
  document.querySelectorAll('.cp-ip-val').forEach(el => {
    const raw = el.dataset.ip || '';
    el.textContent = (raw && ipsMasked) ? maskIPDisplay(raw) : (raw || '—');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply initial mask state
  applyIPMask();

  const maskBtn   = document.getElementById('maskIpsBtn');
  const revealBtn = document.getElementById('revealIpsBtn');

  if (maskBtn) maskBtn.addEventListener('click', () => {
    ipsMasked = true;
    maskBtn.classList.add('cp-ip-mask-btn-active');
    revealBtn.classList.remove('cp-ip-mask-btn-active');
    applyIPMask();
  });

  if (revealBtn) revealBtn.addEventListener('click', () => {
    ipsMasked = false;
    revealBtn.classList.add('cp-ip-mask-btn-active');
    maskBtn.classList.remove('cp-ip-mask-btn-active');
    applyIPMask();
  });

  // Narrative copy button
  const copyNarrBtn = document.getElementById('copyNarrativeBtn');
  if (copyNarrBtn) {
    copyNarrBtn.addEventListener('click', () => {
      const text = document.getElementById('narrativeText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        copyNarrBtn.textContent = 'Copied!';
        setTimeout(() => { copyNarrBtn.textContent = 'Copy'; }, 2000);
      });
    });
  }

  // Print / save report button
  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // Copy URL button
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('pubUrl').innerText).then(() => {
        copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => copyUrlBtn.textContent = 'Copy Link', 2000);
      });
    });
  }

  // Build overview on initial load if active
  if (document.getElementById('tab-overview')?.classList.contains('active')) {
    buildOverview();
  }
});



// ── Raw log data ────────────────────────────────────────────────────────────
const rawLogs = JSON.parse(document.body.dataset.uaList || '[]');
const rawUAs  = rawLogs.map(l => l && l.user_agent).filter(Boolean);

// ── UA parsing ──────────────────────────────────────────────────────────────
function parseUA(ua) {
  const browsers = [
    {name:'Chrome',  re:/Chrome\/[\d.]+ (?!.*Edg|.*OPR|.*SamsungBrowser)/},
    {name:'Firefox', re:/Firefox\//},
    {name:'Edge',    re:/Edg\//},
    {name:'Safari',  re:/Safari\//},
    {name:'Opera',   re:/OPR\//},
    {name:'Samsung', re:/SamsungBrowser\//},
  ];
  const platforms = [
    {name:'Windows', re:/Windows/},
    {name:'macOS',   re:/Mac OS X/},
    {name:'iOS',     re:/iPhone|iPad/},
    {name:'Android', re:/Android/},
    {name:'Linux',   re:/Linux/},
  ];
  return {
    browser:  (browsers.find(b  => b.re.test(ua))  || {name:'Other'}).name,
    platform: (platforms.find(p => p.re.test(ua)) || {name:'Unknown'}).name,
  };
}

// ── Render a bar list using SVG rects (no inline styles) ────────────────────
function renderBarList(elId, entries, colorClass) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!entries.length) { el.innerHTML = '<div class="ua-hint">No data.</div>'; return; }
  const total = entries.reduce((s,[,v]) => s + v, 0);
  el.innerHTML = entries.map(([name, count]) => {
    const pct = Math.round(count / total * 100);
    // SVG bar: width is a presentation attribute, not a style — CSP safe
    return `<div class="cp-device-row">
      <span class="cp-device-label">${name}</span>
      <div class="cp-device-bar-wrap">
        <svg class="cp-bar-svg" height="8" width="100%" xmlns="http://www.w3.org/2000/svg">
          <rect class="cp-bar-track"  x="0" y="0" width="100%" height="8" rx="3"/>
          <rect class="cp-bar-fill ${colorClass || 'cp-bar-blue'}" x="0" y="0" width="${pct}%" height="8" rx="3"/>
        </svg>
      </div>
      <span class="cp-device-count">${count}</span>
    </div>`;
  }).join('');
}

// ── Device charts (Devices tab) ─────────────────────────────────────────────
function buildDeviceCharts() {
  const bCount = {}, pCount = {};
  rawUAs.forEach(ua => {
    const {browser, platform} = parseUA(ua);
    bCount[browser]  = (bCount[browser]  || 0) + 1;
    pCount[platform] = (pCount[platform] || 0) + 1;
  });
  renderBarList('browserList',  Object.entries(bCount).sort((a,b) => b[1]-a[1]), 'cp-bar-blue');
  renderBarList('platformList', Object.entries(pCount).sort((a,b) => b[1]-a[1]), 'cp-bar-blue');
}

// ── Overview tab ────────────────────────────────────────────────────────────
let overviewBuilt = false;
let activityChartInst = null;
let eventChartInst = null;

function buildOverview() {
  if (!rawLogs.length) return;
  buildActivityChart();
  buildEventChart();
  buildLocationList();
  buildWorldMap();
  buildUSMap();
  overviewBuilt = true;
}

function buildActivityChart() {
  const canvas = document.getElementById('activityChart');
  if (!canvas) return;
  if (activityChartInst) { activityChartInst.destroy(); activityChartInst = null; }

  // Three separate day-keyed counters
  const viewCounts    = {};
  const attemptCounts = {};
  const revealCounts  = {};

  rawLogs.forEach(log => {
    if (!log.accessed_at) return;
    const key = new Date(log.accessed_at * 1000).toISOString().slice(0, 10);
    if (log.reveal_succeeded) {
      revealCounts[key]  = (revealCounts[key]  || 0) + 1;
    } else if (log.reveal_attempted) {
      attemptCounts[key] = (attemptCounts[key] || 0) + 1;
    } else {
      viewCounts[key]    = (viewCounts[key]    || 0) + 1;
    }
  });

  // Build a continuous date range across all event types
  const allKeys = new Set([
    ...Object.keys(viewCounts),
    ...Object.keys(attemptCounts),
    ...Object.keys(revealCounts),
  ]);
  if (!allKeys.size) return;

  const sorted = [...allKeys].sort();
  const allDays = [];
  const cur = new Date(sorted[0]);
  const end = new Date(sorted[sorted.length - 1]);
  while (cur <= end) {
    allDays.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  activityChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: allDays,
      datasets: [
        {
          label: 'Views',
          data:  allDays.map(d => viewCounts[d]    || 0),
          backgroundColor: 'rgba(88,166,255,0.6)',
          borderColor:     '#58a6ff',
          borderWidth: 1,
          borderRadius: 2,
        },
        {
          label: 'Failed Attempts',
          data:  allDays.map(d => attemptCounts[d] || 0),
          backgroundColor: 'rgba(210,153,34,0.7)',
          borderColor:     '#d29922',
          borderWidth: 1,
          borderRadius: 2,
        },
        {
          label: 'Reveals',
          data:  allDays.map(d => revealCounts[d]  || 0),
          backgroundColor: 'rgba(248,81,73,0.75)',
          borderColor:     '#f85149',
          borderWidth: 1,
          borderRadius: 2,
        },
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#8b949e', padding: 16, font: { size: 11 }, boxWidth: 12 },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#8b949e', maxTicksLimit: 10 },
          grid:  { color: '#21262d' },
        },
        y: {
          stacked: true,
          ticks: { color: '#8b949e', stepSize: 1 },
          grid:  { color: '#21262d' },
          beginAtZero: true,
        },
      },
    }
  });
}

function buildEventChart() {
  const canvas = document.getElementById('eventChart');
  if (!canvas) return;
  if (eventChartInst) { eventChartInst.destroy(); eventChartInst = null; }

  const views    = rawLogs.filter(l => !l.reveal_attempted).length;
  const attempts = rawLogs.filter(l => l.reveal_attempted && !l.reveal_succeeded).length;
  const reveals  = rawLogs.filter(l => l.reveal_succeeded).length;

  eventChartInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Views', 'Failed Attempts', 'Reveals'],
      datasets: [{
        data: [views, attempts, reveals],
        backgroundColor: ['#58a6ff', '#d29922', '#f85149'],
        borderColor: '#161b22',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b949e', padding: 12, font: { size: 12 } } }
      }
    }
  });
}

function buildLocationList() {
  const el = document.getElementById('locationList');
  if (!el) return;

  // geoip-lite gives "City, ST, CC" or "City, CC" — resolve to full name for display
  const locCounts = {};
  rawLogs.forEach(log => {
    if (!log.location) return;
    const name = resolveCountryName(log.location);
    locCounts[name] = (locCounts[name] || 0) + 1;
  });

  const entries = Object.entries(locCounts).sort((a,b) => b[1]-a[1]).slice(0, 8);
  renderBarList('locationList', entries, 'cp-bar-green');
}

// ── Country resolution ──────────────────────────────────────────────────────
// geoip-lite formats: "City, Region, CC"  or  "City, CC"
// The last segment is always the ISO 3166-1 alpha-2 code.

const ISO2 = {
  AF:{n:4,  f:"Afghanistan"},   AL:{n:8,  f:"Albania"},      DZ:{n:12, f:"Algeria"},
  AO:{n:24, f:"Angola"},        AR:{n:32, f:"Argentina"},    AU:{n:36, f:"Australia"},
  AT:{n:40, f:"Austria"},       BD:{n:50, f:"Bangladesh"},   BE:{n:56, f:"Belgium"},
  BO:{n:68, f:"Bolivia"},       BR:{n:76, f:"Brazil"},       BG:{n:100,f:"Bulgaria"},
  KH:{n:116,f:"Cambodia"},      CM:{n:120,f:"Cameroon"},     CA:{n:124,f:"Canada"},
  CL:{n:152,f:"Chile"},         CN:{n:156,f:"China"},        CO:{n:170,f:"Colombia"},
  CR:{n:188,f:"Costa Rica"},    HR:{n:191,f:"Croatia"},      CU:{n:192,f:"Cuba"},
  CY:{n:196,f:"Cyprus"},        CZ:{n:203,f:"Czech Republic"},DK:{n:208,f:"Denmark"},
  DO:{n:214,f:"Dominican Republic"},EC:{n:218,f:"Ecuador"}, EG:{n:818,f:"Egypt"},
  SV:{n:222,f:"El Salvador"},   ET:{n:231,f:"Ethiopia"},     FI:{n:246,f:"Finland"},
  FR:{n:250,f:"France"},        DE:{n:276,f:"Germany"},      GH:{n:288,f:"Ghana"},
  GR:{n:300,f:"Greece"},        GT:{n:320,f:"Guatemala"},    HT:{n:332,f:"Haiti"},
  HN:{n:340,f:"Honduras"},      HU:{n:348,f:"Hungary"},      IN:{n:356,f:"India"},
  ID:{n:360,f:"Indonesia"},     IR:{n:364,f:"Iran"},         IQ:{n:368,f:"Iraq"},
  IE:{n:372,f:"Ireland"},       IL:{n:376,f:"Israel"},       IT:{n:380,f:"Italy"},
  JM:{n:388,f:"Jamaica"},       JP:{n:392,f:"Japan"},        JO:{n:400,f:"Jordan"},
  KZ:{n:398,f:"Kazakhstan"},    KE:{n:404,f:"Kenya"},        KR:{n:410,f:"South Korea"},
  KW:{n:414,f:"Kuwait"},        LA:{n:418,f:"Laos"},         LB:{n:422,f:"Lebanon"},
  LY:{n:434,f:"Libya"},         LT:{n:440,f:"Lithuania"},    LU:{n:442,f:"Luxembourg"},
  MY:{n:458,f:"Malaysia"},      MX:{n:484,f:"Mexico"},       MA:{n:504,f:"Morocco"},
  MZ:{n:508,f:"Mozambique"},    MM:{n:104,f:"Myanmar"},      NP:{n:524,f:"Nepal"},
  NL:{n:528,f:"Netherlands"},   NZ:{n:554,f:"New Zealand"},  NI:{n:558,f:"Nicaragua"},
  NG:{n:566,f:"Nigeria"},       NO:{n:578,f:"Norway"},       PK:{n:586,f:"Pakistan"},
  PA:{n:591,f:"Panama"},        PG:{n:598,f:"Papua New Guinea"},PE:{n:604,f:"Peru"},
  PH:{n:608,f:"Philippines"},   PL:{n:616,f:"Poland"},       PT:{n:620,f:"Portugal"},
  RO:{n:642,f:"Romania"},       RU:{n:643,f:"Russia"},       SA:{n:682,f:"Saudi Arabia"},
  SN:{n:686,f:"Senegal"},       SL:{n:694,f:"Sierra Leone"}, SK:{n:703,f:"Slovakia"},
  SO:{n:706,f:"Somalia"},       ZA:{n:710,f:"South Africa"}, ES:{n:724,f:"Spain"},
  LK:{n:144,f:"Sri Lanka"},     SD:{n:729,f:"Sudan"},        SE:{n:752,f:"Sweden"},
  CH:{n:756,f:"Switzerland"},   SY:{n:760,f:"Syria"},        TW:{n:158,f:"Taiwan"},
  TJ:{n:762,f:"Tajikistan"},    TH:{n:764,f:"Thailand"},     TR:{n:792,f:"Turkey"},
  UG:{n:800,f:"Uganda"},        UA:{n:804,f:"Ukraine"},      AE:{n:784,f:"United Arab Emirates"},
  GB:{n:826,f:"United Kingdom"},US:{n:840,f:"United States"},UY:{n:858,f:"Uruguay"},
  UZ:{n:860,f:"Uzbekistan"},    VE:{n:862,f:"Venezuela"},    VN:{n:704,f:"Vietnam"},
  YE:{n:887,f:"Yemen"},         ZM:{n:894,f:"Zambia"},       ZW:{n:716,f:"Zimbabwe"},
};

// Returns full country name from a geoip location string ("City, Region, CC" or "City, CC")
function resolveCountryName(location) {
  const code = location.split(',').pop().trim().toUpperCase();
  return (ISO2[code] && ISO2[code].f) || code;
}

// Returns SVG numeric ID for a full country name
function countryNumericId(fullName) {
  for (const v of Object.values(ISO2)) {
    if (v.f === fullName) return v.n;
  }
  return null;
}

function buildWorldMap() {
  const mapWrap = document.getElementById('worldMap');
  if (!mapWrap) return;
  mapWrap.innerHTML = '<div class="cp-map-empty">Loading map…</div>';
  fetch('/world-map.svg')
    .then(r => r.text())
    .then(svgText => renderMap(mapWrap, svgText))
    .catch(() => {
      mapWrap.innerHTML = '<div class="cp-map-empty">Map unavailable.</div>';
    });
}

function renderMap(mapWrap, svgText) {
  // Build full-name -> count using the same resolver
  const countryCounts = {};
  rawLogs.forEach(log => {
    if (!log.location) return;
    const name = resolveCountryName(log.location);
    countryCounts[name] = (countryCounts[name] || 0) + 1;
  });

  // Parse the SVG and inject it into the DOM
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) { mapWrap.innerHTML = '<div class="cp-map-empty">Map parse error.</div>'; return; }

  // Style matched countries and add <title> tooltips — all via DOM attributes, no inline styles
  const hitIds = new Set();
  for (const [name, count] of Object.entries(countryCounts)) {
    const numId = countryNumericId(name);
    if (!numId) continue;
    const path = svg.querySelector(`[data-id="${numId}"]`);
    if (!path) continue;
    path.classList.add('cp-map-country--hit');
    path.setAttribute('data-count', count);
    // <title> gives a native browser tooltip — zero JS, zero style
    const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${name}: ${count} access${count !== 1 ? 'es' : ''}`;
    path.prepend(title);
    hitIds.add(numId);
  }

  mapWrap.innerHTML = '';
  mapWrap.appendChild(svg);

  // Legend
  if (hitIds.size > 0) {
    const legend = document.createElement('div');
    legend.className = 'cp-map-legend';
    legend.textContent = `${hitIds.size} countr${hitIds.size !== 1 ? 'ies' : 'y'} detected — hover a highlighted country for details`;
    mapWrap.appendChild(legend);
  } else {
    const empty = document.createElement('div');
    empty.className = 'cp-map-legend';
    empty.textContent = 'No geolocation data yet — access the link to populate the map';
    mapWrap.appendChild(empty);
  }
}


// ── Settings tab ────────────────────────────────────────────────────────────
// Extract the public token from the current URL: /s/<token>/control
function getPublicToken() {
  const parts = window.location.pathname.split('/');
  // pathname is /s/<token>/control
  return parts[2] || '';
}

let settingsInitialized = false;
function initSettings() {
  if (settingsInitialized) return;
  settingsInitialized = true;

  const saveBtn  = document.getElementById('saveWebhookBtn');
  const clearBtn = document.getElementById('clearWebhookBtn');
  const testBtn  = document.getElementById('testWebhookBtn');
  const burnBtn  = document.getElementById('burnNowBtn');
  const input    = document.getElementById('webhookUrlInput');
  const status   = document.getElementById('webhookStatus');

  function setStatus(msg, ok) {
    status.textContent = msg;
    status.className = 'cp-settings-status ' + (ok ? 'cp-settings-status-ok' : 'cp-settings-status-err');
    setTimeout(() => { status.textContent = ''; status.className = 'cp-settings-status'; }, 4000);
  }

  async function saveWebhook(url) {
    const token = getPublicToken();
    const res = await fetch(`/s/${token}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: url || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    return data;
  }

  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (url && !url.startsWith('http')) { setStatus('URL must start with http:// or https://', false); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await saveWebhook(url);
      setStatus(url ? 'Webhook saved.' : 'Webhook cleared.', true);
    } catch (e) {
      setStatus(e.message, false);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Webhook';
    }
  });

  if (clearBtn) clearBtn.addEventListener('click', async () => {
    input.value = '';
    clearBtn.disabled = true;
    try {
      await saveWebhook(null);
      setStatus('Webhook cleared.', true);
    } catch (e) {
      setStatus(e.message, false);
    } finally {
      clearBtn.disabled = false;
    }
  });

  if (testBtn) testBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) { setStatus('Enter a webhook URL first.', false); return; }
    const token = getPublicToken();
    testBtn.disabled = true;
    testBtn.textContent = 'Sending…';
    try {
      await saveWebhook(url);
      const res = await fetch(`/s/${token}/webhook/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');
      setStatus('Test ping sent!', true);
    } catch (e) {
      setStatus(e.message, false);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Send Test Ping';
    }
  });

  // ── Note / label ─────────────────────────────────────────────────────────
  const saveNoteBtn  = document.getElementById('saveNoteBtn');
  const clearNoteBtn = document.getElementById('clearNoteBtn');
  const noteInput    = document.getElementById('noteInput');
  const noteStatus   = document.getElementById('noteStatus');

  function setNoteStatus(msg, ok) {
    noteStatus.textContent = msg;
    noteStatus.className = 'cp-settings-status ' + (ok ? 'cp-settings-status-ok' : 'cp-settings-status-err');
    setTimeout(() => { noteStatus.textContent = ''; noteStatus.className = 'cp-settings-status'; }, 3500);
  }

  async function saveNote(value) {
    const token = getPublicToken();
    const res   = await fetch(`/s/${token}/note`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ note: value || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    // Update the inline meta-bar display immediately
    const metaNote = document.getElementById('metaNoteDisplay');
    if (value) {
      if (metaNote) {
        metaNote.textContent = '📝 ' + value;
      } else {
        // Insert it — simple approach: reload to get server-rendered HTML
        // (only fires on explicit save, acceptable UX tradeoff)
      }
    } else if (metaNote) {
      metaNote.remove();
    }
    return data;
  }

  if (saveNoteBtn) saveNoteBtn.addEventListener('click', async () => {
    const val = (noteInput?.value || '').trim();
    saveNoteBtn.disabled = true;
    saveNoteBtn.textContent = 'Saving…';
    try {
      await saveNote(val);
      setNoteStatus(val ? 'Note saved.' : 'Note cleared.', true);
    } catch (e) {
      setNoteStatus(e.message, false);
    } finally {
      saveNoteBtn.disabled = false;
      saveNoteBtn.textContent = 'Save Note';
    }
  });

  if (clearNoteBtn) clearNoteBtn.addEventListener('click', async () => {
    if (noteInput) noteInput.value = '';
    clearNoteBtn.disabled = true;
    try {
      await saveNote(null);
      setNoteStatus('Note cleared.', true);
    } catch (e) {
      setNoteStatus(e.message, false);
    } finally {
      clearNoteBtn.disabled = false;
    }
  });

  // ── Burn Now ──────────────────────────────────────────────────────────────
  if (burnBtn) burnBtn.addEventListener('click', async () => {
    if (!confirm('Burn this secret now? This permanently destroys it and cannot be undone.')) return;
    const token = getPublicToken();
    burnBtn.disabled = true;
    burnBtn.textContent = 'Burning…';
    try {
      const res  = await fetch(`/s/${token}/burn`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Burn failed');
      // Update the status indicator in the header without a full reload
      const statusEl = document.querySelector('.cp-status');
      if (statusEl) {
        statusEl.textContent = '● Burned';
        statusEl.className = 'cp-status cp-status-burned';
      }
      burnBtn.textContent = '🔥 Burned';
      burnBtn.classList.add('cp-settings-btn-burned');
      setStatus('Secret has been burned.', true);
    } catch (e) {
      setStatus(e.message, false);
      burnBtn.disabled = false;
      burnBtn.textContent = '🔥 Burn Now';
    }
  });
}



// ── US State Map ─────────────────────────────────────────────────────────────
// geoip-lite US locations come as "City, ST, US" — ST is the 2-letter state abbrev.
// We extract it from the middle segment and map to a FIPS ID that matches us-map.svg.

const STATE_ABBREV = {
  AL:{f:"01",n:"Alabama"},      AK:{f:"02",n:"Alaska"},       AZ:{f:"04",n:"Arizona"},
  AR:{f:"05",n:"Arkansas"},     CA:{f:"06",n:"California"},   CO:{f:"08",n:"Colorado"},
  CT:{f:"09",n:"Connecticut"},  DE:{f:"10",n:"Delaware"},     DC:{f:"11",n:"District of Columbia"},
  FL:{f:"12",n:"Florida"},      GA:{f:"13",n:"Georgia"},      HI:{f:"15",n:"Hawaii"},
  ID:{f:"16",n:"Idaho"},        IL:{f:"17",n:"Illinois"},     IN:{f:"18",n:"Indiana"},
  IA:{f:"19",n:"Iowa"},         KS:{f:"20",n:"Kansas"},       KY:{f:"21",n:"Kentucky"},
  LA:{f:"22",n:"Louisiana"},    ME:{f:"23",n:"Maine"},        MD:{f:"24",n:"Maryland"},
  MA:{f:"25",n:"Massachusetts"},MI:{f:"26",n:"Michigan"},     MN:{f:"27",n:"Minnesota"},
  MS:{f:"28",n:"Mississippi"},  MO:{f:"29",n:"Missouri"},     MT:{f:"30",n:"Montana"},
  NE:{f:"31",n:"Nebraska"},     NV:{f:"32",n:"Nevada"},       NH:{f:"33",n:"New Hampshire"},
  NJ:{f:"34",n:"New Jersey"},   NM:{f:"35",n:"New Mexico"},   NY:{f:"36",n:"New York"},
  NC:{f:"37",n:"North Carolina"},ND:{f:"38",n:"North Dakota"},OH:{f:"39",n:"Ohio"},
  OK:{f:"40",n:"Oklahoma"},     OR:{f:"41",n:"Oregon"},       PA:{f:"42",n:"Pennsylvania"},
  RI:{f:"44",n:"Rhode Island"}, SC:{f:"45",n:"South Carolina"},SD:{f:"46",n:"South Dakota"},
  TN:{f:"47",n:"Tennessee"},    TX:{f:"48",n:"Texas"},        UT:{f:"49",n:"Utah"},
  VT:{f:"50",n:"Vermont"},      VA:{f:"51",n:"Virginia"},     WA:{f:"53",n:"Washington"},
  WV:{f:"54",n:"West Virginia"},WI:{f:"55",n:"Wisconsin"},    WY:{f:"56",n:"Wyoming"},
  PR:{f:"72",n:"Puerto Rico"},  GU:{f:"66",n:"Guam"},
};

// Extract state abbrev from "City, ST, US" — returns null if not a US location
function extractStateAbbrev(location) {
  if (!location) return null;
  const parts = location.split(',').map(p => p.trim());
  // Must have 3 parts and last must be "US"
  if (parts.length < 3 || parts[parts.length - 1].toUpperCase() !== 'US') return null;
  // State abbrev is second-to-last
  return parts[parts.length - 2].toUpperCase();
}

function buildUSMap() {
  // Count accesses per state
  const stateCounts = {};
  rawLogs.forEach(log => {
    const abbrev = extractStateAbbrev(log.location);
    if (!abbrev || !STATE_ABBREV[abbrev]) return;
    stateCounts[abbrev] = (stateCounts[abbrev] || 0) + 1;
  });

  // If no US data, leave the section hidden
  if (!Object.keys(stateCounts).length) return;

  // Show the section
  const section = document.getElementById('usMapSection');
  const mapWrap = document.getElementById('usMap');
  if (!section || !mapWrap) return;
  section.removeAttribute('hidden');
  mapWrap.innerHTML = '<div class="cp-map-empty">Loading\u2026</div>';

  fetch('/us-map.svg')
    .then(r => r.text())
    .then(svgText => renderUSMap(mapWrap, svgText, stateCounts))
    .catch(() => { mapWrap.innerHTML = '<div class="cp-map-empty">Map unavailable.</div>'; });
}

function renderUSMap(mapWrap, svgText, stateCounts) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) { mapWrap.innerHTML = '<div class="cp-map-empty">Map parse error.</div>'; return; }

  const maxCount = Math.max(...Object.values(stateCounts));
  const hitFips  = new Set();

  for (const [abbrev, count] of Object.entries(stateCounts)) {
    const entry = STATE_ABBREV[abbrev];
    if (!entry) continue;
    const path = svg.querySelector(`[data-id="${entry.f}"]`);
    if (!path) continue;

    // Intensity class: 1–4 based on count relative to max
    const intensity = Math.ceil((count / maxCount) * 4);
    path.classList.add('us-state--hit', `us-state--hit-${intensity}`);

    // Native SVG tooltip
    const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${entry.n}: ${count} access${count !== 1 ? 'es' : ''}`;
    path.prepend(title);
    hitFips.add(entry.f);
  }

  mapWrap.innerHTML = '';
  mapWrap.appendChild(svg);

  // Legend: heat scale + state count
  const legend = document.createElement('div');
  legend.className = 'cp-map-legend cp-us-legend';
  legend.innerHTML =
    `<span>${hitFips.size} state${hitFips.size !== 1 ? 's' : ''} with traffic &nbsp;·&nbsp; hover a state for details</span>` +
    `<span class="cp-us-heat">` +
    `<span class="cp-heat-swatch cp-heat-1"></span>low` +
    `<span class="cp-heat-swatch cp-heat-2"></span>` +
    `<span class="cp-heat-swatch cp-heat-3"></span>` +
    `<span class="cp-heat-swatch cp-heat-4"></span>high` +
    `</span>`;
  mapWrap.appendChild(legend);
}


// ═══════════════════════════════════════════════════════════════════════════
// LIVE POLLING — real-time updates without page reload
// ═══════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS   = 10_000;   // check every 10 seconds
const POLL_INTERVAL_IDLE = 30_000;   // slow down when tab is hidden

let pollTimer       = null;
let lastSeenTs      = 0;             // newest accessed_at we've ingested
let liveActive      = false;
let pollPaused      = false;

// Seed lastSeenTs from the already-rendered logs
(function seedLastSeen() {
  if (rawLogs.length) {
    lastSeenTs = Math.max(...rawLogs.map(l => l.accessed_at || 0));
  }
})();

// ── Toast notification system ────────────────────────────────────────────────

function injectToastContainer() {
  if (document.getElementById('toastContainer')) return;
  const el = document.createElement('div');
  el.id = 'toastContainer';
  el.className = 'cp-toast-container';
  document.body.appendChild(el);
}

function showToast(message, type = 'info', duration = 6000) {
  injectToastContainer();
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `cp-toast cp-toast-${type}`;
  toast.innerHTML = `<span class="cp-toast-icon">${type === 'danger' ? '🚨' : type === 'warn' ? '⚠️' : '📡'}</span><span class="cp-toast-msg">${message}</span><button class="cp-toast-close">✕</button>`;
  toast.querySelector('.cp-toast-close').addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('cp-toast-show'));
  if (duration > 0) setTimeout(() => dismissToast(toast), duration);
  return toast;
}

function dismissToast(toast) {
  toast.classList.remove('cp-toast-show');
  toast.classList.add('cp-toast-hide');
  setTimeout(() => toast.remove(), 400);
}

// ── Live badge in header ─────────────────────────────────────────────────────

function setLiveBadge(active) {
  let badge = document.getElementById('liveBadge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'liveBadge';
    const headerRight = document.querySelector('.cp-header-right');
    if (headerRight) headerRight.prepend(badge);
  }
  if (active) {
    badge.className = 'cp-live-badge cp-live-badge-on';
    badge.textContent = '⬤ LIVE';
  } else {
    badge.className = 'cp-live-badge cp-live-badge-paused';
    badge.textContent = '⬤ PAUSED';
  }
}

// ── Stat card updater ────────────────────────────────────────────────────────

function updateStatCards(stats) {
  const cards = document.querySelectorAll('.cp-stat');
  const values = [stats.totalViews, stats.revealAttempts, stats.revealSuccesses, stats.uniqueIPs];
  cards.forEach((card, i) => {
    const valEl = card.querySelector('.cp-stat-value');
    if (!valEl) return;
    const oldVal = parseInt(valEl.textContent, 10);
    const newVal = values[i];
    if (!isNaN(oldVal) && newVal > oldVal) {
      valEl.textContent = newVal;
      card.classList.add('cp-stat-flash');
      setTimeout(() => card.classList.remove('cp-stat-flash'), 1000);
    } else {
      valEl.textContent = newVal;
    }
  });
}

// ── Build a single timeline row HTML ────────────────────────────────────────

function buildTimelineRowHTML(log) {
  const dotClass = log.reveal_succeeded ? 'cp-dot-reveal' : log.reveal_attempted ? 'cp-dot-attempt' : 'cp-dot-view';
  const event    = log.reveal_succeeded ? 'Secret Revealed' : log.reveal_attempted ? 'Reveal Attempted (failed)' : 'Page Viewed';
  const ip       = log.ip_address || '';
  const ipDisplay = (ipsMasked && ip) ? maskIPDisplay(ip) : (ip || 'Unknown IP');

  const labels = (log._labels || []).map(lbl =>
    `<span class="cp-evtlabel cp-evtlabel-${lbl.replace(/_/g,'-')}">${lbl.replace(/_/g,' ')}</span>`
  ).join('');

  const meta = [
    `<span class="cp-ip-val" data-ip="${ip}">${ipDisplay}</span>`,
    log.location   ? `<span>${log.location}</span>` : '',
    log.timezone   ? `<span class="cp-tl-tz">${log.timezone}</span>` : '',
    log.org        ? `<span>${log.org}</span>` : '',
    log.accept_language ? `<span class="cp-tl-lang" title="Accept-Language">🌐 ${log.accept_language.slice(0,30)}</span>` : '',
  ].filter(Boolean).join('');

  const dt = new Date(log.accessed_at * 1000).toISOString().slice(0,19).replace('T',' ');
  const ago = timeAgo(log.accessed_at);

  return `<div class="cp-tl-row cp-tl-row-new">
    <div class="cp-tl-dot ${dotClass}"></div>
    <div class="cp-tl-body">
      <div class="cp-tl-event">${event}${labels}</div>
      <div class="cp-tl-meta">${meta}</div>
    </div>
    <div class="cp-tl-time" data-ts="${log.accessed_at}" title="${dt}">${ago}</div>
  </div>`;
}

// ── Time-ago helper ──────────────────────────────────────────────────────────

function timeAgo(unixTs) {
  const secs = Math.floor(Date.now() / 1000) - unixTs;
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return new Date(unixTs * 1000).toISOString().slice(0,10);
}

// ── Inject new rows into timelines ──────────────────────────────────────────

function prependNewRows(newLogs) {
  if (!newLogs.length) return;

  const rowsHTML = newLogs.map(buildTimelineRowHTML).join('');

  // Overview tab — recent activity (cap at 10)
  const overviewTl = document.querySelector('#tab-overview .cp-timeline');
  if (overviewTl) {
    overviewTl.insertAdjacentHTML('afterbegin', rowsHTML);
    // Keep only 10 rows
    const rows = overviewTl.querySelectorAll('.cp-tl-row');
    for (let i = 10; i < rows.length; i++) rows[i].remove();
    // Remove "new" flash after animation
    setTimeout(() => overviewTl.querySelectorAll('.cp-tl-row-new').forEach(r => r.classList.remove('cp-tl-row-new')), 2000);
  }

  // Full timeline tab
  const fullTl = document.querySelector('#tab-timeline .cp-timeline');
  if (fullTl) {
    fullTl.insertAdjacentHTML('afterbegin', rowsHTML);
    setTimeout(() => fullTl.querySelectorAll('.cp-tl-row-new').forEach(r => r.classList.remove('cp-tl-row-new')), 2000);
  }

  // If timeline tab is visible, remove empty state placeholder
  [overviewTl, fullTl].forEach(tl => {
    if (!tl) return;
    const empty = tl.parentElement.querySelector('.cp-empty');
    if (empty) empty.remove();
  });

  // Apply IP masking to newly injected rows
  applyIPMask();
}

// ── Main poll function ───────────────────────────────────────────────────────

async function pollForUpdates() {
  const token = getPublicToken();
  if (!token) return;

  try {
    const res  = await fetch(`/s/${token}/poll?since=${lastSeenTs}`);
    if (!res.ok) return;
    const data = await res.json();

    // Update stat cards
    updateStatCards(data.stats);

    // Handle state changes
    if (data.burned) {
      const statusEl = document.querySelector('.cp-status');
      if (statusEl && !statusEl.classList.contains('cp-status-burned')) {
        statusEl.textContent = '● Burned';
        statusEl.className   = 'cp-status cp-status-burned';
        showToast('🔥 Secret has been burned — it is no longer accessible.', 'warn', 0);
        stopPolling();
        return;
      }
    }

    if (!data.newLogs.length) return;

    // Process new entries
    const reveals = data.newLogs.filter(l => l.reveal_succeeded);
    const views   = data.newLogs.filter(l => !l.reveal_attempted);
    const fails   = data.newLogs.filter(l => l.reveal_attempted && !l.reveal_succeeded);

    // Push new logs into our in-memory array (newest first)
    data.newLogs.forEach(l => rawLogs.unshift(l));

    // Update lastSeenTs
    lastSeenTs = Math.max(lastSeenTs, ...data.newLogs.map(l => l.accessed_at));

    // Inject rows into UI
    prependNewRows(data.newLogs);

    // Rebuild charts if overview is visible
    if (document.getElementById('tab-overview')?.classList.contains('active')) {
      setTimeout(buildOverview, 300); // small delay so DOM settles
    }

    // Toast alerts — reveals get priority
    if (reveals.length) {
      const loc = reveals[0].location ? ` from ${reveals[0].location}` : '';
      showToast(`🚨 Secret REVEALED${loc} — ${new Date(reveals[0].accessed_at*1000).toLocaleTimeString()}`, 'danger', 0);
    } else if (fails.length) {
      showToast(`⚠️ Failed reveal attempt from ${fails[0].location || fails[0].ip_address || 'unknown'}`, 'warn');
    } else if (views.length) {
      const loc = views[0].location ? ` from ${views[0].location}` : '';
      showToast(`📡 New visit${loc}`, 'info', 5000);
    }

  } catch (_e) {
    // Silent fail — network blip shouldn't crash the panel
  }
}

// ── Polling control ──────────────────────────────────────────────────────────

function startPolling() {
  if (pollTimer) return;
  liveActive = true;
  setLiveBadge(true);
  pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer  = null;
  liveActive = false;
  setLiveBadge(false);
}

function pausePolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_IDLE);
  pollPaused = true;
  setLiveBadge(false);
}

function resumePolling() {
  if (!liveActive) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_MS);
  pollPaused = false;
  setLiveBadge(true);
  // Immediate check on resume
  pollForUpdates();
}

// Pause when hidden, resume on focus (saves resources and catches up instantly)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pausePolling();
  else resumePolling();
});
window.addEventListener('focus', () => { if (liveActive && pollPaused) resumePolling(); });

// ── Boot: start polling on load (only if link is active) ────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.querySelector('.cp-status');
  const isBurned  = statusEl?.classList.contains('cp-status-burned');
  const isExpired = statusEl?.classList.contains('cp-status-expired');

  if (!isBurned && !isExpired) {
    // Small delay so initial page render completes first
    setTimeout(() => {
      startPolling();
    }, 2000);
  } else {
    setLiveBadge(false);
  }

  // Also update all existing time displays every minute
  setInterval(() => {
    document.querySelectorAll('.cp-tl-time[data-ts]').forEach(el => {
      const ts = parseInt(el.dataset.ts, 10);
      if (!isNaN(ts)) el.textContent = timeAgo(ts);
    });
  }, 60_000);

  // Apply initial time-ago to server-rendered rows
  document.querySelectorAll('.cp-tl-time[data-ts]').forEach(el => {
    const ts = parseInt(el.dataset.ts, 10);
    if (!isNaN(ts)) el.textContent = timeAgo(ts);
  });
});
