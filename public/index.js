const createBtn    = document.getElementById('createBtn');
const createError  = document.getElementById('createError');
const stepCreate   = document.getElementById('stepCreate');
const stepResult   = document.getElementById('stepResult');

createBtn.addEventListener('click', async () => {
  const content      = document.getElementById('secretInput').value.trim();
  const expiry       = parseInt(document.getElementById('expiryInput').value, 10);
  const template     = document.getElementById('templateInput').value;
  const burnOnReveal = document.getElementById('burnInput').checked;
  const note         = (document.getElementById('noteInput')?.value || '').trim() || null;

  createError.classList.add('hidden');
  if (!content) { showError('Please enter a secret before generating a link.'); return; }

  createBtn.disabled = true;
  createBtn.textContent = 'Generating…';

  try {
    const res  = await fetch('/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content, expiryDays: expiry, template, burnOnReveal, note }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Something went wrong.'); return; }

    document.getElementById('resultPublic').textContent  = data.publicUrl;
    document.getElementById('resultControl').textContent = data.controlUrl;

    // QR code — loaded from the /qr/:token endpoint which returns inline SVG
    const token = data.publicUrl.split('/s/')[1];
    const qrImg = document.getElementById('resultQR');
    if (qrImg && token) qrImg.src = `/s/${token}/qr`;

    stepCreate.classList.add('hidden');
    stepResult.classList.remove('hidden');
    setupCopy('copyPublic',  'resultPublic');
    setupCopy('copyControl', 'resultControl');
  } catch {
    showError('Network error. Please check your connection and try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.innerHTML = '🔒 &nbsp;Generate Secure Link';
  }
});

document.getElementById('createAnother').addEventListener('click', () => {
  document.getElementById('secretInput').value = '';
  document.getElementById('burnInput').checked  = false;
  const ni = document.getElementById('noteInput');
  if (ni) ni.value = '';
  stepResult.classList.add('hidden');
  stepCreate.classList.remove('hidden');
});

function showError(msg) {
  createError.textContent = msg;
  createError.classList.remove('hidden');
}

function setupCopy(btnId, urlId) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById(urlId).textContent).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  });
}
