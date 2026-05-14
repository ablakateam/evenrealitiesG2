import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import twilio from 'twilio';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { normalizeE164 } from '../src/sms/twilio-client.js';
import { sanitizeForHud } from '../src/sms/sanitize.js';

let app: Express;
const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

describe('normalizeE164', () => {
  it('passes through already-E.164 numbers', () => {
    expect(normalizeE164('+14155550142')).toBe('+14155550142');
  });
  it('adds +1 for 10-digit US numbers', () => {
    expect(normalizeE164('4155550142')).toBe('+14155550142');
    expect(normalizeE164('(415) 555-0142')).toBe('+14155550142');
  });
  it('handles 11-digit US with leading 1', () => {
    expect(normalizeE164('14155550142')).toBe('+14155550142');
  });
  it('returns null for nonsense input', () => {
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164('hi')).toBeNull();
  });
});

describe('sanitizeForHud', () => {
  it('maps common emoji to ASCII', () => {
    expect(sanitizeForHud('thanks ❤️ for the help')).toBe('thanks <3 for the help');
    expect(sanitizeForHud('great work 👍')).toBe('great work +1');
  });
  it('normalizes smart quotes', () => {
    expect(sanitizeForHud('“Hello,” she said')).toBe('"Hello," she said');
  });
  it('strips accents (G2 font lacks them)', () => {
    expect(sanitizeForHud('café résumé')).toBe('cafe resume');
  });
  it('preserves the card-suit heart that IS in the G2 font', () => {
    expect(sanitizeForHud('I ♥ you')).toBe('I ♥ you');
  });
  it('strips control characters', () => {
    expect(sanitizeForHud('hello\x01world')).toBe('helloworld');
  });
  it('truncates very long bodies', () => {
    const long = 'x'.repeat(500);
    expect(sanitizeForHud(long).length).toBeLessThanOrEqual(200);
    expect(sanitizeForHud(long)).toMatch(/…$/);
  });
});

describe('POST /api/sms', () => {
  it('rejects without auth', async () => {
    const res = await request(app).post('/api/sms').send({ to: '+14155550142', body: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects invalid body', async () => {
    const res = await request(app)
      .post('/api/sms')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ to: '+14155550142' }); // missing body
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('rejects invalid to_number', async () => {
    const res = await request(app)
      .post('/api/sms')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ to: 'not-a-number', body: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_to_number');
  });

  it('returns 400 missing_credentials when TWILIO is unset', async () => {
    delete process.env.TWILIO_SID;
    delete process.env.TWILIO_TOKEN;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_FROM_NUMBER;
    // Credentials resolve DB-first now — clear any DB row too.
    const { deleteIntegration } = await import('../src/integrations.js');
    deleteIntegration(1, 'twilio');
    const res = await request(app)
      .post('/api/sms')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ to: '+14155550142', body: 'hi from test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_credentials');
    expect(res.body.status).toBe('failed');
  });
});

describe('Twilio webhook signature', () => {
  // Webhook signature verification resolves the auth token from the Twilio
  // integration row (DB-first). Store a known token for these tests.
  const TEST_TOKEN = 'fake-token-for-test';
  beforeAll(async () => {
    const { setIntegration } = await import('../src/integrations.js');
    setIntegration(1, 'twilio', {
      sid: 'ACtest0000000000',
      token: TEST_TOKEN,
      from_number: '+15005550006',
    });
  });

  it('rejects inbound webhook without signature header', async () => {
    const res = await request(app)
      .post('/webhooks/twilio/inbound')
      .type('form')
      .send({ From: '+14155550142', To: '+15005550006', Body: 'hi', MessageSid: 'SM1' });
    expect(res.status).toBe(403);
  });

  it('accepts inbound webhook with valid signature', async () => {
    const params = { From: '+14155550142', To: '+15005550006', Body: 'hello world', MessageSid: 'SMtest' };
    const url = 'https://test.example.com/webhooks/twilio/inbound';
    const signature = twilio.getExpectedTwilioSignature(TEST_TOKEN, url, params);

    const res = await request(app)
      .post('/webhooks/twilio/inbound')
      .set('x-twilio-signature', signature)
      .type('form')
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Response');

    // Verify it landed in inbox
    const row = getDb()
      .prepare('SELECT from_address, body FROM inbox WHERE raw_payload_json LIKE ?')
      .get('%SMtest%') as { from_address: string; body: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.from_address).toBe('+14155550142');
    expect(row?.body).toBe('hello world');
  });
});

describe('POST /webhooks/twilio/status', () => {
  it('rejects without valid signature', async () => {
    const res = await request(app)
      .post('/webhooks/twilio/status')
      .type('form')
      .send({ MessageSid: 'SMtest', MessageStatus: 'delivered' });
    expect(res.status).toBe(403);
  });
});
