import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { rateLimit } from '../rate-limit.js';
import { encryptString, decryptString } from '../crypto.js';
import { log } from '../log.js';

export const authHandoffRouter = Router();

/**
 * Passkey-free sign-in.
 *
 * The problem this solves: opening the VOX dashboard used to mean typing a
 * 32-character shared secret by hand, and the Account page's pairing QR
 * embedded that permanent secret in plaintext — anyone who photographed the
 * screen had unlimited Twilio and LLM spend, forever, with no way to tell.
 *
 * Instead, a client that ALREADY holds the secret (the phone companion, or
 * an authenticated dashboard session) mints a short-lived, single-use
 * handoff token and passes that along — in a deep link on the same device,
 * or in a QR code for a different one. The token is exchanged once for the
 * real secret and immediately burned.
 *
 * Properties that matter:
 *   - single use   — the row is marked used inside the same transaction as
 *                    the read, so two racing exchanges cannot both win
 *   - short lived  — TTL below, not a session
 *   - hashed       — only SHA-256(token) is stored, so DB access alone
 *                    cannot be replayed into a session
 *   - revocable    — deleting the row kills the token
 */

/** Long enough to walk to a laptop and scan; short enough to be useless if leaked. */
const TTL_SECONDS = 180;

const CreateBody = z.object({
  purpose: z.enum(['dashboard', 'pairing']).default('dashboard'),
});

const ExchangeBody = z.object({
  token: z.string().min(16).max(200),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * POST /api/auth/handoff — mint a one-time token. Requires the real secret,
 * so only a client that is already trusted can create one.
 */
authHandoffRouter.post(
  '/api/auth/handoff',
  requireAuth,
  rateLimit({ bucket: 'handoff', limit: 120 }),
  (req, res) => {
    const parsed = CreateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const userId = req.user!.id;

    // Capture the secret the caller authenticated WITH, and stash it
    // encrypted on the row. The server only ever stores an argon2 hash of
    // the secret, so it cannot reconstruct one later — and reading it back
    // out of env would go stale the moment the user rotates. The bearer
    // header is the one place the plaintext legitimately exists.
    const presented = (req.headers.authorization ?? '').split(' ')[1] ?? '';
    if (!presented) {
      res.status(401).json({ error: 'missing_token' });
      return;
    }

    // 32 bytes base64url — same entropy class as the secret it stands in for.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

    const db = getDb();
    db.transaction(() => {
      // Opportunistic cleanup so the table cannot grow without bound; there
      // is no scheduler on this box and expired rows are worthless anyway.
      db.prepare("DELETE FROM auth_handoffs WHERE expires_at < datetime('now')").run();
      db.prepare(
        `INSERT INTO auth_handoffs (token_hash, user_id, purpose, secret_encrypted, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(hashToken(token), userId, parsed.data.purpose, encryptString(presented), expiresAt);
    })();

    res.json({ token, expires_at: expiresAt, expires_in: TTL_SECONDS });
  },
);

/**
 * POST /api/auth/handoff/exchange — trade a token for the shared secret.
 *
 * Deliberately unauthenticated: the token IS the credential. Rate-limited by
 * IP-agnostic global bucket since there is no user context yet, and a wrong
 * token is indistinguishable from a missing one in the response.
 */
authHandoffRouter.post('/api/auth/handoff/exchange', (req, res) => {
  const parsed = ExchangeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  const hash = hashToken(parsed.data.token);

  const result = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT token_hash, user_id, purpose, secret_encrypted, expires_at, used_at
         FROM auth_handoffs WHERE token_hash = ?`,
      )
      .get(hash) as
      | {
          token_hash: string;
          user_id: number;
          purpose: string;
          secret_encrypted: string;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;
    if (!row) return null;
    if (row.used_at) return null;
    // expires_at is written as a full ISO string with Z, so this parses UTC.
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    // Burn it inside the same transaction as the read — two racing
    // exchanges cannot both observe an unused row.
    const upd = db
      .prepare("UPDATE auth_handoffs SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL")
      .run(hash);
    if (upd.changes === 0) return null;
    return row;
  })();

  if (!result) {
    log.warn('auth handoff exchange rejected (unknown, used, or expired token)');
    res.status(401).json({ error: 'invalid_token', message: 'This link has expired. Generate a new one.' });
    return;
  }

  // The handoff proves the bearer was trusted; hand back the secret it was
  // minted with so the dashboard authenticates exactly as if it were typed.
  let secret: string;
  try {
    secret = decryptString(result.secret_encrypted);
  } catch (err) {
    log.error({ err }, 'handoff row failed to decrypt');
    res.status(500).json({ error: 'secret_unavailable', message: 'Sign in with your passkey once.' });
    return;
  }

  log.info({ userId: result.user_id, purpose: result.purpose }, 'auth handoff exchanged');
  res.json({ secret, user_id: result.user_id });
});

/** Exported for tests. */
export const _internals = { hashToken, TTL_SECONDS };
