import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth, hashSecret } from '../auth.js';
import { getDb } from '../db.js';
import { encryptString } from '../crypto.js';
import { runDiagnostics } from '../diagnostics.js';
import { log } from '../log.js';

export const accountRouter = Router();

/** GET /api/account — basic account info (no secrets). */
accountRouter.get('/api/account', requireAuth, (req, res) => {
  const row = getDb()
    .prepare('SELECT id, created_at, rotated_at FROM users WHERE id = ?')
    .get(req.user!.id) as { id: number; created_at: string; rotated_at: string | null } | undefined;
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ user_id: row.id, created_at: row.created_at, rotated_at: row.rotated_at });
});

/**
 * POST /api/account/rotate-secret
 *
 * Generates a fresh shared secret, re-hashes it into the user row, and
 * returns the plaintext exactly once. The caller (dashboard) must store it
 * immediately — the old secret stops working as soon as this returns.
 */
accountRouter.post('/api/account/rotate-secret', requireAuth, async (req, res) => {
  const newSecret = randomBytes(24).toString('base64url');
  const hash = await hashSecret(newSecret);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE users SET shared_secret_hash = ?, rotated_at = datetime('now') WHERE id = ?")
      .run(hash, req.user!.id);
    // Keep the dashboard password working across a rotation. The password row
    // carries an encrypted copy of the secret (the secret itself is only ever
    // stored as a hash, so login cannot recover it otherwise) — leaving the old
    // copy behind would let a correct password return a dead secret, which
    // fails later and confusingly.
    const hasPassword = db
      .prepare('SELECT 1 FROM password_secrets WHERE user_id = ?')
      .get(req.user!.id);
    if (hasPassword) {
      db.prepare(
        "UPDATE password_secrets SET secret_encrypted = ?, updated_at = datetime('now') WHERE user_id = ?",
      ).run(encryptString(newSecret), req.user!.id);
    }
  })();
  log.info({ userId: req.user!.id }, 'shared secret rotated');
  res.json({ secret: newSecret, rotated_at: new Date().toISOString() });
});

/**
 * POST /api/diagnostics — run every server-side health check and return a
 * per-check report. Powers the dashboard's Diagnostics page.
 */
accountRouter.post('/api/diagnostics', requireAuth, async (req, res) => {
  try {
    const checks = await runDiagnostics(req.user!.id);
    const summary = {
      ok: checks.filter((c) => c.status === 'ok').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      skip: checks.filter((c) => c.status === 'skip').length,
    };
    res.json({ ran_at: new Date().toISOString(), summary, checks });
  } catch (err) {
    log.error({ err }, 'diagnostics run failed');
    res.status(500).json({ error: 'diagnostics_failed', message: err instanceof Error ? err.message : String(err) });
  }
});
