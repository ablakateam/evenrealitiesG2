import twilio from 'twilio';
import { env } from '../env.js';

/**
 * Lazy Twilio client. Throws SmsError("missing_credentials") if SID/TOKEN
 * are not configured.
 */
let cachedClient: ReturnType<typeof twilio> | null = null;

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

function getClient(): ReturnType<typeof twilio> {
  if (cachedClient) return cachedClient;
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN) {
    throw new SmsError('missing_credentials', 'TWILIO_SID and TWILIO_TOKEN must both be set');
  }
  cachedClient = twilio(env.TWILIO_SID, env.TWILIO_TOKEN);
  return cachedClient;
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
  /** Optional Twilio status callback URL — when set, Twilio POSTs delivery updates. */
  statusCallback?: string;
}

/**
 * Send an SMS via Twilio.
 * Prefers TWILIO_MESSAGING_SERVICE_SID (smart routing, sticky sender, A2P
 * compliance) when set, falls back to TWILIO_FROM_NUMBER.
 */
export async function sendSms(opts: SendSmsOptions): Promise<SendSmsResult> {
  if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM_NUMBER) {
    throw new SmsError(
      'missing_credentials',
      'either TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER must be set',
    );
  }
  const client = getClient();
  const t0 = Date.now();
  try {
    const payload: Parameters<typeof client.messages.create>[0] = {
      to: opts.to,
      body: opts.body,
    };
    if (env.TWILIO_MESSAGING_SERVICE_SID) {
      payload.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (env.TWILIO_FROM_NUMBER) {
      payload.from = env.TWILIO_FROM_NUMBER;
    }
    if (opts.statusCallback) {
      payload.statusCallback = opts.statusCallback;
    }
    const msg = await client.messages.create(payload);
    return {
      message_sid: msg.sid,
      status: msg.status,
      to: msg.to,
      from: msg.from ?? env.TWILIO_FROM_NUMBER ?? '',
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
 * Verify a Twilio webhook signature.
 *
 * Twilio signs every webhook request with HMAC-SHA1 over the full request URL
 * + sorted form-encoded body. The signature is in `X-Twilio-Signature`.
 * Returns true if the signature is valid for the given request.
 *
 * `fullUrl` must be the *complete* public URL Twilio used (including scheme,
 * host, path, and any query string). Build it from
 *   `${env.TWILIO_WEBHOOK_BASE_URL}${req.originalUrl}` to handle proxying.
 */
export function verifyWebhookSignature(
  signatureHeader: string | undefined,
  fullUrl: string,
  params: Record<string, string>,
): boolean {
  // Read TWILIO_TOKEN from process.env dynamically (rather than the cached
  // env module) so env updates via `pm2 reload --update-env` take effect
  // without re-importing this module, and tests can override per-run.
  const token = process.env.TWILIO_TOKEN ?? env.TWILIO_TOKEN;
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
  // Already E.164
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
  // Strip everything non-digit
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`; // US fallback
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return null;
}
