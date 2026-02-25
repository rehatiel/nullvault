const express  = require('express');
const helmet   = require('helmet');
const nunjucks = require('nunjucks');
const path     = require('path');

const secretRoutes = require('./routes/secret');
const createRoutes = require('./routes/create');
const healthRoutes = require('./routes/health');
const { startCleanupScheduler } = require('./cleanup');

const app = express();

const trustProxy = parseInt(process.env.TRUST_PROXY || '1', 10);
app.set('trust proxy', trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      styleSrc:   ["'self'"],
      scriptSrc:  ["'self'"],
      fontSrc:    ["'self'"],
      imgSrc:     ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy:            { policy: 'no-referrer' },
  // Explicitly allow geolocation so the reveal page can prompt the visitor.
  // Helmet 7 blocks it by default via Permissions-Policy.
  permittedCrossDomainPolicies: false,
}));

// Allow geolocation — must be set after helmet since helmet sets Permissions-Policy
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});
app.disable('x-powered-by');

const env = nunjucks.configure(path.join(__dirname, '..', 'views'), {
  autoescape: true,
  express:    app,
});

// All filters registered explicitly — Nunjucks has very few built-ins
env.addFilter('date',     ts  => new Date(ts * 1000).toISOString().slice(0, 10));
env.addFilter('datetime', ts  => new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '));
env.addFilter('truncate', (str, len) => str && str.length > len ? str.slice(0, len) + '…' : (str || ''));
env.addFilter('round',    (num, decimals) => typeof num === 'number' ? Number(num.toFixed(decimals ?? 0)) : num);
env.addFilter('parseua',  (ua) => {
  if (!ua) return { browser: '—', platform: '—' };
  const browsers = [
    { name: 'Edge',    re: /Edg\// },
    { name: 'Samsung', re: /SamsungBrowser\// },
    { name: 'Opera',   re: /OPR\// },
    { name: 'Chrome',  re: /Chrome\/[\d.]+ (?!.*Edg|.*OPR|.*SamsungBrowser)/ },
    { name: 'Firefox', re: /Firefox\// },
    { name: 'Safari',  re: /Safari\// },
  ];
  const platforms = [
    { name: 'iOS',     re: /iPhone|iPad/ },
    { name: 'Android', re: /Android/ },
    { name: 'Windows', re: /Windows/ },
    { name: 'macOS',   re: /Mac OS X/ },
    { name: 'Linux',   re: /Linux/ },
  ];
  return {
    browser:  (browsers.find(b => b.re.test(ua))  || { name: 'Other' }).name,
    platform: (platforms.find(p => p.re.test(ua)) || { name: 'Unknown' }).name,
  };
});

// Site branding — configurable via .env
const SITE_NAME  = process.env.SITE_NAME  || 'NullVault';
const SITE_LOGO  = process.env.SITE_LOGO  || '🔒';

// Inject branding and current year into every template
app.use((req, res, next) => {
  res.locals.siteName    = SITE_NAME;
  res.locals.siteLogo    = SITE_LOGO;
  res.locals.currentYear = new Date().getFullYear();
  next();
});

app.set('view engine', 'njk');

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '4kb' }));

app.get('/', (_req, res) => res.render('index.njk'));

// ── Info pages ────────────────────────────────────────────────────────────────
app.get('/how-it-works', (_req, res) => res.render('how-it-works.njk'));
app.get('/security',     (_req, res) => res.render('security.njk'));
app.get('/faq',          (_req, res) => res.render('faq.njk'));
app.get('/privacy',      (_req, res) => res.render('privacy.njk'));
app.get('/terms',        (_req, res) => res.render('terms.njk'));

app.use('/health', healthRoutes);
app.use('/s',      secretRoutes);
app.use('/create', createRoutes);

app.use((_req, res) => {
  res.status(404).render('error.njk', { message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).render('error.njk', { message: 'Something went wrong.' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`${SITE_NAME} listening on port ${PORT}`);
  startCleanupScheduler();
});

module.exports = app;
