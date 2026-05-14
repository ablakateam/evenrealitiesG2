import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';

export const historyRouter = Router();

const ListQuery = z.object({
  channel: z.enum(['sms', 'email']).optional(),
  direction: z.enum(['out', 'in']).optional(),
  contact_id: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
  from_date: z.string().optional(), // ISO date
  to_date: z.string().optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/history — paginated audit log of every send + receive. */
historyRouter.get('/api/history', requireAuth, (req, res) => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'invalid_query', issues: q.error.issues });
    return;
  }
  const userId = req.user!.id;
  const where: string[] = ['h.user_id = @user_id'];
  const params: Record<string, unknown> = { user_id: userId, limit: q.data.limit, offset: q.data.offset };

  if (q.data.channel) {
    where.push('h.channel = @channel');
    params.channel = q.data.channel;
  }
  if (q.data.direction) {
    where.push('h.direction = @direction');
    params.direction = q.data.direction;
  }
  if (q.data.contact_id) {
    where.push('h.contact_id = @contact_id');
    params.contact_id = q.data.contact_id;
  }
  if (q.data.status) {
    where.push('h.status = @status');
    params.status = q.data.status;
  }
  if (q.data.from_date) {
    where.push('h.created_at >= @from_date');
    params.from_date = q.data.from_date;
  }
  if (q.data.to_date) {
    where.push('h.created_at <= @to_date');
    params.to_date = q.data.to_date;
  }
  if (q.data.q) {
    where.push("(h.body LIKE '%' || @q || '%' COLLATE NOCASE OR h.subject LIKE '%' || @q || '%' COLLATE NOCASE)");
    params.q = q.data.q;
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT h.id, h.channel, h.direction, h.body, h.subject, h.tone, h.status, h.error,
              h.cost_cents, h.tokens_used, h.provider_message_id, h.created_at,
              h.contact_id, c.name AS contact_name
       FROM history h LEFT JOIN contacts c ON c.id = h.contact_id
       WHERE ${where.join(' AND ')}
       ORDER BY h.id DESC LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM history h WHERE ${where.join(' AND ')}`).get(params) as { c: number }).c;
  res.json({ items: rows, total, limit: q.data.limit, offset: q.data.offset });
});

/** GET /api/history/stats — roll-up counts + cost (today, week, month). */
historyRouter.get('/api/history/stats', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const stats = (db
    .prepare(
      `SELECT
         SUM(CASE WHEN direction='out' AND status NOT IN ('failed','undelivered') THEN 1 ELSE 0 END) AS sent_total,
         SUM(CASE WHEN direction='out' AND status IN ('failed','undelivered') THEN 1 ELSE 0 END) AS failed_total,
         SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) AS received_total,
         SUM(CASE WHEN date(created_at) = date('now') AND direction='out' AND status NOT IN ('failed','undelivered') THEN 1 ELSE 0 END) AS sent_today,
         SUM(CASE WHEN date(created_at) = date('now') AND direction='out' AND status IN ('failed','undelivered') THEN 1 ELSE 0 END) AS failed_today,
         SUM(CASE WHEN date(created_at) = date('now') AND direction='in' THEN 1 ELSE 0 END) AS received_today,
         COALESCE(SUM(cost_cents), 0) AS cost_cents_total,
         COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-30 days') THEN cost_cents END), 0) AS cost_cents_30d,
         COALESCE(SUM(tokens_used), 0) AS tokens_total,
         COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN tokens_used END), 0) AS tokens_today
       FROM history WHERE user_id = ?`,
    )
    .get(userId)) as Record<string, number | null>;
  res.json({
    sent: { total: stats.sent_total ?? 0, today: stats.sent_today ?? 0 },
    failed: { total: stats.failed_total ?? 0, today: stats.failed_today ?? 0 },
    received: { total: stats.received_total ?? 0, today: stats.received_today ?? 0 },
    cost_cents: { total: stats.cost_cents_total ?? 0, last_30d: stats.cost_cents_30d ?? 0 },
    tokens: { total: stats.tokens_total ?? 0, today: stats.tokens_today ?? 0 },
  });
});
