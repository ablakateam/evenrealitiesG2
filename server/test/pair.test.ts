import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { getDb, closeDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { normalizeCode } from '../src/routes/pair.js';

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

async function mintCode(label?: string): Promise<{ code: string; url: string }> {
  const res = await request(app).post('/api/pair/code').set(auth()).send(label ? { label } : {});
  expect(res.status).toBe(200);
  return { code: res.body.code as string, url: res.body.url as string };
}

describe('normalizeCode', () => {
  it('accepts what a human types — case, hyphens, spaces', () => {
    expect(normalizeCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeCode('ABCD 2345')).toBe('ABCD2345');
  });

  it('maps Crockford confusables so a misread code still works', () => {
    // I and L read as 1; O reads as 0.
    expect(normalizeCode('IIII-OOOO')).toBe('11110000');
    expect(normalizeCode('llll-oooo')).toBe('11110000');
  });
});

describe('POST /api/pair/code', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/pair/code').send({});
    expect(res.status).toBe(401);
  });

  it('returns a code plus the URL an unpaired app can parse', async () => {
    const res = await request(app).post('/api/pair/code').set(auth()).send({});
    expect(res.status).toBe(200);
    // Grouped for legibility, 8 significant characters.
    expect(res.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // The URL must carry BOTH halves: which server, and which code.
    expect(res.body.url).toMatch(/^https?:\/\/.+\/p\/[0-9A-Z]{8}$/);
    expect(res.body.server).toBeTruthy();
    expect(res.body.expires_in).toBeLessThanOrEqual(600);
  });

  it('rejects an over-long label', async () => {
    const res = await request(app).post('/api/pair/code').set(auth()).send({ label: 'x'.repeat(41) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/pair/claim', () => {
  it('issues a device secret for a valid code', async () => {
    const { code } = await mintCode();
    const res = await request(app).post('/api/pair/claim').send({ code, device_name: 'Test glasses' });
    expect(res.status).toBe(200);
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret.length).toBeGreaterThan(30);
    expect(res.body.server).toBeTruthy();
    expect(res.body.name).toBe('Test glasses');
  });

  it('issues a secret that actually authenticates', async () => {
    const { code } = await mintCode();
    const claim = await request(app).post('/api/pair/claim').send({ code });
    const deviceSecret = claim.body.secret as string;

    const res = await request(app)
      .get('/api/config')
      .set({ Authorization: `Bearer ${deviceSecret}` });
    expect(res.status).toBe(200);
  });

  it('burns the code — a second claim fails', async () => {
    const { code } = await mintCode();
    const first = await request(app).post('/api/pair/claim').send({ code });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/pair/claim').send({ code });
    expect(second.status).toBe(400);
  });

  it('rejects an unknown code with the same message as a used one', async () => {
    const res = await request(app).post('/api/pair/claim').send({ code: 'ZZZZ-ZZZZ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_code');
  });

  it('rejects a wrong-length code', async () => {
    const res = await request(app).post('/api/pair/claim').send({ code: 'ABC' });
    expect(res.status).toBe(400);
  });

  it('accepts the code lowercase and unhyphenated', async () => {
    const { code } = await mintCode();
    const res = await request(app).post('/api/pair/claim').send({ code: code.replace('-', '').toLowerCase() });
    expect(res.status).toBe(200);
  });
});

describe('device secrets are deliberately weaker than the user secret', () => {
  it('a paired device cannot mint further pairing codes', async () => {
    const { code } = await mintCode();
    const claim = await request(app).post('/api/pair/claim').send({ code });
    const deviceSecret = claim.body.secret as string;

    const res = await request(app)
      .post('/api/pair/code')
      .set({ Authorization: `Bearer ${deviceSecret}` })
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('device_cannot_mint');
  });
});

describe('device lifecycle', () => {
  it('lists paired devices without ever exposing a secret', async () => {
    const { code } = await mintCode();
    await request(app).post('/api/pair/claim').send({ code, device_name: 'Listed device' });

    const res = await request(app).get('/api/devices').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices.length).toBeGreaterThan(0);
    for (const d of res.body.devices) {
      expect(d.secret_hash).toBeUndefined();
      expect(d.secret).toBeUndefined();
    }
  });

  it('revoking a device stops its secret from authenticating', async () => {
    const { code } = await mintCode();
    const claim = await request(app).post('/api/pair/claim').send({ code, device_name: 'Doomed' });
    const deviceSecret = claim.body.secret as string;
    const deviceId = claim.body.device_id as number;

    const before = await request(app).get('/api/config').set({ Authorization: `Bearer ${deviceSecret}` });
    expect(before.status).toBe(200);

    const revoke = await request(app).delete(`/api/devices/${deviceId}`).set(auth());
    expect(revoke.status).toBe(200);

    const after = await request(app).get('/api/config').set({ Authorization: `Bearer ${deviceSecret}` });
    expect(after.status).toBe(401);
  });

  it('revoking one device leaves the others working', async () => {
    const a = await mintCode();
    const claimA = await request(app).post('/api/pair/claim').send({ code: a.code, device_name: 'Keeper' });
    const b = await mintCode();
    const claimB = await request(app).post('/api/pair/claim').send({ code: b.code, device_name: 'Goner' });

    await request(app).delete(`/api/devices/${claimB.body.device_id}`).set(auth());

    const survivor = await request(app)
      .get('/api/config')
      .set({ Authorization: `Bearer ${claimA.body.secret}` });
    expect(survivor.status).toBe(200);
  });

  it('cannot revoke a device that does not exist', async () => {
    const res = await request(app).delete('/api/devices/999999').set(auth());
    expect(res.status).toBe(404);
  });

  it('the user shared secret still authenticates alongside device secrets', async () => {
    const res = await request(app).get('/api/config').set(auth());
    expect(res.status).toBe(200);
  });
});
