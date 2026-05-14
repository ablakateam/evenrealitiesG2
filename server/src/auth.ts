import argon2 from 'argon2';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './db.js';
import { env } from './env.js';
import { log } from './log.js';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface AuthenticatedUser {
  id: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Hash a plaintext shared secret with argon2id. */
export async function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/** Verify a plaintext shared secret against a stored hash. */
export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch (err) {
    log.warn({ err }, 'argon2 verify threw');
    return false;
  }
}

/** Ensure a user row exists. If none, seed from BOOTSTRAP_SECRET. */
export async function ensureUserExists(): Promise<void> {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (existing.c > 0) return;

  if (!env.BOOTSTRAP_SECRET) {
    log.warn(
      'no users in DB and no BOOTSTRAP_SECRET set; auth-gated routes will reject all requests until you seed a user',
    );
    return;
  }
  const hash = await hashSecret(env.BOOTSTRAP_SECRET);
  db.prepare('INSERT INTO users (id, shared_secret_hash) VALUES (1, ?)').run(hash);
  db.prepare('INSERT INTO preferences (user_id) VALUES (1)').run();
  const { seedDefaultTemplates } = await import('./routes/templates.js');
  seedDefaultTemplates(1);
  log.info('seeded user #1 from BOOTSTRAP_SECRET — rotate via the dashboard once paired');
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

/** Express middleware: require a valid shared-secret Bearer token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <secret> required' });
    return;
  }
  const db = getDb();
  const rows = db
    .prepare('SELECT id, shared_secret_hash FROM users')
    .all() as { id: number; shared_secret_hash: string }[];
  for (const row of rows) {
    if (await verifySecret(token, row.shared_secret_hash)) {
      req.user = { id: row.id };
      next();
      return;
    }
  }
  res.status(401).json({ error: 'invalid_token', message: 'shared secret does not match any user' });
}
