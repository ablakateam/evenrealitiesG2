import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import {
  setIntegration,
  getIntegrationCreds,
  getIntegrationView,
  credsSource,
  deleteIntegration,
  type TwilioCreds,
  type ApiKeyCreds,
} from '../src/integrations.js';

let app: Express;
const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

describe('Integration credential store', () => {
  it('encrypts + round-trips Twilio credentials', () => {
    setIntegration(1, 'twilio', {
      sid: 'ACtest1234567890',
      token: 'secret-token-abcdef',
      from_number: '+15005550006',
    });
    const creds = getIntegrationCreds(1, 'twilio') as TwilioCreds;
    expect(creds.sid).toBe('ACtest1234567890');
    expect(creds.token).toBe('secret-token-abcdef');
    expect(creds.from_number).toBe('+15005550006');

    // The stored blob must not contain the plaintext token
    const row = getDb().prepare('SELECT key_encrypted FROM integrations WHERE user_id = 1 AND provider = ?').get('twilio') as { key_encrypted: string };
    expect(row.key_encrypted).not.toContain('secret-token-abcdef');
  });

  it('encrypts + round-trips an API-key provider', () => {
    setIntegration(1, 'openai', { api_key: 'sk-openai-test-9999' });
    const creds = getIntegrationCreds(1, 'openai') as ApiKeyCreds;
    expect(creds.api_key).toBe('sk-openai-test-9999');
    expect(credsSource(1, 'openai')).toBe('db');
  });

  it('view never leaks the secret', () => {
    const view = getIntegrationView(1, 'twilio');
    const json = JSON.stringify(view);
    expect(json).not.toContain('secret-token-abcdef');
    expect(view.configured).toBe(true);
    expect(view.source).toBe('db');
    // Masked hint is exposed, full SID is not
    expect(view.metadata.sid_masked).toBeDefined();
  });

  it('reports source "none" for an unconfigured provider', () => {
    deleteIntegration(1, 'openrouter');
    delete process.env.OPENROUTER_KEY;
    expect(credsSource(1, 'openrouter')).toBe('none');
    expect(getIntegrationCreds(1, 'openrouter')).toBeNull();
  });

  it('falls back to env when no DB row exists', () => {
    deleteIntegration(1, 'ollama-cloud');
    process.env.OLLAMA_CLOUD_KEY = 'env-fallback-key';
    expect(credsSource(1, 'ollama-cloud')).toBe('env');
    const creds = getIntegrationCreds(1, 'ollama-cloud') as ApiKeyCreds;
    expect(creds.api_key).toBe('env-fallback-key');
    delete process.env.OLLAMA_CLOUD_KEY;
  });

  it('DB takes precedence over env', () => {
    process.env.ANTHROPIC_KEY = 'env-anthropic-key';
    setIntegration(1, 'anthropic', { api_key: 'db-anthropic-key' });
    expect(credsSource(1, 'anthropic')).toBe('db');
    expect((getIntegrationCreds(1, 'anthropic') as ApiKeyCreds).api_key).toBe('db-anthropic-key');
    deleteIntegration(1, 'anthropic');
    delete process.env.ANTHROPIC_KEY;
  });
});

describe('GET /api/integrations', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/integrations');
    expect(res.status).toBe(401);
  });

  it('returns a view for every provider', async () => {
    const res = await request(app).get('/api/integrations').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    const providers = (res.body.integrations as Array<{ provider: string }>).map((i) => i.provider);
    expect(providers).toEqual(
      expect.arrayContaining(['twilio', 'openai', 'anthropic', 'openrouter', 'ollama-cloud']),
    );
    // No secret material in the response
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
  });
});

describe('PUT /api/integrations', () => {
  it('rejects an invalid body', async () => {
    const res = await request(app)
      .put('/api/integrations')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'twilio', sid: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects Twilio without a sender', async () => {
    const res = await request(app)
      .put('/api/integrations')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'twilio', sid: 'ACxxxxxxxxxx', token: 'tok-xxxxxxxxxx' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('twilio_no_sender');
  });

  it('stores an API-key provider and returns a masked view', async () => {
    const res = await request(app)
      .put('/api/integrations')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'openrouter', api_key: 'or-key-1234567890abcd' });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('openrouter');
    expect(res.body.configured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('or-key-1234567890abcd');
    expect(res.body.metadata.key_masked).toBeDefined();
  });
});

describe('POST /api/integrations/:provider/test', () => {
  it('returns missing_credentials when provider has no key', async () => {
    deleteIntegration(1, 'openai');
    delete process.env.OPENAI_KEY;
    const res = await request(app)
      .post('/api/integrations/openai/test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('llm_test_failed');
  });

  it('rejects an unknown provider', async () => {
    const res = await request(app)
      .post('/api/integrations/notreal/test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_provider');
  });
});
