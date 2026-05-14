import { getDb } from './db.js';
import { encryptString, decryptString } from './crypto.js';

/**
 * Integration credential store.
 *
 * Credentials for Twilio + the LLM providers are stored encrypted (AES-256-GCM)
 * in the `integrations` table so the onboarding wizard / dashboard can manage
 * them without SSH. The Twilio client and LLM factory read DB-first, then fall
 * back to env vars (the bootstrap path — what /opt/vox/.env provides on a
 * fresh deploy).
 *
 * `key_encrypted` holds an encrypted JSON blob of the provider's secret-ish
 * fields. `metadata_json` holds non-secret display data.
 */
export type IntegrationProvider = 'twilio' | 'openai' | 'anthropic' | 'openrouter' | 'ollama-cloud';

export const ALL_INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  'twilio',
  'openai',
  'anthropic',
  'openrouter',
  'ollama-cloud',
];

/** Credential bundles, per provider. */
export interface TwilioCreds {
  sid: string;
  token: string;
  from_number?: string;
  messaging_service_sid?: string;
}
export interface ApiKeyCreds {
  api_key: string;
}
export type IntegrationCreds = TwilioCreds | ApiKeyCreds;

export type IntegrationStatus = 'unconfigured' | 'configured' | 'error';

interface IntegrationRow {
  provider: IntegrationProvider;
  key_encrypted: string | null;
  metadata_json: string;
  status: IntegrationStatus;
  last_tested_at: string | null;
  last_error: string | null;
}

/** Dashboard-safe view — never includes the secret values themselves. */
export interface IntegrationView {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  configured: boolean;
  /** Source of the currently-effective credentials. */
  source: 'db' | 'env' | 'none';
  last_tested_at: string | null;
  last_error: string | null;
  /** Non-secret hints for the dashboard (e.g. masked SID, from number). */
  metadata: Record<string, unknown>;
}

/** Persist (encrypted) credentials for a provider. */
export function setIntegration(
  userId: number,
  provider: IntegrationProvider,
  creds: IntegrationCreds,
  metadata: Record<string, unknown> = {},
): void {
  const db = getDb();
  const keyEncrypted = encryptString(JSON.stringify(creds));
  db.prepare(
    `INSERT INTO integrations (user_id, provider, key_encrypted, metadata_json, status, updated_at)
     VALUES (?, ?, ?, ?, 'configured', datetime('now'))
     ON CONFLICT(user_id, provider) DO UPDATE SET
       key_encrypted = excluded.key_encrypted,
       metadata_json = excluded.metadata_json,
       status = 'configured',
       last_error = NULL,
       updated_at = datetime('now')`,
  ).run(userId, provider, keyEncrypted, JSON.stringify(metadata));
}

export function deleteIntegration(userId: number, provider: IntegrationProvider): void {
  getDb().prepare('DELETE FROM integrations WHERE user_id = ? AND provider = ?').run(userId, provider);
}

/** Mark a provider's last test result. */
export function setIntegrationStatus(
  userId: number,
  provider: IntegrationProvider,
  status: IntegrationStatus,
  lastError?: string,
): void {
  getDb()
    .prepare(
      `UPDATE integrations SET status = ?, last_error = ?, last_tested_at = datetime('now')
       WHERE user_id = ? AND provider = ?`,
    )
    .run(status, lastError ?? null, userId, provider);
}

function getRow(userId: number, provider: IntegrationProvider): IntegrationRow | null {
  const row = getDb()
    .prepare('SELECT provider, key_encrypted, metadata_json, status, last_tested_at, last_error FROM integrations WHERE user_id = ? AND provider = ?')
    .get(userId, provider) as IntegrationRow | undefined;
  return row ?? null;
}

/** Decrypted credentials for a provider — DB-first, env fallback. Returns null if neither. */
export function getIntegrationCreds(userId: number, provider: IntegrationProvider): IntegrationCreds | null {
  const row = getRow(userId, provider);
  if (row?.key_encrypted) {
    try {
      return JSON.parse(decryptString(row.key_encrypted)) as IntegrationCreds;
    } catch {
      // fall through to env fallback if the blob is corrupt
    }
  }
  return envFallbackCreds(provider);
}

/** Which source is currently providing a provider's credentials. */
export function credsSource(userId: number, provider: IntegrationProvider): 'db' | 'env' | 'none' {
  const row = getRow(userId, provider);
  if (row?.key_encrypted) return 'db';
  if (envFallbackCreds(provider)) return 'env';
  return 'none';
}

/**
 * Bootstrap credentials from the environment — used until the wizard writes
 * DB rows. Reads `process.env` directly (not the zod-cached `env`) so that
 * `pm2 reload --update-env` rotations take effect without a code reload,
 * and so tests can override per-run.
 */
function envFallbackCreds(provider: IntegrationProvider): IntegrationCreds | null {
  const e = process.env;
  switch (provider) {
    case 'twilio':
      if (e.TWILIO_SID && e.TWILIO_TOKEN) {
        return {
          sid: e.TWILIO_SID,
          token: e.TWILIO_TOKEN,
          from_number: e.TWILIO_FROM_NUMBER,
          messaging_service_sid: e.TWILIO_MESSAGING_SERVICE_SID,
        };
      }
      return null;
    case 'openai':
      return e.OPENAI_KEY ? { api_key: e.OPENAI_KEY } : null;
    case 'anthropic':
      return e.ANTHROPIC_KEY ? { api_key: e.ANTHROPIC_KEY } : null;
    case 'openrouter':
      return e.OPENROUTER_KEY ? { api_key: e.OPENROUTER_KEY } : null;
    case 'ollama-cloud':
      return e.OLLAMA_CLOUD_KEY ? { api_key: e.OLLAMA_CLOUD_KEY } : null;
  }
}

/** Build the dashboard-safe view for one provider. */
export function getIntegrationView(userId: number, provider: IntegrationProvider): IntegrationView {
  const row = getRow(userId, provider);
  const source = credsSource(userId, provider);
  const metadata = row?.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {};

  // Surface a few non-secret hints so the dashboard can show "configured as …".
  const creds = getIntegrationCreds(userId, provider);
  if (creds) {
    if (provider === 'twilio') {
      const t = creds as TwilioCreds;
      metadata.sid_masked = t.sid ? `${t.sid.slice(0, 6)}…${t.sid.slice(-4)}` : undefined;
      metadata.from_number = t.from_number;
      metadata.has_messaging_service = Boolean(t.messaging_service_sid);
    } else {
      const k = (creds as ApiKeyCreds).api_key;
      metadata.key_masked = k ? `${k.slice(0, 5)}…${k.slice(-4)}` : undefined;
    }
  }

  return {
    provider,
    status: row?.status ?? (source === 'env' ? 'configured' : 'unconfigured'),
    configured: source !== 'none',
    source,
    last_tested_at: row?.last_tested_at ?? null,
    last_error: row?.last_error ?? null,
    metadata,
  };
}

export function getAllIntegrationViews(userId: number): IntegrationView[] {
  return ALL_INTEGRATION_PROVIDERS.map((p) => getIntegrationView(userId, p));
}
