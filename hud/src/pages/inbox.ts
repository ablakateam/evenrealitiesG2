import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { apiGet, HudApiError } from '../api.js';
import { makeInboxReadPage } from './inbox-read.js';

/**
 * Inbox — paginated list of received SMS + email. Title shows total unread.
 * Each row is a one-line preview: `from   12:37 *` (asterisk = unread).
 * Tap → InboxReadPage for the full body + reply action.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

export interface InboxItem {
  id: number;
  channel: 'sms' | 'email';
  contact_id: number | null;
  from_address: string;
  subject: string | null;
  body: string;
  received_at: string;
  read_at: string | null;
}

interface InboxResponse {
  items: InboxItem[];
  unread_count: number;
}

let items: InboxItem[] = [];

export const InboxPage: Page = {
  id: 'inbox',

  async mount(ctx: PageContext): Promise<void> {
    let unread = 0;
    let errorMsg: string | null = null;
    try {
      const data = await apiGet<InboxResponse>('/api/inbox?limit=20');
      items = data.items;
      unread = data.unread_count;
    } catch (err) {
      errorMsg = err instanceof HudApiError ? `Couldn't load inbox: ${err.code}` : 'Network error.';
      items = [];
    }

    const list = items.length > 0 ? items.map(formatRow) : [errorMsg ?? 'Nothing in inbox.'];
    await showPage(ctx.bridge, {
      texts: [
        {
          id: TITLE_ID,
          x: 0,
          y: 0,
          w: 576,
          h: 44,
          capture: false,
          content: `INBOX  -  ${unread} unread`,
        },
        {
          id: FOOTER_ID,
          x: 0,
          y: 236,
          w: 576,
          h: 48,
          capture: false,
          content: '[SCRL] move  [TAP] open  [X2] back',
        },
      ],
      lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items: list }],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const picked = items[event.index];
    if (!picked) return;
    await ctx.router.push(makeInboxReadPage(picked));
  },
};

function formatRow(item: InboxItem): string {
  // 32-char budget: sender(22) when(4) space unread(1) = 28 visible chars.
  // Use the full from_address — it scans better than just the local part
  // (a bare "support" is useless; "support@<service>" is meaningful).
  const sender = clip(item.from_address, 22);
  const unread = item.read_at ? ' ' : '*';
  const when = formatWhen(item.received_at);
  return `${sender.padEnd(22)}${when} ${unread}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.floor(diffMs / 60000);
    return `${mins}m`.padStart(4, ' ');
  }
  if (hours < 24) return `${hours}h`.padStart(4, ' ');
  const days = Math.floor(hours / 24);
  return `${days}d`.padStart(4, ' ');
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
