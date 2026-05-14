import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { validateModel } from '../src/llm/models.js';
import { LlmError } from '../src/llm/provider.js';
import { createProvider } from '../src/llm/factory.js';

let app: Express;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

describe('GET /api/llm/models', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/llm/models');
    expect(res.status).toBe(401);
  });

  it('returns the full provider catalog when authenticated', async () => {
    const res = await request(app).get('/api/llm/models').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.catalog).toBeDefined();
    const providers = Object.keys(res.body.catalog);
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toContain('openrouter');
    expect(providers).toContain('ollama-cloud');
    expect(res.body.catalog.anthropic.default).toBe('claude-haiku-4-5');
    expect(res.body.catalog.openai.default).toBe('gpt-4o-mini');
    expect(Array.isArray(res.body.configured_providers)).toBe(true);
  });

  it('exposes speed glyphs in each model entry', async () => {
    const res = await request(app).get('/api/llm/models').set('Authorization', `Bearer ${BOOTSTRAP}`);
    for (const provider of Object.keys(res.body.catalog)) {
      for (const model of res.body.catalog[provider].models) {
        expect(['fast', 'balanced', 'slow']).toContain(model.speed);
        expect(typeof model.id).toBe('string');
      }
    }
  });
});

describe('Model validation', () => {
  it('accepts a known anthropic model', () => {
    expect(validateModel('anthropic', 'claude-haiku-4-5')).toBeNull();
  });

  it('rejects an unknown anthropic model', () => {
    const err = validateModel('anthropic', 'claude-fake-1000');
    expect(err).not.toBeNull();
    expect(err).toContain('not in anthropic catalog');
  });

  it('allows custom openrouter models (allowCustom: true)', () => {
    expect(validateModel('openrouter', 'some-custom/model-id')).toBeNull();
  });

  it('allows custom ollama-cloud models (allowCustom: true)', () => {
    expect(validateModel('ollama-cloud', 'custom-model:7b')).toBeNull();
  });
});

describe('Provider factory', () => {
  it('throws missing_credentials when no key in DB or env', () => {
    delete process.env.ANTHROPIC_KEY;
    expect(() => createProvider('anthropic', 1)).toThrow(LlmError);
    try {
      createProvider('anthropic', 1);
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const e = err as LlmError;
      expect(e.code).toBe('missing_credentials');
      expect(e.provider).toBe('anthropic');
    }
  });

  it('throws missing_credentials for openai when unconfigured', () => {
    delete process.env.OPENAI_KEY;
    expect(() => createProvider('openai', 1)).toThrow(LlmError);
  });

  it('resolves a provider once credentials are stored in the DB', async () => {
    const { setIntegration } = await import('../src/integrations.js');
    setIntegration(1, 'anthropic', { api_key: 'sk-ant-test-key-1234567890' });
    const provider = createProvider('anthropic', 1);
    expect(provider.name).toBe('anthropic');
    const { deleteIntegration } = await import('../src/integrations.js');
    deleteIntegration(1, 'anthropic');
  });
});

describe('POST /api/llm/test', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/llm/test').send({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(res.status).toBe(401);
  });

  it('rejects invalid provider', async () => {
    const res = await request(app)
      .post('/api/llm/test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'not-a-provider', model: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('rejects unknown anthropic model', async () => {
    const res = await request(app)
      .post('/api/llm/test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'anthropic', model: 'claude-fake' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_model');
  });

  it('returns 400 missing_credentials when no key is configured', async () => {
    delete process.env.ANTHROPIC_KEY;
    const res = await request(app)
      .post('/api/llm/test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_credentials');
    expect(res.body.provider).toBe('anthropic');
  });
});
