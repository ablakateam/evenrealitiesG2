import twilio from 'twilio';
import { getIntegrationCreds, type TwilioCreds } from '../integrations.js';

/**
 * Twilio client. Credentials resolve DB-first (the `integrations` table,
 * written by the onboarding wizard) with env-var fallback (the bootstrap
 * path — what /opt/vox/.env provides on a fresh deploy).
 */
export class SmsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly twilioCode?: number,
  ) {
    super(message);
    this.name = 'SmsError';
  }
}

/** Resolve Twilio credentials for a user (DB-first, env fallback). */
function getCreds(userId: number): TwilioCreds {
  const creds = getIntegrationCreds(userId, 'twilio') as TwilioCreds | null;
  if (!creds || !creds.sid || !creds.token) {
    throw new SmsError('missing_credentials', 'Twilio credentials are not configured');
  }
  return creds;
}

/** Single-tenant: the webhook auth token belongs to user #1. */
export function getWebhookAuthToken(): string | null {
  const creds = getIntegrationCreds(1, 'twilio') as TwilioCreds | null;
  return creds?.token ?? null;
}

export interface SendSmsResult {
  message_sid: string;
  status: string;
  to: string;
  from: string;
  body: string;
  latency_ms: number;
}

export interface SendSmsOptions {
  to: string; // E.164
  body: string;
  statusCallback?: string;
}

/**
 * Send an SMS via Twilio for the given user.
 * Prefers the Messaging Service SID (smart routing, A2P compliance) when
 * set, falls back to the From number.
 */
export async function sendSms(userId: number, opts: SendSmsOptions): Promise<SendSmsResult> {
  const creds = getCreds(userId);
  if (!creds.messaging_service_sid && !creds.from_number) {
    throw new SmsError('missing_credentials', 'Twilio needs either a Messaging Service SID or a From number');
  }
  const client = twilio(creds.sid, creds.token);
  const t0 = Date.now();
  try {
    const payload: Parameters<typeof client.messages.create>[0] = {
      to: opts.to,
      body: opts.body,
    };
    if (creds.messaging_service_sid) {
      payload.messagingServiceSid = creds.messaging_service_sid;
    } else if (creds.from_number) {
      payload.from = creds.from_number;
    }
    if (opts.statusCallback) {
      payload.statusCallback = opts.statusCallback;
    }
    const msg = await client.messages.create(payload);
    return {
      message_sid: msg.sid,
      status: msg.status,
      to: msg.to,
      from: msg.from ?? creds.from_number ?? '',
      body: msg.body ?? opts.body,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    throw normalizeTwilioError(err);
  }
}

function normalizeTwilioError(err: unknown): SmsError {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: number }).code === 'number') {
    const e = err as { code: number; message?: string; status?: number };
    const code =
      e.code === 21211 ? 'invalid_to_number' :
      e.code === 21610 ? 'recipient_unsubscribed' :
      e.code === 21408 ? 'permission_denied' :
      e.code === 20003 ? 'unauthorized' :
      e.status === 429 ? 'rate_limited' :
      'twilio_error';
    return new SmsError(code, e.message ?? 'twilio request failed', e.status, e.code);
  }
  if (err instanceof Error) return new SmsError('unknown', err.message);
  return new SmsError('unknown', String(err));
}

/**
 * Verify a Twilio webhook signature (HMAC-SHA1 over the full URL + sorted
 * form params). The auth token resolves DB-first (user #1) with env fallback.
 *
 * `fullUrl` must be the complete public URL Twilio used — build it from the
 * configured public origin + req.originalUrl to handle Nginx proxying.
 */
export function verifyWebhookSignature(
  signatureHeader: string | undefined,
  fullUrl: string,
  params: Record<string, string>,
): boolean {
  const token = getWebhookAuthToken();
  if (!signatureHeader || !token) return false;
  try {
    return twilio.validateRequest(token, signatureHeader, fullUrl, params);
  } catch {
    return false;
  }
}

/** Normalize a user-entered phone number to E.164 (US-biased fallback). */
export function normalizeE164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return null;
}
