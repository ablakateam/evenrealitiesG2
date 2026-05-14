import { Router, urlencoded } from 'express';
import { verifyWebhookSignature } from '../sms/twilio-client.js';
import { sanitizeForHud } from '../sms/sanitize.js';
import { getDb } from '../db.js';
import { env } from '../env.js';
import { log } from '../log.js';

export const twilioWebhookRouter = Router();

// Twilio sends webhooks as application/x-www-form-urlencoded; mount a body
// parser scoped to these routes so the rest of the app stays JSON-first.
const formParser = urlencoded({ extended: false });

/**
 * Compute the full URL Twilio used so signature verification works through
 * Nginx → Node. Trust the X-Forwarded-* set by Nginx.
 */
function fullUrl(originalUrl: string): string {
  // env.TWILIO_WEBHOOK_BASE_URL is the public origin Twilio knows about.
  return `${env.TWILIO_WEBHOOK_BASE_URL}${originalUrl}`;
}

/**
 * POST /webhooks/twilio/inbound
 *
 * Twilio fires this when an SMS arrives at our number.
 * Verifies signature, resolves sender → contact, sanitizes body, inserts
 * into inbox, returns empty TwiML so Twilio doesn't auto-reply.
 *
 * SSE push to the HUD is wired in P15 (Inbox + reply).
 */
twilioWebhookRouter.post('/webhooks/twilio/inbound', formParser, async (req, res) => {
  const params = req.body as Record<string, string>;
  const signature = req.header('x-twilio-signature');
  const url = fullUrl(req.originalUrl);

  if (!verifyWebhookSignature(signature, url, params)) {
    log.warn({ url, sigPresent: Boolean(signature) }, 'twilio webhook signature mismatch');
    res.status(403).type('text/xml').send('<Response/>');
    return;
  }

  const from = params.From ?? '';
  const to = params.To ?? '';
  const body = params.Body ?? '';
  const messageSid = params.MessageSid ?? '';

  if (!from || !messageSid) {
    res.status(400).type('text/xml').send('<Response/>');
    return;
  }

  const db = getDb();

  // Single-tenant for now: anything inbound belongs to user 1. (Multi-tenant
  // routing would key off the To number against per-user Twilio number ownership.)
  const userRow = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!userRow) {
    log.warn('no user — dropping inbound');
    res.type('text/xml').send('<Response/>');
    return;
  }

  // Best-effort contact resolution by phone match.
  const contact = db
    .prepare('SELECT id, name FROM contacts WHERE user_id = ? AND phone_e164 = ?')
    .get(userRow.id, from) as { id: number; name: string } | undefined;

  const sanitized = sanitizeForHud(body);

  const insertResult = db
    .prepare(
      `INSERT INTO inbox (user_id, contact_id, channel, from_address, body, raw_payload_json, received_at)
       VALUES (?, ?, 'sms', ?, ?, ?, datetime('now'))`,
    )
    .run(userRow.id, contact?.id ?? null, from, sanitized, JSON.stringify({ ...params, _to: to, _sid: messageSid }));

  log.info(
    { from, to, contact: contact?.name ?? null, sid: messageSid, inbox_id: insertResult.lastInsertRowid },
    'inbound sms received',
  );

  // Empty TwiML — we don't auto-reply via Twilio; replies go through our app flow.
  res.type('text/xml').send('<Response/>');
});

/**
 * POST /webhooks/twilio/status
 *
 * Delivery status callbacks (queued → sent → delivered → ...). We update the
 * outbox row keyed by MessageSid. Doesn't need to verify signature for
 * idempotent state updates, but we do it for symmetry.
 */
twilioWebhookRouter.post('/webhooks/twilio/status', formParser, async (req, res) => {
  const params = req.body as Record<string, string>;
  const signature = req.header('x-twilio-signature');
  const url = fullUrl(req.originalUrl);

  if (!verifyWebhookSignature(signature, url, params)) {
    log.warn({ url, sigPresent: Boolean(signature) }, 'twilio status signature mismatch');
    res.sendStatus(403);
    return;
  }

  const messageSid = params.MessageSid ?? '';
  const messageStatus = params.MessageStatus ?? '';
  const errorCode = params.ErrorCode ?? null;

  if (!messageSid || !messageStatus) {
    res.sendStatus(400);
    return;
  }

  const db = getDb();
  const result = db
    .prepare(
      `UPDATE history SET status = ?, error = ? WHERE provider_message_id = ? AND direction = 'out'`,
    )
    .run(messageStatus, errorCode, messageSid);

  log.info(
    { sid: messageSid, status: messageStatus, errorCode, updated: result.changes },
    'twilio status callback',
  );

  res.sendStatus(204);
});
