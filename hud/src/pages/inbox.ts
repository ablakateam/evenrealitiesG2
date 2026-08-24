import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { apiGet, HudApiError } from '../api.js';
import { makeInboxReadPage } from './inbox-read.js';

/**
 * Inbox — received SMS + email. Each row is a one-line preview:
 * `from                 12m *`  (asterisk = unread). Tap opens the full body.
 *
 * Container shape: chrome (ids 90 + 99) + title text 2 + list 5, matching
 * every other page in the app. It previously used a bare {1, 2, 3} shape
 * with NO chrome — a holdover from P17, before render.ts started padding
 * pages to the maximal 6-container form. Navigating Idle -> Inbox -> back
 * would have dropped ids 3, 4, 90, 99 and then re-introduced them, which is
 * the exact L:38 silent-rebuild trap. It never bit us only because the page
 * had no reachable entry point; wiring it to the Idle menu made fixing the
 * shape a prerequisite.
 */

const TITLE_ID = 2;
const LIST_ID = 5;

const TITLE_H = 26;
const LIST_Y = BODY_TOP + TITLE_H + 4;
const LIST_H = BODY_BOTTOM - LIST_Y;

const MAX_ROWS = 19; // 20-item firmware cap, keep one spare

export interface InboxItem {
  id: number;
  channel: 'sms' | 'email';
  contact_id: number | null;
  from_address: string;
  /** Contact name when the sender is known. Absent for unknown senders. */
  contact_name?: string | null;
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
    // Render a loading state first so the wearer gets feedback immediately
    // instead of staring at the previous page during the round trip.
    await render(ctx, 'loading', 0, []);

    let unread = 0;
    let errorMsg: string | null = null;
    try {
      const data = await apiGet<InboxResponse>('/api/inbox?limit=20');
      items = data.items.slice(0, MAX_ROWS);
      unread = data.unread_count;
    } catch (err) {
      errorMsg = err instanceof HudApiError ? `couldn't load inbox (${err.code})` : 'network error';
      items = [];
    }

    if (errorMsg) {
      await render(ctx, 'error', 0, [errorMsg]);
      return;
    }
    if (items.length === 0) {
      await render(ctx, 'empty', 0, ['nothing here yet']);
      return;
    }
    await render(ctx, 'ready', unread, items.map(formatRow));
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    if (event.containerID !== LIST_ID) return;
    const picked = items[event.index];
    if (!picked) return;
    await ctx.router.push(makeInboxReadPage(picked));
  },
};

type State = 'loading' | 'ready' | 'empty' | 'error';

async function render(ctx: PageContext, state: State, unread: number, rows: string[]): Promise<void> {
  const title =
    state === 'ready' ? `inbox  ·  ${unread} unread` : state === 'loading' ? 'inbox' : 'inbox';
  const hint =
    state === 'ready'
      ? 'tap to open  ·  2x for home'
      : state === 'loading'
        ? 'loading...'
        : '2x for home';
  await showPage(ctx.bridge, {
    texts: [
      {
        id: TITLE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: TITLE_H,
        border: 0,
        padding: 4,
        capture: false,
        content: center(title),
      },
    ],
    lists: [
      {
        id: LIST_ID,
        x: 0,
        y: LIST_Y,
        w: 576,
        h: LIST_H,
        border: 1,
        padding: 6,
        capture: true,
        items: rows.length > 0 ? rows : ['...'],
      },
    ],
    chrome: { hint },
  });
}

function formatRow(item: InboxItem): string {
  // 32-char budget: sender(22) + when(4) + space + unread(1) = 28 visible.
  // A known sender reads as a name; the raw address is the fallback. The list
  // endpoint returns contact_name, so this matches what opening the message
  // has always shown.
  //
  // Full from_address scans better than the local part alone — a bare
  // "alex" could be any of several addresses, and on a 22-char budget the
  // domain is what disambiguates.
  const sender = clip(item.contact_name?.trim() || item.from_address, 22);
  const unread = item.read_at ? ' ' : '*';
  const when = formatWhen(item.received_at);
  return `${sender.padEnd(22)}${when} ${unread}`;
}

function formatWhen(iso: string): string {
  // SQLite datetime('now') has no timezone suffix; treat it as UTC or the
  // relative time is off by the local offset.
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    return `${mins}m`.padStart(4, ' ');
  }
  if (hours < 24) return `${hours}h`.padStart(4, ' ');
  return `${Math.floor(hours / 24)}d`.padStart(4, ' ');
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
