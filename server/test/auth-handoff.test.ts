import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { getDb, closeDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';

let app: Express;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;
const auth = () => ({ Authorization: `Bearer ${BOOTSTRAP}` });

async function mint(): Promise<string> {
  const res = await request(app).post('/api/auth/handoff').set(auth()).send({});
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('POST /api/auth/handoff', () => {
  it('requires the shared secret to mint', async () => {
    const res = await request(app).post('/api/auth/handoff').send({});
    expect(res.status).toBe(401);
  });

  it('returns a token with a short TTL', async () => {
    const res = await request(app).post('/api/auth/handoff').set(auth()).send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(30);
    expect(res.body.expires_in).toBeLessThanOrEqual(300);
  });

  it('never stores the token in plaintext', async () => {
    const token = await mint();
    const row = getDb()
      .prepare('SELECT token_hash, secret_encrypted FROM auth_handoffs WHERE token_hash != ?')
      .all('') as Array<{ token_hash: string; secret_encrypted: string }>;
    // No stored column may contain the raw token or the raw secret.
    for (const r of row) {
      expect(r.token_hash).not.toBe(token);
      expect(r.secret_encrypted).not.toContain(BOOTSTRAP);
    }
  });
});

describe('POST /api/auth/handoff/exchange', () => {
  it('trades a fresh token for the shared secret', async () => {
    const token = await mint();
    const res = await request(app).post('/api/auth/handoff/exchange').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.secret).toBe(BOOTSTRAP);
  });

  it('burns the token — a second exchange fails', async () => {
    const token = await mint();
    const first = await request(app).post('/api/auth/handoff/exchange').send({ token });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/handoff/exchange').send({ token });
    expect(second.status).toBe(401);
    expect(second.body.error).toBe('invalid_token');
    expect(second.body.secret).toBeUndefined();
  });

  it('rejects an unknown token', async () => {
    const res = await request(app)
      .post('/api/auth/handoff/exchange')
      .send({ token: 'a'.repeat(43) });
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await mint();
    // Age the row past its TTL rather than sleeping.
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    getDb()
      .prepare('UPDATE auth_handoffs SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1000).toISOString(), hash);

    const res = await request(app).post('/api/auth/handoff/exchange').send({ token });
    expect(res.status).toBe(401);
  });

  it('only one of two racing exchanges can win', async () => {
    const token = await mint();
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/handoff/exchange').send({ token }),
      request(app).post('/api/auth/handoff/exchange').send({ token }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
  });
});
