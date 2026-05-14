import { getDb } from '../db.js';
import { encryptString, decryptString } from '../crypto.js';

/**
 * email_accounts row model (one per user).
 * Credentials are stored encrypted via libsodium-equivalent AES-256-GCM
 * (see crypto.ts). Only decrypted in-memory just before SMTP/IMAP use.
 */
export type EmailProvider = 'gmail' | 'outlook' | 'icloud' | 'custom';
export type Security = 'ssl' | 'starttls' | 'none';

export interface EmailAccountInput {
  provider: EmailProvider;
  email_address: string;
  display_name?: string;
  // For custom/password mode:
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: Security;
  imap_host?: string;
  imap_port?: number;
  imap_security?: Security;
  username?: string;
  password?: string;
  // For OAuth (Gmail/Outlook):
  oauth_refresh_token?: string;
  oauth_access_token?: string;
  oauth_expires_at?: string; // ISO timestamp
}

/** Account as stored — encrypted columns held opaque until decrypt() is called. */
export interface EmailAccountStored {
  user_id: number;
  provider: EmailProvider;
  email_address: string;
  display_name: string | null;
  oauth_refresh_token_encrypted: string | null;
  oauth_access_token_encrypted: string | null;
  oauth_expires_at: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: Security | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: Security | null;
  username: string | null;
  password_encrypted: string | null;
  imap_status: string;
  imap_last_uid: number | null;
  last_synced_at: string | null;
  last_error: string | null;
}

/** Account as exposed to API consumers — decrypted creds + masked. */
export interface EmailAccountView {
  provider: EmailProvider;
  email_address: string;
  display_name: string | null;
  has_oauth: boolean;
  has_password: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: Security | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: Security | null;
  username: string | null;
  imap_status: string;
  last_synced_at: string | null;
  last_error: string | null;
}

/** Decrypted creds for SMTP/IMAP at use-time. Never serialize back to a client. */
export interface EmailAccountCreds {
  provider: EmailProvider;
  email_address: string;
  smtp: {
    host?: string;
    port?: number;
    security?: Security;
    username?: string;
    password?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    oauth_expires_at?: string;
  };
  imap: {
    host?: string;
    port?: number;
    security?: Security;
    username?: string;
    password?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    oauth_expires_at?: string;
  };
}

/** Sensible defaults per provider. User can override. */
const PROVIDER_DEFAULTS: Record<EmailProvider, Partial<EmailAccountInput>> = {
  gmail: {
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_security: 'ssl',
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_security: 'ssl',
  },
  outlook: {
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
    smtp_security: 'starttls',
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    imap_security: 'ssl',
  },
  icloud: {
    smtp_host: 'smtp.mail.me.com',
    smtp_port: 587,
    smtp_security: 'starttls',
    imap_host: 'imap.mail.me.com',
    imap_port: 993,
    imap_security: 'ssl',
  },
  custom: {},
};

/** Upsert an email account, applying provider defaults where the caller didn't specify. */
export function upsertEmailAccount(userId: number, input: EmailAccountInput): void {
  const defaults = PROVIDER_DEFAULTS[input.provider] ?? {};
  const merged: EmailAccountInput = {
    ...defaults,
    ...input,
    // Username defaults to email address for most providers
    username: input.username ?? input.email_address,
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO email_accounts (
      user_id, provider, email_address, display_name,
      oauth_refresh_token_encrypted, oauth_access_token_encrypted, oauth_expires_at,
      smtp_host, smtp_port, smtp_security,
      imap_host, imap_port, imap_security,
      username, password_encrypted,
      imap_status, updated_at
    ) VALUES (
      @user_id, @provider, @email_address, @display_name,
      @oauth_refresh_token_encrypted, @oauth_access_token_encrypted, @oauth_expires_at,
      @smtp_host, @smtp_port, @smtp_security,
      @imap_host, @imap_port, @imap_security,
      @username, @password_encrypted,
      'disconnected', datetime('now')
    )
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      email_address = excluded.email_address,
      display_name = excluded.display_name,
      oauth_refresh_token_encrypted = COALESCE(excluded.oauth_refresh_token_encrypted, email_accounts.oauth_refresh_token_encrypted),
      oauth_access_token_encrypted = COALESCE(excluded.oauth_access_token_encrypted, email_accounts.oauth_access_token_encrypted),
      oauth_expires_at = COALESCE(excluded.oauth_expires_at, email_accounts.oauth_expires_at),
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_security = excluded.smtp_security,
      imap_host = excluded.imap_host,
      imap_port = excluded.imap_port,
      imap_security = excluded.imap_security,
      username = excluded.username,
      password_encrypted = COALESCE(excluded.password_encrypted, email_accounts.password_encrypted),
      updated_at = datetime('now'),
      imap_status = CASE WHEN email_accounts.imap_status = 'error' THEN 'disconnected' ELSE email_accounts.imap_status END
  `,
  ).run({
    user_id: userId,
    provider: merged.provider,
    email_address: merged.email_address,
    display_name: merged.display_name ?? null,
    oauth_refresh_token_encrypted: merged.oauth_refresh_token ? encryptString(merged.oauth_refresh_token) : null,
    oauth_access_token_encrypted: merged.oauth_access_token ? encryptString(merged.oauth_access_token) : null,
    oauth_expires_at: merged.oauth_expires_at ?? null,
    smtp_host: merged.smtp_host ?? null,
    smtp_port: merged.smtp_port ?? null,
    smtp_security: merged.smtp_security ?? null,
    imap_host: merged.imap_host ?? null,
    imap_port: merged.imap_port ?? null,
    imap_security: merged.imap_security ?? null,
    username: merged.username ?? null,
    password_encrypted: merged.password ? encryptString(merged.password) : null,
  });
}

export function getEmailAccount(userId: number): EmailAccountStored | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_accounts WHERE user_id = ?').get(userId) as
    | EmailAccountStored
    | undefined;
  return row ?? null;
}

export function getAllAccounts(): EmailAccountStored[] {
  const db = getDb();
  return db.prepare('SELECT * FROM email_accounts').all() as EmailAccountStored[];
}

export function deleteEmailAccount(userId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM email_accounts WHERE user_id = ?').run(userId);
}

/** Convert a stored row to the dashboard-safe view (no secrets). */
export function toView(row: EmailAccountStored): EmailAccountView {
  return {
    provider: row.provider,
    email_address: row.email_address,
    display_name: row.display_name,
    has_oauth: Boolean(row.oauth_refresh_token_encrypted),
    has_password: Boolean(row.password_encrypted),
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_security: row.smtp_security,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_security: row.imap_security,
    username: row.username,
    imap_status: row.imap_status,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
  };
}

/** Decrypt credentials for SMTP/IMAP use. Caller should not log the result. */
export function decryptCreds(row: EmailAccountStored): EmailAccountCreds {
  const password = row.password_encrypted ? decryptString(row.password_encrypted) : undefined;
  const oauth_access_token = row.oauth_access_token_encrypted ? decryptString(row.oauth_access_token_encrypted) : undefined;
  const oauth_refresh_token = row.oauth_refresh_token_encrypted ? decryptString(row.oauth_refresh_token_encrypted) : undefined;
  const sharedAuth = {
    username: row.username ?? row.email_address,
    password,
    oauth_access_token,
    oauth_refresh_token,
    oauth_expires_at: row.oauth_expires_at ?? undefined,
  };
  return {
    provider: row.provider,
    email_address: row.email_address,
    smtp: {
      host: row.smtp_host ?? undefined,
      port: row.smtp_port ?? undefined,
      security: row.smtp_security ?? undefined,
      ...sharedAuth,
    },
    imap: {
      host: row.imap_host ?? undefined,
      port: row.imap_port ?? undefined,
      security: row.imap_security ?? undefined,
      ...sharedAuth,
    },
  };
}

/** Update IMAP status (called by the IDLE worker). */
export function setImapStatus(userId: number, status: string, lastError?: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE email_accounts SET imap_status = ?, last_error = ?, last_synced_at = datetime('now') WHERE user_id = ?`,
  ).run(status, lastError ?? null, userId);
}

export function setImapLastUid(userId: number, uid: number): void {
  const db = getDb();
  db.prepare(`UPDATE email_accounts SET imap_last_uid = ?, last_synced_at = datetime('now') WHERE user_id = ?`).run(
    uid,
    userId,
  );
}
