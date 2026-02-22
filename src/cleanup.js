const db = require('./db');

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);

const purgeOldLogs = db.prepare(`
  DELETE FROM access_logs WHERE accessed_at < unixepoch() - (@days * 86400)
`);

const purgeOldSecrets = db.prepare(`
  DELETE FROM secrets
  WHERE id NOT IN (SELECT secret_id FROM access_logs)
    AND (burned = 1 OR (expires_at IS NOT NULL AND expires_at < unixepoch()))
    AND created_at < unixepoch() - (@days * 86400)
`);

function runCleanup() {
  try {
    const l = purgeOldLogs.run({ days: RETENTION_DAYS });
    const s = purgeOldSecrets.run({ days: RETENTION_DAYS });
    console.log(`[${new Date().toISOString()}] Cleanup: removed ${l.changes} log(s), ${s.changes} secret(s)`);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

function startCleanupScheduler() {
  console.log(`[Cleanup] Retention: ${RETENTION_DAYS} days. Running every 6 hours.`);
  runCleanup();
  setInterval(runCleanup, 6 * 60 * 60 * 1000);
}

module.exports = { startCleanupScheduler, runCleanup };
