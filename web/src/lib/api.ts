import { readSecret } from './auth';

/**
 * API base. Empty in production (dashboard served same-origin with the API
 * via Nginx). For local dev, set VITE_API_BASE to your server's origin.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** When false, omit the Authorization header (e.g. for /api/health). */
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const secret = readSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const code = (payload && typeof payload === 'object' && 'error' in payload && (payload as { error: string }).error) || 'http_error';
    const message =
      (payload && typeof payload === 'object' && 'message' in payload && (payload as { message: string }).message) ||
      `${method} ${path} → ${res.status}`;
    throw new ApiError(res.status, code as string, message as string, payload);
  }
  return payload as T;
}

/* Typed convenience wrappers ------------------------------------------------ */

export const apiGet = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { method: 'GET', signal });
export const apiPost = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPut = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

/* Shared response types (mirror server route shapes) ----------------------- */

export interface HealthResponse {
  status: string;
  service: string;
  phase: string;
  timestamp: string;
  uptime_seconds: number;
  node: string;
  schema_version: number;
  user_count: number;
}

export interface HistoryStats {
  sent: { total: number; today: number };
  failed: { total: number; today: number };
  received: { total: number; today: number };
  cost_cents: { total: number; last_30d: number };
  tokens: { total: number; today: number };
}

export interface HistoryItem {
  id: number;
  channel: 'sms' | 'email';
  direction: 'out' | 'in';
  body: string;
  subject: string | null;
  tone: string | null;
  status: string;
  error: string | null;
  contact_id: number | null;
  contact_name: string | null;
  created_at: string;
}
