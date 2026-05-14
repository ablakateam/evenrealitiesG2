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

describe('GET /api/health', () => {
  it('returns 200 + status:ok without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('vox-server');
    expect(res.body.schema_version).toBeGreaterThanOrEqual(1);
    expect(res.body.user_count).toBe(1);
  });
});

describe('Auth middleware', () => {
  it('rejects /api/config without Authorization header', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('rejects /api/config with malformed Authorization header', async () => {
    const res = await request(app).get('/api/config').set('Authorization', 'NotBearer foo');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('rejects /api/config with wrong secret', async () => {
    const res = await request(app).get('/api/config').set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('accepts /api/config with correct secret', async () => {
    const res = await request(app).get('/api/config').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(1);
    expect(res.body.preferences).toBeDefined();
    expect(res.body.preferences.default_channel).toBe('sms');
    expect(res.body.preferences.default_tone).toBe('casual');
  });
});

describe('PUT /api/config', () => {
  it('rejects an invalid update body', async () => {
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ default_tone: 'not-a-tone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('rejects an empty update body', async () => {
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('empty_update');
  });

  it('persists valid partial updates and returns booleans as JS booleans', async () => {
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({
        default_tone: 'professional',
        smart_pause: true,
        max_recording_seconds: 90,
      });
    expect(res.status).toBe(200);
    expect(res.body.preferences.default_tone).toBe('professional');
    expect(res.body.preferences.smart_pause).toBe(true);
    expect(res.body.preferences.max_recording_seconds).toBe(90);

    // Verify GET returns the updated values
    const get = await request(app).get('/api/config').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(get.body.preferences.default_tone).toBe('professional');
    expect(get.body.preferences.smart_pause).toBe(true);
  });
});

describe('Crypto', () => {
  it('encrypts and decrypts strings round-trip', async () => {
    const { encryptString, decryptString } = await import('../src/crypto.js');
    const plain = 'my secret access token';
    const cipher = encryptString(plain);
    expect(cipher).not.toBe(plain);
    expect(decryptString(cipher)).toBe(plain);
  });
});

describe('Unknown route', () => {
  it('returns 404 with error code', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
