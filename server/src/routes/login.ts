import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth, hashSecret, verifySecret } from '../auth.js';
import { log } from '../log.js';

/**
 * Password login for the dashboard.
 *
 * The shared secret is 32 random characters. It is a fine machine credential
 * and a miserable human one — you cannot type it from memory, and it lives in
 * the dashboard, which is the thing you need it to open. That circularity is
 * the problem this solves: set a password once, then sign in with something
 * you can remember and go fetch a pairing link.
 *
 * A successful login hands back the shared secret, which the dashboard stores
 * exactly as it does today. So this is a new *door*, not a new access model —
 * everything downstream is unchanged.
 *
 * Setting a password is optional. With none set, the secret remains the only
 * way in and `POST /api/auth/login` reports that rather than pretending.
 */

export const loginRouter = Router();

/** Long enough that argon2 plus the attempt limiter make guessing impractical. */
const MIN_PASSWORD_LENGTH = 10;

/** Attempts per client per hour. Deliberately tighter than pairing: a password
 *  is far more guessable than a 32-character random secret. */
const LOGIN_ATTEMPT_LIMIT = 10;

/**
 * Per-IP hourly guard, sharing `pair_attempts` with the pairing claim route —
 * the table is keyed by an opaque `client_key`, so a distinct prefix keeps the
 * two budgets separate.
 *
 * Fails CLOSED. This endpoint issues a credential without authentication, so a
 * metering failure must not become an unmetered guessing oracle.
 */
function tooManyAttempts(ip: string): boolean {
  const windowStart = new Date().toISOString().slice(0, 13);
  const clientKey = `login:${ip}`;
  try {
    const db = getDb();
    const count = db.transaction(() => {
      db.prepare(
        `INSERT INTO pair_attempts (client_key, window_start, count)
         VALUES (?, ?, 1)
         ON CONFLICT(client_key, window_start) DO UPDATE SET count = count + 1`,
      ).run(clientKey, windowStart);
      const row = db
        .prepare('SELECT count FROM pair_attempts WHERE client_key = ? AND window_start = ?')
        .get(clientKey, windowStart) as { count: number };
      return row.count;
    })();
    return count > LOGIN_ATTEMPT_LIMIT;
  } catch (err) {
    log.error({ err, ip }, 'login attempt metering failed; refusing login');
    return true;
  }
}

/** GET /api/auth/login — whether a password has been set, so the sign-in page
 *  can offer the right field instead of guessing. Reveals no credential. */
loginRouter.get('/api/auth/login', (_req, res) => {
  const row = getDb().prepare('SELECT password_hash FROM users ORDER BY id LIMIT 1').get() as
    | { password_hash: string | null }
    | undefined;
  res.json({ password_set: Boolean(row?.password_hash) });
});

/**
 * POST /api/auth/login — trade a password for the shared secret.
 *
 * Unauthenticated by definition: the caller is signing in.
 */
loginRouter.post('/api/auth/login', async (req, res) => {
  if (tooManyAttempts(req.ip ?? 'unknown')) {
    res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many sign-in attempts. Wait an hour, or sign in with your VOX secret.',
    });
    return;
  }

  const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', message: 'password is required' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare('SELECT id, shared_secret_hash, password_hash FROM users ORDER BY id LIMIT 1')
    .get() as { id: number; shared_secret_hash: string; password_hash: string | null } | undefined;

  if (!row?.password_hash) {
    res.status(409).json({
      error: 'no_password_set',
      message: 'No password has been set yet. Sign in with your VOX secret, then set one under Account.',
    });
    return;
  }

  if (!(await verifySecret(parsed.data.password, row.password_hash))) {
    log.warn({ ip: req.ip }, 'failed dashboard login');
    res.status(401).json({ error: 'invalid_password', message: 'That password is not right.' });
    return;
  }

  // The shared secret is stored only as a hash, so it cannot be recovered here.
  // The password row therefore carries its own encrypted copy — see
  // POST /api/account/password, which captures it at set time.
  const secretRow = db
    .prepare('SELECT secret_encrypted FROM password_secrets WHERE user_id = ?')
    .get(row.id) as { secret_encrypted: string } | undefined;

  if (!secretRow) {
    res.status(409).json({
      error: 'password_stale',
      message:
        'Your password predates the current secret. Sign in with the VOX secret and set the password again.',
    });
    return;
  }

  const { decryptString } = await import('../crypto.js');
  let secret: string;
  try {
    secret = decryptString(secretRow.secret_encrypted);
  } catch (err) {
    log.error({ err, userId: row.id }, 'could not decrypt the secret stored with the password');
    res.status(500).json({ error: 'decrypt_failed', message: 'Sign in with your VOX secret instead.' });
    return;
  }

  log.info({ userId: row.id }, 'dashboard login by password');
  res.json({ secret, user_id: row.id });
});

/**
 * POST /api/account/password — set or change the dashboard password.
 *
 * Requires the caller to already be authenticated, so setting a password is
 * something only someone already holding a credential can do.
 *
 * The shared secret presented on THIS request is captured and stored encrypted
 * alongside the password hash, because the secret itself is only ever stored
 * as an Argon2id hash and so cannot be recovered at login time. This mirrors
 * how `auth_handoffs` carries the secret it was minted with.
 */
loginRouter.post('/api/account/password', requireAuth, async (req, res) => {
  if (req.user!.deviceId !== undefined) {
    res.status(403).json({
      error: 'device_cannot_set_password',
      message: 'Set the dashboard password from the dashboard, not from a paired device.',
    });
    return;
  }

  const parsed = z
    .object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(200) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_password',
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
    return;
  }

  const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!presented) {
    res.status(400).json({ error: 'missing_token', message: 'Authorization header required' });
    return;
  }

  const { encryptString } = await import('../crypto.js');
  const hash = await hashSecret(parsed.data.password);
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user!.id);
    db.prepare(
      `INSERT INTO password_secrets (user_id, secret_encrypted, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         secret_encrypted = excluded.secret_encrypted,
         updated_at = excluded.updated_at`,
    ).run(req.user!.id, encryptString(presented));
  })();

  log.info({ userId: req.user!.id }, 'dashboard password set');
  res.json({ password_set: true });
});

/** DELETE /api/account/password — remove it; the shared secret becomes the only
 *  way in again. */
loginRouter.delete('/api/account/password', requireAuth, (req, res) => {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(req.user!.id);
    db.prepare('DELETE FROM password_secrets WHERE user_id = ?').run(req.user!.id);
  })();
  log.info({ userId: req.user!.id }, 'dashboard password removed');
  res.json({ password_set: false });
});
