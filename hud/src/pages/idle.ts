import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM, setAppStatus } from '../chrome.js';
import { getPairing } from '../kvs.js';
import { apiGet, HudApiError } from '../api.js';
import { getBridge } from '../bridge.js';
import { ComposePage } from './compose.js';
import { Pulse } from '../pulse.js';

/**
 * Idle — the calm front door of VOX.
 *
 * One real action: a big "tap to speak" capture surface. Above it, a calm
 * breathing pulse (see `pulse.ts`) signals "VOX is alive and listening."
 * Status lives in the chrome header; last sent / unread count lives in
 * the chrome footer. Anything else — inbox, contacts, history — is one
 * voice command away.
 *
 * Layout (chrome adds id 90 + 99 automatically; body uses 2 + 3):
 *   y BODY_TOP..+96             pulse        (id 2, text, no capture, animated)
 *   y BODY_TOP+104..BODY_BOTTOM tap target   (id 3, text, CAPTURE)
 */

const PULSE_ID = 2;
const TAP_ID = 3;

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
  body: string;
  minutesAgo: number;
  channel: 'sms' | 'email';
}

let lastSent: LastSent | null = null;
let pulse: Pulse | null = null;

export const IdlePage: Page = {
  id: 'idle',

  async mount(ctx: PageContext): Promise<void> {
    const paired = (await getPairing()) !== null;
    if (!paired) {
      await renderUnpaired(ctx);
      return;
    }

    await renderIdle(ctx);
    pulse = new Pulse(ctx.bridge, PULSE_ID);
    pulse.start();

    // Fire-and-forget refresh. When it lands, patch the chrome in place
    // via the cached app-status (no re-mount, no flicker).
    void refreshAndPatch(ctx);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'tap' || event.kind === 'list-select') {
      // Tap on Idle starts a fresh compose — the most common intent. The
      // universal voice-command classifier (VoicePage) is reachable via
      // an explicit "voice command" entry later if we add one back.
      await ctx.router.push(ComposePage);
      return;
    }
    if (event.kind === 'foreground-enter') {
      await IdlePage.mount(ctx);
    }
  },

  unmount(): void {
    pulse?.stop();
    pulse = null;
  },
};

async function renderIdle(ctx: PageContext): Promise<void> {
  await showPage(ctx.bridge, {
    texts: [
      {
        id: PULSE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: 96,
        border: 0,
        padding: 4,
        capture: false,
        content: Pulse.initialFrame(),
      },
      {
        id: TAP_ID,
        x: 0,
        y: BODY_TOP + 104,
        w: 576,
        h: BODY_BOTTOM - (BODY_TOP + 104),
        border: 0,
        padding: 8,
        capture: true,
        content: center('\ntap to speak\n'),
      },
    ],
    chrome: { hint: footerHint() },
  });
}

async function renderUnpaired(ctx: PageContext): Promise<void> {
  await showPage(ctx.bridge, {
    texts: [
      {
        id: TAP_ID,
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
  // Footer always tells the user that a double-tap exits — this is the
  // ONE page where 2x means leave-the-app (Even Hub submission gate), so
  // we surface it explicitly rather than letting the wearer guess. When
  // there's a last-sent line it rides next to the exit hint.
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

async function refreshAndPatch(ctx: PageContext): Promise<void> {
  const [idleData, history, deviceInfo] = await Promise.all([
    fetchIdleStatus(),
    fetchLastSent(),
    fetchBattery(),
  ]);
  setAppStatus({
    twilio: idleData?.twilio ?? false,
    email: idleData?.email ?? false,
    battery: deviceInfo,
    unread: idleData?.unread ?? 0,
  });
  if (history) lastSent = history;

  // Re-render the page so the new chrome values land. Cheap — same shape
  // as the initial mount, just different text content.
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
    return {
      name: item.contact_name ?? 'someone',
      body: item.body,
      minutesAgo,
      channel: item.channel,
    };
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

/** Exposed for the voice-anywhere classifier — opens inbox from any page. */
export async function navigateToInbox(ctx: PageContext): Promise<void> {
  const { InboxPage } = await import('./inbox.js');
  return ctx.router.push(InboxPage);
}
