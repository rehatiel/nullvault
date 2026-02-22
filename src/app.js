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
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy:            { policy: 'no-referrer' },
}));
app.disable('x-powered-by');

const env = nunjucks.configure(path.join(__dirname, '..', 'views'), {
  autoescape: true,
  express:    app,
});

// All filters registered explicitly — Nunjucks has very few built-ins
env.addFilter('date',     ts  => new Date(ts * 1000).toISOString().slice(0, 10));
env.addFilter('datetime', ts  => new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '));
env.addFilter('truncate', (str, len) => str && str.length > len ? str.slice(0, len) + '…' : (str || ''));

app.set('view engine', 'njk');

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '4kb' }));

app.get('/', (_req, res) => res.render('index.njk'));

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
  console.log(`NullVault listening on port ${PORT}`);
  startCleanupScheduler();
});

module.exports = app;
