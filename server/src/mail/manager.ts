import { log } from '../log.js';
import { getAllAccounts } from './account.js';
import { ImapIdleWorker } from './idle.js';

/**
 * Owns one IMAP IDLE worker per user with an active email_accounts row.
 * Started on server boot, can be re-synced when a user
 * adds / updates / removes an account.
 */
class ImapManager {
  private workers = new Map<number, ImapIdleWorker>();

  async startAll(): Promise<void> {
    const accounts = getAllAccounts();
    log.info({ count: accounts.length }, 'imap-manager: starting workers');
    for (const acc of accounts) {
      await this.ensureWorker(acc.user_id);
    }
  }

  async stopAll(): Promise<void> {
    log.info({ count: this.workers.size }, 'imap-manager: stopping all workers');
    await Promise.all(Array.from(this.workers.values()).map((w) => w.stop()));
    this.workers.clear();
  }

  async ensureWorker(userId: number): Promise<void> {
    if (this.workers.has(userId)) return;
    const worker = new ImapIdleWorker(userId);
    this.workers.set(userId, worker);
    void worker.start().catch((err) => {
      log.error({ userId, err: err instanceof Error ? err.message : String(err) }, 'imap worker start threw');
    });
  }

  async restartWorker(userId: number): Promise<void> {
    const existing = this.workers.get(userId);
    if (existing) {
      await existing.stop();
      this.workers.delete(userId);
    }
    await this.ensureWorker(userId);
  }

  async stopWorker(userId: number): Promise<void> {
    const existing = this.workers.get(userId);
    if (existing) {
      await existing.stop();
      this.workers.delete(userId);
    }
  }

  size(): number {
    return this.workers.size;
  }
}

export const imapManager = new ImapManager();
