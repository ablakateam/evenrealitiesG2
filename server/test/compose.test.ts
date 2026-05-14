import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { wrapPcmAsWav } from '../src/audio/wav.js';
import {
  ALL_TONES,
  REWRITE_TONES,
  buildRewriteSystemPrompt,
  buildIntentSystemPrompt,
} from '../src/prompts.js';

let app: Express;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

describe('wrapPcmAsWav', () => {
  it('prepends a 44-byte WAV header to PCM data', () => {
    const pcm = Buffer.alloc(100, 0xa5);
    const wav = wrapPcmAsWav(pcm);
    expect(wav.length).toBe(44 + 100);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // channels
  });

  it('respects custom sample rate', () => {
    const wav = wrapPcmAsWav(Buffer.alloc(0), { sampleRate: 44100 });
    expect(wav.readUInt32LE(24)).toBe(44100);
  });
});

describe('Prompt builders', () => {
  it('builds a casual SMS prompt with length constraint', () => {
    const p = buildRewriteSystemPrompt({ tone: 'casual', channel: 'sms' });
    expect(p).toContain('casual');
    expect(p).toContain('160 characters');
    expect(p).not.toContain('email');
  });

  it('builds an email prompt without the SMS length hint', () => {
    const p = buildRewriteSystemPrompt({ tone: 'professional', channel: 'email' });
    expect(p).toContain('professional');
    expect(p).toContain('email');
    expect(p).not.toContain('160 characters');
  });

  it('pins output language when non-English', () => {
    const p = buildRewriteSystemPrompt({ tone: 'casual', channel: 'sms', language: 'es' });
    expect(p).toContain('Output language: es');
    expect(p).toContain('do not translate');
  });

  it('skips language pin for English', () => {
    const p = buildRewriteSystemPrompt({ tone: 'casual', channel: 'sms', language: 'en' });
    expect(p).not.toContain('Output language');
  });

  it('intent prompt includes contacts list as JSON', () => {
    const contacts = [{ id: 1, name: 'Alex Morgan', phone: '+14155550142', email: null }];
    const p = buildIntentSystemPrompt({ contacts, defaultChannel: 'sms' });
    expect(p).toContain('STRICT JSON');
    expect(p).toContain('Alex Morgan');
    expect(p).toContain('sms');
  });

  it('exports 7 tones total, 6 rewrite tones', () => {
    expect(ALL_TONES.length).toBe(7);
    expect(REWRITE_TONES.length).toBe(6);
    expect(ALL_TONES).toContain('original');
    expect(REWRITE_TONES).not.toContain('original' as never);
  });
});

describe('POST /api/stt', () => {
  it('rejects without auth', async () => {
    const res = await request(app).post('/api/stt');
    expect(res.status).toBe(401);
  });

  it('rejects when audio field is missing', async () => {
    const res = await request(app).post('/api/stt').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('audio_missing');
  });
});

describe('POST /api/compose (JSON / no audio)', () => {
  it('rejects when transcription is empty', async () => {
    const res = await request(app)
      .post('/api/compose')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ transcription: '' });
    expect(res.status).toBe(400);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .post('/api/compose')
      .set('Content-Type', 'application/json')
      .send({ transcription: 'hello world' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/parse', () => {
  it('validates body shape', async () => {
    const res = await request(app)
      .post('/api/parse')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});

describe('POST /api/rewrite', () => {
  it('validates body shape', async () => {
    const res = await request(app)
      .post('/api/rewrite')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ text: 'hi', tone: 'not-a-tone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});
