import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { inboxBus } from '../mail/sse-bus.js';
import { log } from '../log.js';

export const inboxRouter = Router();

const ListQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  channel: z.enum(['sms', 'email']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before_id: z.coerce.number().int().positive().optional(),
});

/** GET /api/inbox — paginated list of recent inbox items. */
inboxRouter.get('/api/inbox', requireAuth, (req, res) => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'invalid_query', issues: q.error.issues });
    return;
  }
  const userId = req.user!.id;
  const db = getDb();

  const where: string[] = ['i.user_id = @user_id'];
  const params: Record<string, unknown> = { user_id: userId, limit: q.data.limit };
  if (q.data.unread === 'true') where.push('i.read_at IS NULL');
  if (q.data.unread === 'false') where.push('i.read_at IS NOT NULL');
  if (q.data.channel) {
    where.push('i.channel = @channel');
    params.channel = q.data.channel;
  }
  if (q.data.before_id) {
    where.push('i.id < @before_id');
    params.before_id = q.data.before_id;
  }
  const rows = db
    .prepare(
      // Join contacts so the list can show a name. The detail endpoint below
      // already did, so a message read as "+15555550123" in the list and
      // "Alex Chen" once opened — and the list is what you look at most.
      `SELECT i.id, i.channel, i.contact_id, i.from_address, i.subject, i.body,
              i.received_at, i.read_at, c.name AS contact_name
       FROM inbox i LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.id DESC LIMIT @limit`,
    )
    .all(params);
  const unreadCount = (db
    .prepare('SELECT COUNT(*) AS c FROM inbox WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { c: number }).c;
  res.json({ items: rows, unread_count: unreadCount });
});

/** GET /api/inbox/:id — full thread/detail view (includes contact join). */
inboxRouter.get('/api/inbox/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT i.*, c.name AS contact_name
       FROM inbox i LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.id = ? AND i.user_id = ?`,
    )
    .get(id, req.user!.id);
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(row);
});

/** POST /api/inbox/:id/read — mark read; broadcasts to SSE subscribers. */
inboxRouter.post('/api/inbox/:id/read', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const db = getDb();
  const r = db.prepare(`UPDATE inbox SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL`).run(
    id,
    req.user!.id,
  );
  if (r.changes === 0) {
    res.json({ ok: true, already_read: true });
    return;
  }
  inboxBus.publishRead(req.user!.id, id);
  res.json({ ok: true });
});

/**
 * GET /api/inbox/stream
 *
 * Server-Sent Events stream of inbox updates. Clients (the HUD and the
 * dashboard) subscribe to receive new-message and read-status events in
 * real time.
 */
inboxRouter.get('/api/inbox/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  res.flushHeaders();

  const userId = req.user!.id;
  const send = (event: { kind: string } & Record<string, unknown>) => {
    res.write(`event: ${event.kind}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // Send a hello so clients can detect connection establishment.
  send({ kind: 'hello', user_id: userId, server_time: new Date().toISOString() });

  const unsubscribe = inboxBus.subscribe(userId, (event) => {
    try {
      send(event);
    } catch (err) {
      log.warn({ err }, 'sse send failed');
    }
  });

  // Heartbeat every 25s to keep proxies + browsers happy.
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
