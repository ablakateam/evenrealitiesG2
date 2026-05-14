import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { log } from '../log.js';
import {
  decryptCreds,
  getEmailAccount,
  setImapStatus,
  setImapLastUid,
  type EmailAccountStored,
} from './account.js';
import { parseRawEmail } from './parse.js';
import { inboxBus } from './sse-bus.js';
import { getDb } from '../db.js';

const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/**
 * Persistent IMAP IDLE worker for a single user's mailbox.
 *
 * Lifecycle: connect → SELECT INBOX → backfill new UIDs since
 * imap_last_uid → enter IDLE → on `exists` event, fetch + persist + publish
 * SSE → on disconnect, exponential-backoff reconnect.
 *
 * Token refresh hook: when the OAuth access token expires, calling code can
 * inject a new one via setOauthAccessToken() to avoid full reconnect.
 */
export class ImapIdleWorker {
  private client: ImapFlow | null = null;
  private stopRequested = false;
  private retries = 0;
  private currentBackoff: NodeJS.Timeout | null = null;

  constructor(public readonly userId: number) {}

  async start(): Promise<void> {
    this.stopRequested = false;
    await this.connectLoop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.currentBackoff) {
      clearTimeout(this.currentBackoff);
      this.currentBackoff = null;
    }
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // ignore
      }
      this.client = null;
    }
    setImapStatus(this.userId, 'disconnected');
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.connectOnce();
        // connectOnce only returns when the connection ended cleanly; if it threw,
        // the catch below schedules backoff.
        this.retries = 0;
      } catch (err) {
        if (this.stopRequested) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ userId: this.userId, err: msg, attempt: this.retries }, 'imap idle worker error');
        setImapStatus(this.userId, 'error', msg);
        const delay = BACKOFF_SCHEDULE_MS[Math.min(this.retries, BACKOFF_SCHEDULE_MS.length - 1)];
        this.retries++;
        await new Promise<void>((resolve) => {
          this.currentBackoff = setTimeout(() => {
            this.currentBackoff = null;
            resolve();
          }, delay);
        });
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const row = getEmailAccount(this.userId);
    if (!row) throw new Error('no email_accounts row');
    const creds = decryptCreds(row);
    if (!creds.imap.host || !creds.imap.port) throw new Error('imap host/port not set');

    const client = new ImapFlow({
      host: creds.imap.host,
      port: creds.imap.port,
      secure: creds.imap.security === 'ssl',
      auth: creds.imap.oauth_access_token
        ? { user: creds.imap.username ?? creds.email_address, accessToken: creds.imap.oauth_access_token }
        : { user: creds.imap.username ?? creds.email_address, pass: creds.imap.password ?? '' },
      logger: false,
    });
    this.client = client;

    client.on('error', (err) => {
      log.warn({ userId: this.userId, err: err.message }, 'imapflow error event');
    });

    await client.connect();
    log.info({ userId: this.userId, host: creds.imap.host }, 'imap connected');

    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox as { uidNext?: number; exists?: number };
      const startUid = (row.imap_last_uid ?? 0) + 1;
      const uidNext = mailbox.uidNext ?? startUid;
      setImapStatus(this.userId, 'live');

      // Backfill any UIDs we missed while disconnected.
      if (startUid < uidNext) {
        await this.fetchRange(client, row, `${startUid}:*`);
      }

      // Enter IDLE — IMAP server pushes 'exists' events when new mail arrives.
      client.on('exists', async () => {
        try {
          await this.fetchSinceLast(client, row);
        } catch (err) {
          log.warn({ userId: this.userId, err: err instanceof Error ? err.message : String(err) }, 'fetch-on-exists failed');
        }
      });

      await client.idle();
      // If idle returns, mailbox lock should be re-acquired by caller (we exit loop here)
    } finally {
      lock.release();
    }
  }

  private async fetchSinceLast(client: ImapFlow, row: EmailAccountStored): Promise<void> {
    const lastUid = (getEmailAccount(this.userId)?.imap_last_uid ?? row.imap_last_uid ?? 0);
    await this.fetchRange(client, row, `${lastUid + 1}:*`);
  }

  private async fetchRange(client: ImapFlow, _row: EmailAccountStored, range: string): Promise<void> {
    const messages: FetchMessageObject[] = [];
    for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true }, { uid: true })) {
      messages.push(msg);
    }
    messages.sort((a, b) => Number(a.uid) - Number(b.uid));

    const db = getDb();
    let highestUid = 0;
    for (const msg of messages) {
      const uid = Number(msg.uid);
      highestUid = Math.max(highestUid, uid);
      if (!msg.source) continue;
      try {
        const parsed = await parseRawEmail(msg.source as Buffer, uid);
        if (!parsed.from_address) continue;

        // Resolve contact by email match
        const contact = db
          .prepare('SELECT id FROM contacts WHERE user_id = ? AND email = ?')
          .get(this.userId, parsed.from_address) as { id: number } | undefined;

        const insertResult = db
          .prepare(
            `INSERT INTO inbox (user_id, contact_id, channel, from_address, body, subject, received_at, raw_payload_json)
             VALUES (?, ?, 'email', ?, ?, ?, ?, ?)`,
          )
          .run(
            this.userId,
            contact?.id ?? null,
            parsed.from_address,
            parsed.body_text,
            parsed.subject,
            parsed.date_received,
            JSON.stringify({
              uid,
              message_id: parsed.message_id,
              from_name: parsed.from_name,
              body_html: parsed.body_html ? parsed.body_html.slice(0, 50_000) : null,
              size_bytes: parsed.size_bytes,
            }),
          );

        const inboxId = Number(insertResult.lastInsertRowid);
        inboxBus.publishNew(this.userId, {
          kind: 'new',
          inbox_id: inboxId,
          channel: 'email',
          from_address: parsed.from_address,
          from_name: parsed.from_name,
          contact_id: contact?.id ?? null,
          subject: parsed.subject,
          body: parsed.body_text,
          received_at: parsed.date_received,
        });
      } catch (err) {
        log.warn(
          { userId: this.userId, uid, err: err instanceof Error ? err.message : String(err) },
          'failed to parse + persist incoming mail',
        );
      }
    }
    if (highestUid > 0) setImapLastUid(this.userId, highestUid);
  }
}
