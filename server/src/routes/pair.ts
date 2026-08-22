import { Router } from 'express';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db.js';
import { env } from '../env.js';
import { requireAuth, hashSecret } from '../auth.js';
import { log } from '../log.js';

/**
 * Device pairing — how a VOX app with no embedded credential gets one.
 *
 * The public .ehpk ships with no server address and no secret. It is inert
 * until someone pairs it, which is the entire point: a build that anyone can
 * download must not carry the developer's backend credentials.
 *
 * The exchange:
 *
 *   1. The owner opens the dashboard (already authenticated with the user
 *      shared secret) and mints a pairing code. The code is short-lived and
 *      only its hash is stored, so reading the database cannot replay a live
 *      code.
 *   2. The dashboard renders `https://<host>/p/<CODE>` as a QR and as text.
 *      The URL carries BOTH halves the app needs — the origin tells it which
 *      server to talk to, the path tells it which code to redeem. A bare code
 *      would be useless: with no embedded server address there would be
 *      nowhere to send it, and resolving a short code to a host would require
 *      a central directory that self-hosted VOX deliberately does not have.
 *   3. The app POSTs the code to /api/pair/claim — the one unauthenticated
 *      endpoint here, because by definition the caller has no credential yet.
 *      The code is verified and burned in a single transaction, a fresh
 *      per-device secret is generated, and the plaintext is returned exactly
 *      once.
 *   4. The app stores {server, secret} in KVS. Every later request carries the
 *      device secret, which `requireAuth` accepts alongside user secrets.
 *
 * Device secrets can do everything a user secret can EXCEPT mint further
 * pairing codes or rotate the user secret. A stolen device therefore cannot
 * enrol more devices, and revoking it (DELETE /api/devices/:id) cuts off that
 * one install without disturbing any other.
 */

export const pairRouter = Router();

/** Crockford base32 — no I, L, O or U, so the code survives being read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 600;

/** Attempts allowed per client per hour against the unauthenticated claim route. */
const CLAIM_ATTEMPT_LIMIT = 20;

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Accept what a human actually types: lower case, hyphens, spaces, and the
 * Crockford confusables (I and L read as 1, O reads as 0).
 */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/** Codes are stored hashed. SHA-256 is right here: high-entropy input, and the
 *  lookup must be a primary-key hit rather than a scan over argon2 verifies. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Group as XXXX-XXXX purely for legibility; normalizeCode strips it again. */
function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The origin a paired app should call. Prefers explicit configuration, falls
 * back to what the reverse proxy reports — self-hosters who never set
 * PUBLIC_BASE_URL still get a working link.
 */
function publicOrigin(req: { protocol: string; get(h: string): string | undefined }): string {
  const configured = env.PUBLIC_BASE_URL ?? env.TWILIO_WEBHOOK_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const host = req.get('host') ?? 'localhost';
  return `${req.protocol}://${host}`;
}

/** Per-IP hourly guard. The claim route has no user, so rate_limit_state
 *  (which has an FK to users) cannot be reused. */
function tooManyAttempts(clientKey: string): boolean {
  const windowStart = new Date().toISOString().slice(0, 13);
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
    return count > CLAIM_ATTEMPT_LIMIT;
  } catch (err) {
    // Fail CLOSED — unlike ordinary rate limiting, this one guards an
    // unauthenticated credential-issuing endpoint. A metering bug must not
    // turn into an unmetered guessing oracle.
    log.error({ err, clientKey }, 'pair attempt metering failed; refusing claim');
    return true;
  }
}

/**
 * POST /api/pair/code — mint a pairing code. Dashboard only.
 *
 * Deliberately refuses device secrets: a compromised install must not be able
 * to enrol further installs.
 */
pairRouter.post('/api/pair/code', requireAuth, async (req, res) => {
  if (req.user!.deviceId !== undefined) {
    res.status(403).json({
      error: 'device_cannot_mint',
      message: 'Pairing codes can only be created from the dashboard, not from a paired device.',
    });
    return;
  }

  const parsed = z.object({ label: z.string().trim().max(40).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', message: 'label must be 40 characters or fewer' });
    return;
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  const db = getDb();

  db.transaction(() => {
    db.prepare("DELETE FROM pairing_codes WHERE expires_at < datetime('now')").run();
    db.prepare(
      `INSERT INTO pairing_codes (code_hash, user_id, label, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(hashCode(code), req.user!.id, parsed.data.label ?? null, expiresAt);
  })();

  const origin = publicOrigin(req);
  log.info({ userId: req.user!.id }, 'pairing code minted');

  res.json({
    code: formatCode(code),
    // What the QR encodes and what the app parses. Origin = which server,
    // path = which code.
    url: `${origin}/p/${code}`,
    server: origin,
    expires_at: expiresAt,
    expires_in: CODE_TTL_SECONDS,
  });
});

/**
 * POST /api/pair/claim — redeem a code for a device secret. UNAUTHENTICATED
 * by necessity: the caller has no credential yet, which is what it is here to
 * fix. Guarded by the per-IP attempt limiter above.
 */
pairRouter.post('/api/pair/claim', async (req, res) => {
  const clientKey = req.ip ?? 'unknown';
  if (tooManyAttempts(clientKey)) {
    res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many pairing attempts. Wait an hour, then generate a fresh code.',
    });
    return;
  }

  const parsed = z
    .object({
      code: z.string().min(1).max(64),
      device_name: z.string().trim().min(1).max(40).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', message: 'code is required' });
    return;
  }

  const code = normalizeCode(parsed.data.code);
  if (code.length !== CODE_LENGTH) {
    res.status(400).json({
      error: 'invalid_code',
      message: `A pairing code is ${CODE_LENGTH} characters.`,
    });
    return;
  }

  const db = getDb();
  // Read and burn in ONE transaction, so two apps racing the same code cannot
  // both walk away with a credential.
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT code_hash, user_id, label, expires_at, used_at
           FROM pairing_codes WHERE code_hash = ?`,
      )
      .get(hashCode(code)) as
      | { code_hash: string; user_id: number; label: string | null; expires_at: string; used_at: string | null }
      | undefined;
    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    db.prepare("UPDATE pairing_codes SET used_at = datetime('now') WHERE code_hash = ?").run(row.code_hash);
    return row;
  })();

  if (!claim) {
    // One message for missing, expired, and already-used. Distinguishing them
    // would tell a guesser which codes exist.
    res.status(400).json({
      error: 'invalid_code',
      message: 'That pairing code is not valid, has expired, or was already used. Generate a fresh one.',
    });
    return;
  }

  const secret = randomBytes(24).toString('base64url');
  const name = parsed.data.device_name ?? claim.label ?? 'VOX glasses';
  const hash = await hashSecret(secret);
  const info = db
    .prepare('INSERT INTO devices (user_id, name, secret_hash) VALUES (?, ?, ?)')
    .run(claim.user_id, name, hash);

  log.info({ userId: claim.user_id, deviceId: info.lastInsertRowid, name }, 'device paired');

  res.json({
    secret,
    server: publicOrigin(req),
    device_id: Number(info.lastInsertRowid),
    name,
  });
});

/** GET /api/devices — paired installs, newest first. Never returns secrets. */
pairRouter.get('/api/devices', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, name, created_at, last_seen_at
         FROM devices
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC`,
    )
    .all(req.user!.id);
  res.json({ devices: rows, current_device_id: req.user!.deviceId ?? null });
});

/** DELETE /api/devices/:id — revoke one install. Its secret stops
 *  authenticating immediately; every other device is untouched. */
pairRouter.delete('/api/devices/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_id', message: 'device id must be an integer' });
    return;
  }
  const info = getDb()
    .prepare(
      "UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .run(id, req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'not_found', message: 'no such paired device' });
    return;
  }
  log.info({ userId: req.user!.id, deviceId: id }, 'device revoked');
  res.json({ revoked: true, device_id: id });
});
