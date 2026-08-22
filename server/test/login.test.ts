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
const PASSWORD = 'correct-horse-battery';

describe('before a password is set', () => {
  it('reports that none is set', async () => {
    const res = await request(app).get('/api/auth/login');
    expect(res.status).toBe(200);
    expect(res.body.password_set).toBe(false);
  });

  it('refuses to log in and says why, rather than failing opaquely', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_password_set');
  });
});

describe('POST /api/account/password', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/account/password').send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects a short password', async () => {
    const res = await request(app).post('/api/account/password').set(auth()).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('sets one when authenticated', async () => {
    const res = await request(app).post('/api/account/password').set(auth()).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.password_set).toBe(true);
  });

  it('now reports that a password is set', async () => {
    const res = await request(app).get('/api/auth/login');
    expect(res.body.password_set).toBe(true);
  });

  it('never exposes the hash or the secret through the status endpoint', async () => {
    const res = await request(app).get('/api/auth/login');
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.secret).toBeUndefined();
  });
});

describe('POST /api/auth/login', () => {
  it('returns the shared secret for the right password', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.secret).toBe(BOOTSTRAP);
  });

  it('returns a secret that actually authenticates', async () => {
    const login = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    const res = await request(app)
      .get('/api/config')
      .set({ Authorization: `Bearer ${login.body.secret}` });
    expect(res.status).toBe(200);
  });

  it('rejects the wrong password without revealing anything', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'not-the-password' });
    expect(res.status).toBe(401);
    expect(res.body.secret).toBeUndefined();
  });

  it('requires a password in the body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('a paired device cannot set the dashboard password', () => {
  it('is refused with 403', async () => {
    const mint = await request(app).post('/api/pair/code').set(auth()).send({});
    const claim = await request(app).post('/api/pair/claim').send({ code: mint.body.code });
    const deviceSecret = claim.body.secret as string;

    const res = await request(app)
      .post('/api/account/password')
      .set({ Authorization: `Bearer ${deviceSecret}` })
      .send({ password: 'another-long-password' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('device_cannot_set_password');
  });
});

describe('DELETE /api/account/password', () => {
  it('removes it and restores secret-only sign-in', async () => {
    const del = await request(app).delete('/api/account/password').set(auth());
    expect(del.status).toBe(200);
    expect(del.body.password_set).toBe(false);

    const status = await request(app).get('/api/auth/login');
    expect(status.body.password_set).toBe(false);

    const login = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    expect(login.status).toBe(409);
  });

  it('leaves the shared secret working', async () => {
    const res = await request(app).get('/api/config').set(auth());
    expect(res.status).toBe(200);
  });
});

describe('rotation keeps the password usable', () => {
  it('a password set before a rotation still returns a WORKING secret after it', async () => {
    // Re-establish a password (the delete suite above removed it).
    const set = await request(app).post('/api/account/password').set(auth()).send({ password: PASSWORD });
    expect(set.status).toBe(200);

    const rotate = await request(app).post('/api/account/rotate-secret').set(auth());
    expect(rotate.status).toBe(200);
    const rotated = rotate.body.secret as string;

    const login = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    expect(login.status).toBe(200);
    // The important part: not just that login succeeds, but that what it hands
    // back is the CURRENT secret and actually authenticates.
    expect(login.body.secret).toBe(rotated);

    const use = await request(app)
      .get('/api/config')
      .set({ Authorization: `Bearer ${login.body.secret}` });
    expect(use.status).toBe(200);
  });
});
