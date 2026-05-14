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
