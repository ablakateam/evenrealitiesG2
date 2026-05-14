import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { normalizeE164 } from '../sms/twilio-client.js';
import { matchByName, type ContactLite } from '../contacts/match.js';

export const contactsRouter = Router();

const ContactBody = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  default_channel: z.enum(['sms', 'email', 'smart']).optional(),
  usual_tone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
});

const SearchQuery = z.object({
  q: z.string().min(1).max(100).optional(),
  favorites_only: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/contacts — paginated list with optional fuzzy search. */
contactsRouter.get('/api/contacts', requireAuth, (req, res) => {
  const q = SearchQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'invalid_query', issues: q.error.issues });
    return;
  }
  const userId = req.user!.id;
  const db = getDb();
  const where: string[] = ['user_id = @user_id'];
  const params: Record<string, unknown> = { user_id: userId, limit: q.data.limit, offset: q.data.offset };

  if (q.data.favorites_only === 'true') where.push('favorite = 1');
  if (q.data.q) {
    where.push("(name LIKE '%' || @q || '%' COLLATE NOCASE OR phone_e164 LIKE '%' || @q || '%' OR email LIKE '%' || @q || '%' COLLATE NOCASE)");
    params.q = q.data.q;
  }

  const rows = db
    .prepare(
      `SELECT id, name, phone_e164, email, default_channel, last_used_channel, usual_tone, tags_json, favorite,
              last_sent_at, created_at, updated_at
       FROM contacts WHERE ${where.join(' AND ')}
       ORDER BY favorite DESC, name COLLATE NOCASE LIMIT @limit OFFSET @offset`,
    )
    .all(params) as Array<{ tags_json: string; favorite: number } & Record<string, unknown>>;

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM contacts WHERE ${where.join(' AND ')}`).get(params) as { c: number }).c;

  res.json({
    items: rows.map(({ tags_json, favorite, ...rest }) => ({
      ...rest,
      tags: tags_json ? JSON.parse(tags_json) : [],
      favorite: Boolean(favorite),
    })),
    total,
    limit: q.data.limit,
    offset: q.data.offset,
  });
});

/** GET /api/contacts/:id */
contactsRouter.get('/api/contacts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, req.user!.id) as
    | (Record<string, unknown> & { tags_json?: string; favorite?: number })
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const { tags_json, favorite, ...rest } = row;
  res.json({ ...rest, tags: tags_json ? JSON.parse(tags_json) : [], favorite: Boolean(favorite) });
});

/** POST /api/contacts — create. Rejects when both phone+email are missing. */
contactsRouter.post('/api/contacts', requireAuth, (req, res) => {
  const parsed = ContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const { name, phone, email, default_channel, usual_tone, tags, favorite } = parsed.data;
  if (!phone && !email) {
    res.status(400).json({ error: 'unreachable', message: 'at least one of phone or email required' });
    return;
  }
  const phoneE164 = phone ? normalizeE164(phone) : null;
  if (phone && !phoneE164) {
    res.status(400).json({ error: 'invalid_phone', message: `could not parse "${phone}" as E.164` });
    return;
  }
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO contacts (user_id, name, phone_e164, email, default_channel, usual_tone, tags_json, favorite, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
    )
    .run(
      req.user!.id,
      name,
      phoneE164,
      email ?? null,
      default_channel ?? null,
      usual_tone ?? null,
      JSON.stringify(tags ?? []),
      favorite ? 1 : 0,
    );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

/** PUT /api/contacts/:id — partial update. */
const PartialBody = ContactBody.partial();
contactsRouter.put('/api/contacts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const parsed = PartialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const fields = parsed.data;
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, user_id: req.user!.id };

  if (fields.name !== undefined) {
    sets.push('name = @name');
    params.name = fields.name;
  }
  if (fields.phone !== undefined) {
    const e164 = fields.phone ? normalizeE164(fields.phone) : null;
    if (fields.phone && !e164) {
      res.status(400).json({ error: 'invalid_phone' });
      return;
    }
    sets.push('phone_e164 = @phone');
    params.phone = e164;
  }
  if (fields.email !== undefined) {
    sets.push('email = @email');
    params.email = fields.email ?? null;
  }
  if (fields.default_channel !== undefined) {
    sets.push('default_channel = @default_channel');
    params.default_channel = fields.default_channel;
  }
  if (fields.usual_tone !== undefined) {
    sets.push('usual_tone = @usual_tone');
    params.usual_tone = fields.usual_tone;
  }
  if (fields.tags !== undefined) {
    sets.push('tags_json = @tags_json');
    params.tags_json = JSON.stringify(fields.tags);
  }
  if (fields.favorite !== undefined) {
    sets.push('favorite = @favorite');
    params.favorite = fields.favorite ? 1 : 0;
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'empty_update' });
    return;
  }
  sets.push("updated_at = datetime('now')");
  const r = getDb()
    .prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = @id AND user_id = @user_id`)
    .run(params);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

/** DELETE /api/contacts/:id */
contactsRouter.delete('/api/contacts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const r = getDb().prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

/** POST /api/contacts/match — fuzzy name resolver (the HUD's recipient picker). */
const MatchBody = z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(20).default(5) });
contactsRouter.post('/api/contacts/match', requireAuth, (req, res) => {
  const parsed = MatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const rows = getDb()
    .prepare('SELECT id, name, phone_e164, email, favorite FROM contacts WHERE user_id = ?')
    .all(req.user!.id) as ContactLite[];
  const result = matchByName(rows, parsed.data.query, parsed.data.limit);
  res.json(result);
});

/** POST /api/contacts/csv — import from CSV (name, phone, email). */
const CsvBody = z.object({ csv: z.string().min(1).max(2_000_000) });
contactsRouter.post('/api/contacts/csv', requireAuth, (req, res) => {
  const parsed = CsvBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const rows = parseCsv(parsed.data.csv);
  if (rows.length === 0) {
    res.status(400).json({ error: 'empty_csv' });
    return;
  }
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO contacts (user_id, name, phone_e164, email, source, source_id, tags_json)
    VALUES (?, ?, ?, ?, 'csv', ?, '[]')
    ON CONFLICT DO NOTHING
  `);
  const txn = db.transaction((items: Array<{ name: string; phone: string | null; email: string | null }>) => {
    let inserted = 0;
    for (const row of items) {
      const phoneE164 = row.phone ? normalizeE164(row.phone) : null;
      // Skip rows without any reachable identifier
      if (!phoneE164 && !row.email) continue;
      const sourceId = phoneE164 || row.email!;
      const result = upsert.run(req.user!.id, row.name, phoneE164, row.email ?? null, sourceId);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });
  const inserted = txn(rows);
  res.json({ ok: true, parsed: rows.length, inserted });
});

/** Quick CSV parser handling quoted fields. Headers: name, phone, email (order-independent). */
interface CsvRow {
  name: string;
  phone: string | null;
  email: string | null;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = {
    name: header.indexOf('name'),
    phone: header.indexOf('phone'),
    email: header.indexOf('email'),
  };
  if (idx.name === -1) return [];
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const name = cols[idx.name]?.trim();
    if (!name) continue;
    out.push({
      name,
      phone: idx.phone >= 0 ? (cols[idx.phone]?.trim() || null) : null,
      email: idx.email >= 0 ? (cols[idx.email]?.trim() || null) : null,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}
