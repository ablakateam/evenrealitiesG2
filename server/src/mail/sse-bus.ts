import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for inbox events.
 *
 * The IMAP IDLE worker publishes here when a new email arrives; SSE clients
 * subscribed via /api/inbox/stream receive the event. Per-user channels via
 * keyed event names.
 */
class InboxBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // dashboard + multiple paired G2s
  }
  publishNew(userId: number, event: InboxEventPayload): void {
    this.emit(`inbox:${userId}`, event);
  }
  publishRead(userId: number, inboxId: number): void {
    this.emit(`inbox:${userId}`, { kind: 'read', inbox_id: inboxId });
  }
  subscribe(userId: number, listener: (e: InboxEventPayload) => void): () => void {
    const event = `inbox:${userId}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }
}

export type InboxEventPayload =
  | {
      kind: 'new';
      inbox_id: number;
      channel: 'sms' | 'email';
      from_address: string;
      from_name?: string | null;
      contact_id?: number | null;
      subject?: string | null;
      body: string;
      received_at: string;
    }
  | { kind: 'read'; inbox_id: number };

export const inboxBus = new InboxBus();
