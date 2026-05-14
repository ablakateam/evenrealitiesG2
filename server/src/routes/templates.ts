import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';

export const templatesRouter = Router();

const TemplateBody = z.object({
  label: z.string().min(1).max(60),
  body: z.string().min(1).max(2000),
});

const ReorderBody = z.object({
  order: z.array(z.number().int().positive()).min(1).max(200),
});

/** GET /api/templates — sorted by sort_order. */
templatesRouter.get('/api/templates', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(
      'SELECT id, label, body, sort_order FROM templates WHERE user_id = ? ORDER BY sort_order, id',
    )
    .all(req.user!.id);
  res.json({ items: rows });
});

/** POST /api/templates — append to the end. */
templatesRouter.post('/api/templates', requireAuth, (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const db = getDb();
  const max = (db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM templates WHERE user_id = ?')
    .get(req.user!.id) as { m: number }).m;
  const r = db
    .prepare('INSERT INTO templates (user_id, label, body, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.user!.id, parsed.data.label, parsed.data.body, max + 1);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/** PUT /api/templates/:id — partial update of label or body. */
const PartialBody = TemplateBody.partial();
templatesRouter.put('/api/templates/:id', requireAuth, (req, res) => {
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
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, user_id: req.user!.id };
  if (parsed.data.label !== undefined) {
    sets.push('label = @label');
    params.label = parsed.data.label;
  }
  if (parsed.data.body !== undefined) {
    sets.push('body = @body');
    params.body = parsed.data.body;
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'empty_update' });
    return;
  }
  sets.push("updated_at = datetime('now')");
  const r = getDb()
    .prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = @id AND user_id = @user_id`)
    .run(params);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

/** DELETE /api/templates/:id */
templatesRouter.delete('/api/templates/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const r = getDb().prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

/** POST /api/templates/reorder — body { order: [id, id, ...] } sets sort_order = index. */
templatesRouter.post('/api/templates/reorder', requireAuth, (req, res) => {
  const parsed = ReorderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const db = getDb();
  const update = db.prepare('UPDATE templates SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?');
  const txn = db.transaction((order: number[]) => {
    let updated = 0;
    order.forEach((id, idx) => {
      const r = update.run(idx + 1, id, req.user!.id);
      if (r.changes > 0) updated++;
    });
    return updated;
  });
  const updated = txn(parsed.data.order);
  res.json({ ok: true, updated });
});

/** Seed default templates if the user has none. Called from auth.ensureUserExists. */
export function seedDefaultTemplates(userId: number): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM templates WHERE user_id = ?').get(userId) as { c: number }).c;
  if (count > 0) return;
  const defaults = [
    { label: 'Running late', body: "I'm running ~10 minutes late, sorry!" },
    { label: 'On my way', body: "On my way, see you soon." },
    { label: 'ETA 5 min', body: 'ETA 5 minutes.' },
    { label: 'Stuck in traffic', body: "Stuck in traffic, I'll be there as soon as I can." },
    { label: 'Call you in 5', body: "I'll call you in 5 minutes." },
    { label: 'Got it, thanks', body: 'Got it, thanks!' },
    { label: 'Can\'t talk now', body: "Can't talk right now — I'll call you back." },
    { label: 'Heading home', body: 'Heading home now.' },
    { label: 'Need a few more min', body: 'I need a few more minutes, will be ready soon.' },
    { label: 'Sounds good', body: 'Sounds good, see you then.' },
    { label: 'Confirmed', body: 'Confirmed.' },
    { label: 'On my way home', body: "On my way home, see you in a bit." },
  ];
  const insert = db.prepare('INSERT INTO templates (user_id, label, body, sort_order) VALUES (?, ?, ?, ?)');
  const txn = db.transaction(() => {
    defaults.forEach((t, i) => insert.run(userId, t.label, t.body, i + 1));
  });
  txn();
}
