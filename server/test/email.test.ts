import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import {
  upsertEmailAccount,
  getEmailAccount,
  decryptCreds,
  toView,
  deleteEmailAccount,
} from '../src/mail/account.js';
import { inboxBus } from '../src/mail/sse-bus.js';

let app: Express;
const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

describe('Email account encryption + storage', () => {
  it('encrypts and round-trips a password', () => {
    upsertEmailAccount(1, {
      provider: 'custom',
      email_address: 'test@example.com',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_security: 'starttls',
      imap_host: 'imap.example.com',
      imap_port: 993,
      imap_security: 'ssl',
      username: 'test@example.com',
      password: 'super-secret-pw',
    });
    const row = getEmailAccount(1)!;
    expect(row.password_encrypted).toBeDefined();
    expect(row.password_encrypted).not.toContain('super-secret-pw');
    const creds = decryptCreds(row);
    expect(creds.smtp.password).toBe('super-secret-pw');
    expect(creds.imap.password).toBe('super-secret-pw');
  });

  it('toView() does not leak secrets', () => {
    const row = getEmailAccount(1)!;
    const view = toView(row);
    const json = JSON.stringify(view);
    expect(json).not.toContain('super-secret-pw');
    expect(json).not.toContain('password_encrypted');
    expect(json).not.toContain('oauth_refresh_token');
    expect(view.has_password).toBe(true);
    expect(view.has_oauth).toBe(false);
  });

  it('applies provider defaults for gmail when host fields omitted', () => {
    upsertEmailAccount(1, {
      provider: 'gmail',
      email_address: 'dan@gmail.com',
      password: 'app-password-here',
    });
    const row = getEmailAccount(1)!;
    expect(row.smtp_host).toBe('smtp.gmail.com');
    expect(row.imap_host).toBe('imap.gmail.com');
    expect(row.smtp_port).toBe(465);
    expect(row.imap_port).toBe(993);
  });
});

describe('GET /api/email-account', () => {
  it('returns 404 when not configured', async () => {
    deleteEmailAccount(1);
    const res = await request(app).get('/api/email-account').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_configured');
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/email-account');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/email-account', () => {
  it('rejects invalid body', async () => {
    const res = await request(app)
      .put('/api/email-account')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ provider: 'not-real' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});

describe('POST /api/email', () => {
  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/email')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ to: 'dan@gmail.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('rejects when no email account configured', async () => {
    deleteEmailAccount(1);
    const res = await request(app)
      .post('/api/email')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ to: 'dan@gmail.com', subject: 'hi', body: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_email_account');
  });
});

describe('GET /api/inbox', () => {
  it('returns items + unread_count', async () => {
    // Seed one inbox row
    getDb().prepare(
      `INSERT INTO inbox (user_id, channel, from_address, body, subject, received_at)
       VALUES (?, 'email', 'sender@example.com', 'hello body', 'hello subject', datetime('now'))`,
    ).run(1);
    const res = await request(app).get('/api/inbox').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.unread_count).toBe('number');
  });

  it('filters by unread=true', async () => {
    const res = await request(app)
      .get('/api/inbox?unread=true')
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items as { read_at: string | null }[]) {
      expect(item.read_at).toBeNull();
    }
  });
});

describe('POST /api/inbox/:id/read', () => {
  it('marks an item read and publishes an SSE event', async () => {
    const ins = getDb().prepare(
      `INSERT INTO inbox (user_id, channel, from_address, body, received_at)
       VALUES (?, 'sms', '+14155550142', 'hi from sms', datetime('now'))`,
    ).run(1);
    const id = Number(ins.lastInsertRowid);

    const received: unknown[] = [];
    const unsub = inboxBus.subscribe(1, (event) => received.push(event));

    const res = await request(app)
      .post(`/api/inbox/${id}/read`)
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Idempotency: marking already-read returns ok with already_read flag
    const again = await request(app)
      .post(`/api/inbox/${id}/read`)
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(again.status).toBe(200);
    expect(again.body.already_read).toBe(true);

    unsub();
    expect(received.some((e) => (e as { kind: string }).kind === 'read')).toBe(true);
  });
});

describe('SSE bus', () => {
  it('routes events to the right user-keyed listener', () => {
    const calls: unknown[] = [];
    const off = inboxBus.subscribe(42, (e) => calls.push(e));
    inboxBus.publishRead(42, 7);
    inboxBus.publishRead(99, 8); // different user — should not be received
    off();
    expect(calls.length).toBe(1);
    expect((calls[0] as { kind: string }).kind).toBe('read');
    expect((calls[0] as { inbox_id: number }).inbox_id).toBe(7);
  });
});
