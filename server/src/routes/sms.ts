import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { getDb } from '../db.js';
import { sendSms, normalizeE164, SmsError } from '../sms/twilio-client.js';
import { env } from '../env.js';
import { log } from '../log.js';

export const smsRouter = Router();

const SendBody = z.object({
  to: z.string().min(3),
  body: z.string().min(1).max(1600),
  contact_id: z.number().int().positive().optional(),
  tone: z.string().optional(),
  /** Client-generated UUID for idempotency — re-POSTs with same UUID return the existing outbox row. */
  client_uuid: z.string().uuid().optional(),
});

/**
 * POST /api/sms
 *
 * Send an SMS via Twilio. Idempotent by `client_uuid` — if the HUD retries
 * after a network hiccup, the same uuid returns the existing outbox row
 * without re-firing the Twilio API.
 */
smsRouter.post('/api/sms', requireAuth, rateLimit({ bucket: 'sms', limit: 200 }), async (req, res) => {
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  const { to, body, contact_id, tone } = parsed.data;
  const clientUuid = parsed.data.client_uuid ?? randomUUID();

  const to164 = normalizeE164(to);
  if (!to164) {
    res.status(400).json({ error: 'invalid_to_number', message: `could not parse "${to}" as a phone number` });
    return;
  }

  const db = getDb();

  // Idempotency — return existing outbox row if client_uuid already exists.
  const existing = db
    .prepare('SELECT id, status, last_error, sent_at FROM outbox WHERE client_uuid = ? AND user_id = ?')
    .get(clientUuid, userId) as
    | { id: number; status: string; last_error: string | null; sent_at: string | null }
    | undefined;
  if (existing) {
    res.status(200).json({
      idempotent: true,
      outbox_id: existing.id,
      client_uuid: clientUuid,
      status: existing.status,
      sent_at: existing.sent_at,
      error: existing.last_error,
    });
    return;
  }

  // Insert outbox row in 'pending' state, then call Twilio.
  const insertResult = db
    .prepare(
      `INSERT INTO outbox (client_uuid, user_id, contact_id, channel, body, tone, status, attempts)
       VALUES (?, ?, ?, 'sms', ?, ?, 'pending', 1)`,
    )
    .run(clientUuid, userId, contact_id ?? null, body, tone ?? null);
  const outboxId = Number(insertResult.lastInsertRowid);

  try {
    const twilioResult = await sendSms(userId, {
      to: to164,
      body,
      statusCallback: `${env.TWILIO_WEBHOOK_BASE_URL}/webhooks/twilio/status`,
    });

    db.prepare(
      `UPDATE outbox SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?`,
    ).run(outboxId);

    db.prepare(
      `INSERT INTO history (user_id, contact_id, channel, direction, body, tone, status, provider_message_id)
       VALUES (?, ?, 'sms', 'out', ?, ?, 'sent', ?)`,
    ).run(userId, contact_id ?? null, body, tone ?? null, twilioResult.message_sid);

    if (contact_id) {
      db.prepare(
        `UPDATE contacts SET last_used_channel = 'sms', last_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).run(contact_id, userId);
    }

    res.status(200).json({
      idempotent: false,
      outbox_id: outboxId,
      client_uuid: clientUuid,
      status: 'sent',
      provider_message_id: twilioResult.message_sid,
      to: twilioResult.to,
      from: twilioResult.from,
      body: twilioResult.body,
      latency_ms: twilioResult.latency_ms,
    });
  } catch (err) {
    const errInfo = err instanceof SmsError
      ? { code: err.code, message: err.message, twilio_code: err.twilioCode }
      : { code: 'unknown', message: err instanceof Error ? err.message : String(err) };
    db.prepare(
      `UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?`,
    ).run(JSON.stringify(errInfo), outboxId);
    db.prepare(
      `INSERT INTO history (user_id, contact_id, channel, direction, body, tone, status, error)
       VALUES (?, ?, 'sms', 'out', ?, ?, 'failed', ?)`,
    ).run(userId, contact_id ?? null, body, tone ?? null, errInfo.message);

    log.warn({ err, outboxId, to: to164 }, 'twilio send failed');
    const status =
      errInfo.code === 'missing_credentials' ? 400 :
      errInfo.code === 'unauthorized' ? 401 :
      errInfo.code === 'rate_limited' ? 429 :
      errInfo.code === 'invalid_to_number' ? 400 :
      502;
    res.status(status).json({
      idempotent: false,
      outbox_id: outboxId,
      client_uuid: clientUuid,
      status: 'failed',
      error: errInfo.code,
      message: errInfo.message,
      twilio_code: errInfo.twilio_code,
    });
  }
});
