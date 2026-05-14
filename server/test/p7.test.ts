import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initCrypto } from '../src/crypto.js';
import { closeDb, getDb } from '../src/db.js';
import { ensureUserExists } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { matchByName } from '../src/contacts/match.js';

let app: Express;
const BOOTSTRAP = process.env.BOOTSTRAP_SECRET!;

beforeAll(async () => {
  await initCrypto();
  closeDb();
  getDb();
  await ensureUserExists();
  app = buildApp();
});

describe('matchByName', () => {
  const contacts = [
    { id: 1, name: 'Alex Morgan', phone_e164: '+14155550142', email: null, favorite: 1 },
    { id: 2, name: 'Sarah Chen', phone_e164: null, email: 'sarah@chen.dev', favorite: 0 },
    { id: 3, name: 'Alex Chen', phone_e164: '+14155550199', email: null, favorite: 0 },
    { id: 4, name: 'Mom', phone_e164: '+14155550100', email: null, favorite: 1 },
  ];

  it('returns exact first-name match', () => {
    const r = matchByName(contacts, 'mom');
    expect(r.exact.length).toBe(1);
    expect(r.exact[0]!.name).toBe('Mom');
  });

  it('ranks favorites higher among ties', () => {
    const r = matchByName(contacts, 'alex');
    expect(r.ranked.length).toBe(2);
    expect(r.ranked[0]!.contact.name).toBe('Alex Morgan'); // favorite=1 wins
    expect(r.ranked[1]!.contact.name).toBe('Alex Chen');
  });

  it('returns partial matches for last-name only', () => {
    const r = matchByName(contacts, 'chen');
    expect(r.ranked.some((x) => x.contact.name === 'Sarah Chen')).toBe(true);
    expect(r.ranked.some((x) => x.contact.name === 'Alex Chen')).toBe(true);
  });

  it('returns no matches for unrelated query', () => {
    const r = matchByName(contacts, 'zorgblat');
    expect(r.ranked.length).toBe(0);
  });
});

describe('Contacts CRUD', () => {
  it('rejects creating a contact with neither phone nor email', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ name: 'Empty' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unreachable');
  });

  it('creates a contact with E.164 normalization', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ name: 'Test Contact', phone: '(415) 555-9876' });
    expect(res.status).toBe(201);
    const id = res.body.id;

    const get = await request(app).get(`/api/contacts/${id}`).set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(get.status).toBe(200);
    expect(get.body.name).toBe('Test Contact');
    expect(get.body.phone_e164).toBe('+14155559876');
    expect(get.body.favorite).toBe(false);
    expect(get.body.tags).toEqual([]);
  });

  it('lists contacts paginated', async () => {
    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('searches by query string', async () => {
    const res = await request(app)
      .get('/api/contacts?q=Test')
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].name.toLowerCase()).toContain('test');
  });

  it('PUT updates a contact, fuzzy match resolves it', async () => {
    // Create and then update
    const created = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ name: 'Alex Fuzzy', phone: '+14155550000' });
    const id = created.body.id;
    const updated = await request(app)
      .put(`/api/contacts/${id}`)
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ favorite: true });
    expect(updated.status).toBe(200);

    const match = await request(app)
      .post('/api/contacts/match')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ query: 'alex' });
    expect(match.status).toBe(200);
    expect(match.body.ranked.length).toBeGreaterThan(0);
  });
});

describe('CSV import', () => {
  it('parses a simple CSV with name/phone/email columns', async () => {
    const csv = [
      'name,phone,email',
      '"Jane Doe","415-555-0001","jane@example.com"',
      '"John Doe","",john@example.com',
      'No Reach,,', // skip — no phone, no email
    ].join('\n');
    const res = await request(app)
      .post('/api/contacts/csv')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toBe(3);
    expect(res.body.inserted).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty CSV body', async () => {
    const res = await request(app)
      .post('/api/contacts/csv')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ csv: '' });
    expect(res.status).toBe(400);
  });
});

describe('Templates CRUD', () => {
  it('lists seeded templates (12 defaults)', async () => {
    const res = await request(app).get('/api/templates').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(12);
    expect(res.body.items[0].sort_order).toBeLessThanOrEqual(res.body.items[1].sort_order);
  });

  it('creates, updates, reorders, deletes', async () => {
    const create = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ label: 'Test phrase', body: 'This is a test phrase.' });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const update = await request(app)
      .put(`/api/templates/${id}`)
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ label: 'Test phrase v2' });
    expect(update.status).toBe(200);

    const list = await request(app).get('/api/templates').set('Authorization', `Bearer ${BOOTSTRAP}`);
    const ids = (list.body.items as Array<{ id: number }>).map((t) => t.id);
    const reorder = await request(app)
      .post('/api/templates/reorder')
      .set('Authorization', `Bearer ${BOOTSTRAP}`)
      .send({ order: ids.reverse() });
    expect(reorder.status).toBe(200);

    const del = await request(app)
      .delete(`/api/templates/${id}`)
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(del.status).toBe(200);
  });
});

describe('History', () => {
  it('returns paginated history with filters', async () => {
    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('returns stats roll-up', async () => {
    const res = await request(app).get('/api/history/stats').set('Authorization', `Bearer ${BOOTSTRAP}`);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBeDefined();
    expect(res.body.received).toBeDefined();
    expect(typeof res.body.sent.total).toBe('number');
  });
});
