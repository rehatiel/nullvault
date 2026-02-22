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
// data-expires is a Unix timestamp (seconds). We tick every second and
// replace the element with an "expired" message when it hits zero.

const countdown = document.getElementById('expiryCountdown');
if (countdown) {
  const timerEl  = document.getElementById('expiryTimer');
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

    // Turn red in the last hour
    if (secsLeft < 3600) countdown.classList.add('expiry-countdown--urgent');
    else                 countdown.classList.remove('expiry-countdown--urgent');

    setTimeout(tick, 1000);
  }

  tick();
}
