import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';
import { log } from './log.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  mkdirSync(dirname(env.DB_PATH), { recursive: true });
  dbInstance = new Database(env.DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('synchronous = NORMAL');
  runMigrations(dbInstance);
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'initial schema — users, integrations, contacts, templates, preferences, history, inbox, outbox, client_errors',
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          shared_secret_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          rotated_at TEXT
        );

        CREATE TABLE preferences (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          default_channel TEXT NOT NULL DEFAULT 'sms',
          default_tone TEXT NOT NULL DEFAULT 'casual',
          always_grammar_fix INTEGER NOT NULL DEFAULT 1,
          rewrite_provider TEXT NOT NULL DEFAULT 'anthropic',
          rewrite_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
          voice_language TEXT NOT NULL DEFAULT 'en',
          confirm_before_send INTEGER NOT NULL DEFAULT 1,
          smart_channel_inference INTEGER NOT NULL DEFAULT 1,
          smart_idle INTEGER NOT NULL DEFAULT 1,
          smart_pause INTEGER NOT NULL DEFAULT 0,
          tone_memory_per_contact INTEGER NOT NULL DEFAULT 1,
          long_press_send_last INTEGER NOT NULL DEFAULT 0,
          always_on_voice INTEGER NOT NULL DEFAULT 0,
          max_recording_seconds INTEGER NOT NULL DEFAULT 60,
          silence_autostop_seconds INTEGER NOT NULL DEFAULT 4,
          notify_on_sms INTEGER NOT NULL DEFAULT 1,
          notify_on_email INTEGER NOT NULL DEFAULT 1,
          quiet_hours_start TEXT,
          quiet_hours_end TEXT,
          sender_filter TEXT NOT NULL DEFAULT 'anyone',
          daily_sms_limit INTEGER NOT NULL DEFAULT 100,
          daily_email_limit INTEGER NOT NULL DEFAULT 50,
          daily_token_limit INTEGER NOT NULL DEFAULT 50000,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE integrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          key_encrypted TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'unconfigured',
          last_tested_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, provider)
        );

        CREATE TABLE email_accounts (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          email_address TEXT NOT NULL,
          display_name TEXT,
          oauth_refresh_token_encrypted TEXT,
          oauth_access_token_encrypted TEXT,
          oauth_expires_at TEXT,
          smtp_host TEXT,
          smtp_port INTEGER,
          smtp_security TEXT,
          imap_host TEXT,
          imap_port INTEGER,
          imap_security TEXT,
          username TEXT,
          password_encrypted TEXT,
          imap_status TEXT NOT NULL DEFAULT 'disconnected',
          imap_last_uid INTEGER,
          last_synced_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          phone_e164 TEXT,
          email TEXT,
          default_channel TEXT,
          last_used_channel TEXT,
          usual_tone TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'manual',
          source_id TEXT,
          last_sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_contacts_user_phone ON contacts(user_id, phone_e164);
        CREATE INDEX idx_contacts_user_email ON contacts(user_id, email);
        CREATE INDEX idx_contacts_user_name ON contacts(user_id, name);

        CREATE TABLE templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          body TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_templates_user ON templates(user_id, sort_order);

        CREATE TABLE history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          channel TEXT NOT NULL,
          direction TEXT NOT NULL,
          body TEXT NOT NULL,
          subject TEXT,
          tone TEXT,
          status TEXT NOT NULL,
          error TEXT,
          cost_cents INTEGER,
          tokens_used INTEGER,
          provider_message_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_history_user_time ON history(user_id, created_at DESC);

        CREATE TABLE inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          channel TEXT NOT NULL,
          from_address TEXT NOT NULL,
          body TEXT NOT NULL,
          subject TEXT,
          received_at TEXT NOT NULL DEFAULT (datetime('now')),
          read_at TEXT,
          raw_payload_json TEXT
        );
        CREATE INDEX idx_inbox_user_received ON inbox(user_id, received_at DESC);
        CREATE INDEX idx_inbox_user_unread ON inbox(user_id, read_at) WHERE read_at IS NULL;

        CREATE TABLE outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_uuid TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          channel TEXT NOT NULL,
          body TEXT NOT NULL,
          subject TEXT,
          tone TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          last_error TEXT,
          sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_outbox_pending ON outbox(status, next_retry_at) WHERE status IN ('pending', 'retrying');

        CREATE TABLE client_errors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          message TEXT NOT NULL,
          stack TEXT,
          page TEXT,
          sdk_version TEXT,
          app_version TEXT,
          received_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE rate_limit_state (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          bucket TEXT NOT NULL,
          window_start TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, bucket, window_start)
        );
      `);
    },
  },
  {
    version: 2,
    description: "voice_language: default 'en' instead of 'auto'",
    up: (db) => {
      // Leaving Whisper to auto-detect produced transcriptions in languages
      // the wearer never spoke (English in, Japanese out). Pinning a
      // language removes that failure mode entirely. Existing rows are
      // migrated off 'auto'; a multilingual user can set it back from the
      // dashboard and own the tradeoff knowingly.
      db.exec(`UPDATE preferences SET voice_language = 'en' WHERE voice_language = 'auto';`);
    },
  },
];

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), description TEXT);`);
  const currentVersion =
    (db.prepare('SELECT MAX(version) AS v FROM schema_meta').get() as { v: number | null })?.v ?? 0;

  for (const m of migrations) {
    if (m.version <= currentVersion) continue;
    log.info({ migration: m.version, description: m.description }, 'applying migration');
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_meta (version, description) VALUES (?, ?)').run(m.version, m.description);
    })();
  }
}

export function schemaVersion(): number {
  const db = getDb();
  return (db.prepare('SELECT MAX(version) AS v FROM schema_meta').get() as { v: number | null })?.v ?? 0;
}
