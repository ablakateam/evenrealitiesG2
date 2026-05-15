import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { getDb } from '../db.js';
import { sendEmail, EmailError } from '../mail/smtp.js';
import { log } from '../log.js';

export const emailRouter = Router();

const SendBody = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(20000),
  contact_id: z.number().int().positive().optional(),
  tone: z.string().optional(),
  client_uuid: z.string().uuid().optional(),
});

/**
 * POST /api/email
 *
 * Send an email through the user's configured SMTP account.
 * Idempotent by client_uuid — re-POST with the same UUID returns the
 * existing outbox row without re-sending.
 *
 * Sent message also lands in the user's real Sent folder (we go through
 * their own SMTP), so there's no separate identity to track.
 */
emailRouter.post('/api/email', requireAuth, rateLimit({ bucket: 'email', limit: 400 }), async (req, res) => {
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  const { to, subject, body, contact_id, tone } = parsed.data;
  const clientUuid = parsed.data.client_uuid ?? randomUUID();

  const db = getDb();
  const existing = db
    .prepare('SELECT id, status, last_error, sent_at FROM outbox WHERE client_uuid = ? AND user_id = ?')
    .get(clientUuid, userId) as
    | { id: number; status: string; last_error: string | null; sent_at: string | null }
    | undefined;
  if (existing) {
    res.json({
      idempotent: true,
      outbox_id: existing.id,
      client_uuid: clientUuid,
      status: existing.status,
      sent_at: existing.sent_at,
      error: existing.last_error,
    });
    return;
  }

  const outboxId = Number(
    db
      .prepare(
        `INSERT INTO outbox (client_uuid, user_id, contact_id, channel, body, subject, tone, status, attempts)
         VALUES (?, ?, ?, 'email', ?, ?, ?, 'pending', 1)`,
      )
      .run(clientUuid, userId, contact_id ?? null, body, subject, tone ?? null).lastInsertRowid,
  );

  try {
    const result = await sendEmail(userId, { to, subject, body });

    db.prepare(
      `UPDATE outbox SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?`,
    ).run(outboxId);

    db.prepare(
      `INSERT INTO history (user_id, contact_id, channel, direction, body, subject, tone, status, provider_message_id)
       VALUES (?, ?, 'email', 'out', ?, ?, ?, 'sent', ?)`,
    ).run(userId, contact_id ?? null, body, subject, tone ?? null, result.message_id);

    if (contact_id) {
      db.prepare(
        `UPDATE contacts SET last_used_channel = 'email', last_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).run(contact_id, userId);
    }

    res.json({
      idempotent: false,
      outbox_id: outboxId,
      client_uuid: clientUuid,
      status: 'sent',
      message_id: result.message_id,
      to,
      subject,
      accepted: result.accepted,
      rejected: result.rejected,
      latency_ms: result.latency_ms,
    });
  } catch (err) {
    const info = err instanceof EmailError ? { code: err.code, message: err.message } : { code: 'unknown', message: err instanceof Error ? err.message : String(err) };
    db.prepare(`UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?`).run(
      JSON.stringify(info),
      outboxId,
    );
    db.prepare(
      `INSERT INTO history (user_id, contact_id, channel, direction, body, subject, tone, status, error)
       VALUES (?, ?, 'email', 'out', ?, ?, ?, 'failed', ?)`,
    ).run(userId, contact_id ?? null, body, subject, tone ?? null, info.message);
    log.warn({ err, outboxId, to }, 'email send failed');
    const status =
      info.code === 'no_email_account' ? 400 :
      info.code === 'smtp_no_credentials' || info.code === 'smtp_misconfigured' ? 400 :
      info.code === 'smtp_auth_failed' ? 401 :
      502;
    res.status(status).json({
      idempotent: false,
      outbox_id: outboxId,
      client_uuid: clientUuid,
      status: 'failed',
      error: info.code,
      message: info.message,
    });
  }
});
