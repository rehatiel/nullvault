const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'honeypot.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS secrets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token  TEXT    NOT NULL UNIQUE,
    control_token TEXT    NOT NULL UNIQUE,
    content       TEXT    NOT NULL,
    note          TEXT,
    template      TEXT    NOT NULL DEFAULT 'default',
    webhook_url   TEXT,
    burned        INTEGER NOT NULL DEFAULT 0,
    burned_at     INTEGER,
    expires_at    INTEGER,
    burn_on_reveal INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    secret_id        INTEGER NOT NULL REFERENCES secrets(id),
    accessed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    ip_address       TEXT,
    location         TEXT,
    org              TEXT,
    user_agent       TEXT,
    referer          TEXT,
    request_path     TEXT,
    reveal_attempted INTEGER NOT NULL DEFAULT 0,
    reveal_succeeded INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_secrets_public_token  ON secrets(public_token);
  CREATE INDEX IF NOT EXISTS idx_secrets_control_token ON secrets(control_token);
  CREATE INDEX IF NOT EXISTS idx_access_logs_secret_id ON access_logs(secret_id);
`);

// ── Migrations for existing databases ──────────────────────────────────────
const sCols = db.prepare('PRAGMA table_info(secrets)').all().map(c => c.name);
if (!sCols.includes('template'))       db.exec(`ALTER TABLE secrets ADD COLUMN template TEXT NOT NULL DEFAULT 'default'`);
if (!sCols.includes('webhook_url'))    db.exec(`ALTER TABLE secrets ADD COLUMN webhook_url TEXT`);
if (!sCols.includes('burn_on_reveal')) db.exec(`ALTER TABLE secrets ADD COLUMN burn_on_reveal INTEGER NOT NULL DEFAULT 0`);

const lCols = db.prepare('PRAGMA table_info(access_logs)').all().map(c => c.name);
if (!lCols.includes('location')) db.exec(`ALTER TABLE access_logs ADD COLUMN location TEXT`);
if (!lCols.includes('org'))      db.exec(`ALTER TABLE access_logs ADD COLUMN org TEXT`);

module.exports = db;
