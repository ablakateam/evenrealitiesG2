import { getPairing } from './kvs.js';

/**
 * API client for the VOX server.
 *
 * Server origin + bearer secret come from the stored pairing (KVS), written
 * during the pairing flow. Until the HUD is paired, calls reject with
 * `not_paired` — callers should surface a "pair me" state rather than crash.
 */
export class HudApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HudApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Raw body (e.g. multipart) — overrides `body`; caller sets content-type. */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function hudApi<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const pairing = await getPairing();
  if (!pairing) {
    throw new HudApiError(0, 'not_paired', 'HUD is not paired with a VOX server');
  }
  const { method = 'GET', body, rawBody, headers = {}, signal } = opts;

  const finalHeaders: Record<string, string> = {
    Authorization: `Bearer ${pairing.secret}`,
    ...headers,
  };
  let payload: BodyInit | undefined;
  if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${pairing.server}${path}`, {
    method,
    headers: finalHeaders,
    body: payload,
    signal,
  });

  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const code =
      (data && typeof data === 'object' && 'error' in data && (data as { error: string }).error) || 'http_error';
    const message =
      (data && typeof data === 'object' && 'message' in data && (data as { message: string }).message) ||
      `${method} ${path} → ${res.status}`;
    throw new HudApiError(res.status, code as string, message as string);
  }
  return data as T;
}

export const apiGet = <T,>(path: string, signal?: AbortSignal) => hudApi<T>(path, { method: 'GET', signal });
export const apiPost = <T,>(path: string, body?: unknown) => hudApi<T>(path, { method: 'POST', body });

/** POST raw PCM audio (the compose / STT path). */
export const apiPostAudio = <T,>(path: string, audio: Uint8Array, fields: Record<string, string> = {}) => {
  const form = new FormData();
  // `Uint8Array` is a valid BlobPart at runtime; the cast sidesteps a
  // lib.dom strictness mismatch (Uint8Array<ArrayBufferLike> vs ArrayBuffer).
  form.append('audio', new Blob([audio as BlobPart], { type: 'application/octet-stream' }), 'audio.pcm');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return hudApi<T>(path, { method: 'POST', rawBody: form });
};

/* --- /api/compose response shapes (mirror server/src/compose.ts) ---------- */

export type Tone = 'casual' | 'professional' | 'friendly' | 'formal' | 'sarcastic' | 'grammar' | 'original';

export interface IntentResult {
  channel: 'sms' | 'email' | 'both' | 'ambiguous';
  recipient_id: number | null;
  recipient_name: string | null;
  body: string;
  subject: string | null;
  language: string;
  confidence: { recipient: 1 | 2 | 3; channel: 1 | 2 | 3; body: 1 | 2 | 3 };
  candidates: number[];
}

export interface VariantResult {
  tone: Tone;
  text: string;
  latency_ms: number;
  error?: string;
}

export interface ComposeResult {
  transcription: string;
  stt_latency_ms: number;
  language?: string;
  intent: IntentResult | { error: string };
  variants: VariantResult[];
  total_latency_ms: number;
}

/* --- /api/stt + /api/voice-command --------------------------------------- */

export interface SttResult {
  text: string;
  language: string | null;
  duration_seconds: number;
  latency_ms: number;
}

export type KnownPage = 'idle' | 'inbox' | 'compose' | 'contacts' | 'history' | 'templates';

export type VoiceAction =
  | { kind: 'compose'; params: Record<string, never>; confidence: 1 | 2 | 3 }
  | { kind: 'reply'; params: { to_name?: string }; confidence: 1 | 2 | 3 }
  | { kind: 'navigate'; params: { target: KnownPage }; confidence: 1 | 2 | 3 }
  | { kind: 'search'; params: { query: string; scope: 'messages' | 'contacts' }; confidence: 1 | 2 | 3 }
  | { kind: 'save_contact'; params: { name: string; phone?: string; email?: string }; confidence: 1 | 2 | 3 }
  | { kind: 'settings'; params: { key: string; value: string }; confidence: 1 | 2 | 3 }
  | { kind: 'cancel'; params: Record<string, never>; confidence: 1 | 2 | 3 }
  | { kind: 'unknown'; params: { reason: string }; confidence: 1 | 2 | 3 };

export interface VoiceCommandResult {
  transcription: string;
  action: VoiceAction;
  latency_ms: number;
}
