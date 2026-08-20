import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center, listRowsVisible } from '../render.js';
import { BODY_TOP, BODY_BOTTOM, setAppStatus } from '../chrome.js';
import { getPairing } from '../kvs.js';
import { apiGet, HudApiError } from '../api.js';
import { getBridge } from '../bridge.js';
import { getPrefs, hydratePrefs } from '../prefs.js';
import { Pulse, SIGNAL_HEIGHT } from '../pulse.js';
import { ComposePage } from './compose.js';
import { InboxPage } from './inbox.js';
import { VoicePage } from './voice.js';
import { StylePage } from './style.js';

/**
 * Idle — the VOX home screen.
 *
 * This is the page the wearer lands on at launch and returns to from
 * everywhere, so it has to answer "what can VOX do?" without a tap. Up to
 * v0.1.16 it was a breathing pulse plus a single full-width "tap to speak"
 * capture surface: every feature except voice-compose was unreachable from
 * the glasses, and any stray tap (including the temple touch that launched
 * the app) dropped the wearer straight into the recording screen.
 *
 * v0.1.17 makes it a real menu. The pulse shrinks to a 3-line breath and the
 * rest of the body is a native scrollable action list. A stray tap now lands
 * on a highlighted menu row instead of opening the microphone.
 *
 * Layout (chrome adds ids 90 + 99; the renderer pads text 3, 4):
 *   y BODY_TOP .. +52   pulse  (id 2, text, no capture, animated)
 *   y BODY_TOP+56 ..    menu   (id 5, list, CAPTURE)
 */

const PULSE_ID = 2;
const MENU_ID = 5;

const MENU_Y = BODY_TOP + SIGNAL_HEIGHT + 4;
const MENU_H = BODY_BOTTOM - MENU_Y;

interface IdleStatus {
  twilio: boolean;
  email: boolean;
  unread: number;
}

interface HistoryItem {
  channel: 'sms' | 'email';
  direction: 'out' | 'in';
  body: string;
  contact_name: string | null;
  created_at: string;
  status: string;
}

interface LastSent {
  name: string;
  minutesAgo: number;
  channel: 'sms' | 'email';
}

/** One menu row: the label the firmware draws, and what a tap does. */
interface MenuRow {
  key: string;
  label: string;
  run: (ctx: PageContext) => Promise<void>;
}

let lastSent: LastSent | null = null;
let unreadCount = 0;
let pulse: Pulse | null = null;
let rows: MenuRow[] = [];

function buildRows(): MenuRow[] {
  // Cap the badge: a first IMAP sync backfills the whole mailbox (I-004), so
  // this can legitimately read in the thousands, which is noise rather than
  // information on a 32-char row.
  const badge = unreadCount > 99 ? '99+ new' : unreadCount > 0 ? `${unreadCount} new` : '';
  const inboxLabel = badge ? `Inbox`.padEnd(22) + badge : 'Inbox';
  const style = capitalize(getPrefs().default_tone);
  return [
    { key: 'speak', label: 'Speak a message', run: (ctx) => ctx.router.push(ComposePage) },
    { key: 'inbox', label: inboxLabel, run: (ctx) => ctx.router.push(InboxPage) },
    { key: 'voice', label: 'Voice command', run: (ctx) => ctx.router.push(VoicePage) },
    { key: 'style', label: `Style: ${style}`, run: (ctx) => ctx.router.push(StylePage) },
  ];
}

export const IdlePage: Page = {
  id: 'idle',

  async mount(ctx: PageContext): Promise<void> {
    const paired = (await getPairing()) !== null;
    if (!paired) {
      rows = [];
      await renderUnpaired(ctx);
      return;
    }

    await renderIdle(ctx);
    // Pulse.start() is idempotent, but we also own the instance here so a
    // re-mount can never strand a second interval on the same container.
    pulse?.stop();
    pulse = new Pulse(ctx.bridge, PULSE_ID);
    pulse.start();

    // Fire-and-forget refresh. When it lands, re-render with real counts.
    void refreshAndPatch(ctx);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'foreground-enter') {
      // remount() runs unmount() first — that's what stops the old pulse.
      await ctx.router.remount();
      return;
    }
    if (event.kind !== 'list-select') return;
    // Only our own menu container drives navigation. The renderer pads every
    // chrome page with off-screen list ids; without this check a selection
    // event attributed to one of those would fire a real action.
    if (event.containerID !== MENU_ID) return;
    const row = rows[event.index];
    if (!row) return;
    await row.run(ctx);
  },

  unmount(): void {
    pulse?.stop();
    pulse = null;
  },
};

async function renderIdle(ctx: PageContext): Promise<void> {
  rows = buildRows();
  await showPage(ctx.bridge, {
    texts: [
      {
        id: PULSE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: SIGNAL_HEIGHT,
        border: 0,
        padding: 2,
        capture: false,
        content: Pulse.initialFrame(),
      },
    ],
    lists: [
      {
        id: MENU_ID,
        x: 0,
        y: MENU_Y,
        w: 576,
        h: MENU_H,
        border: 1,
        padding: 6,
        capture: true,
        items: rows.map((r) => r.label),
      },
    ],
    chrome: { hint: footerHint() },
  });
}

async function renderUnpaired(ctx: PageContext): Promise<void> {
  await showPage(ctx.bridge, {
    texts: [
      {
        id: PULSE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: BODY_BOTTOM - BODY_TOP,
        border: 0,
        padding: 8,
        capture: true,
        content: center('\n\nNot paired.\nOpen VOX on your phone to pair.'),
      },
    ],
    chrome: { hint: '2x to exit' },
  });
}

function footerHint(): string {
  // Idle is the ONE page where a double-tap leaves the app (Even Hub
  // submission gate), so we always say so rather than let the wearer guess.
  const exit = '2x to exit';
  if (!lastSent) return exit;
  const method = lastSent.channel === 'sms' ? 'SMS' : 'Email';
  const ago = formatAgo(lastSent.minutesAgo);
  const when = ago === 'just now' ? ago : `${ago} ago`;
  return `${method} to ${lastSent.name} - ${when}   ·   ${exit}`;
}

function formatAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

async function refreshAndPatch(ctx: PageContext): Promise<void> {
  const [idleData, history, deviceInfo] = await Promise.all([
    fetchIdleStatus(),
    fetchLastSent(),
    fetchBattery(),
    // Hydrate preferences on the same round trip so the Style row shows the
    // tone the dashboard actually has saved.
    hydratePrefs().catch(() => undefined),
  ]);
  setAppStatus({
    twilio: idleData?.twilio ?? false,
    email: idleData?.email ?? false,
    battery: deviceInfo,
    unread: idleData?.unread ?? 0,
  });
  unreadCount = idleData?.unread ?? 0;
  if (history) lastSent = history;

  // Re-render so the new counts + style land. Same container shape as the
  // initial mount, so this is a cheap in-place rebuild.
  if (ctx.router.currentId === 'idle') {
    await renderIdle(ctx);
  }
}

async function fetchIdleStatus(): Promise<IdleStatus | null> {
  try {
    const data = await apiGet<{ status: IdleStatus }>('/api/idle-suggestions');
    return data.status;
  } catch (err) {
    if (err instanceof HudApiError) {
      console.warn(`[idle] status fetch failed: ${err.code}`);
    }
    return null;
  }
}

async function fetchLastSent(): Promise<LastSent | null> {
  try {
    const data = await apiGet<{ items: HistoryItem[] }>('/api/history?limit=1&direction=out');
    const item = data.items[0];
    if (!item) return null;
    const minutesAgo = Math.max(
      0,
      Math.floor((Date.now() - new Date(item.created_at).getTime()) / 60000),
    );
    return { name: item.contact_name ?? 'someone', minutesAgo, channel: item.channel };
  } catch {
    return null;
  }
}

async function fetchBattery(): Promise<number | null> {
  try {
    const info = await getBridge().getDeviceInfo();
    return info?.status.batteryLevel ?? null;
  } catch {
    return null;
  }
}

/** The menu height is derived, not hand-tuned — shout if a row won't fit. */
if (listRowsVisible(MENU_H) < 4) {
  console.warn(`[idle] menu shows ${listRowsVisible(MENU_H)} of 4 rows — a feature is unreachable`);
}
