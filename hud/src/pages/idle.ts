import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, updateText, spread } from '../render.js';
import { getPairing } from '../kvs.js';
import { apiGet, HudApiError } from '../api.js';
import { getBridge } from '../bridge.js';
import { makeStubPage } from './stub.js';
import { ComposePage } from './compose.js';

/**
 * Smart Idle — the HUD's root screen.
 *
 * Anticipates intent instead of being a passive launcher: a server-ranked
 * suggestion list (unread replies → quiet-streak contacts → compose), a
 * title bar with live status badges, and a Today line. One round-trip to
 * /api/idle-suggestions powers the list + the status block; device battery
 * comes from getDeviceInfo().
 *
 * Layout (576x288), three bordered containers:
 *   id 1  title bar   (text, no capture)
 *   id 2  suggestions (list, CAPTURE — native scroll + select)
 *   id 3  footer      (text, no capture)
 */

type IdleAction =
  | { kind: 'compose' }
  | { kind: 'compose-to'; contact_id: number; name: string }
  | { kind: 'reply'; inbox_id: number };

interface IdleSuggestion {
  id: string;
  label: string;
  action: IdleAction;
}

interface IdleResponse {
  suggestions: IdleSuggestion[];
  status: {
    twilio: boolean;
    email: boolean;
    today_sent: number;
    today_failed: number;
    unread: number;
  };
}

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

export const IdlePage: Page = {
  id: 'idle',

  async mount(ctx: PageContext): Promise<void> {
    const paired = (await getPairing()) !== null;
    if (!paired) {
      await renderUnpaired(ctx);
      return;
    }

    // Fetch suggestions + status (one round-trip) and battery in parallel.
    const [data, battery] = await Promise.all([fetchIdle(), fetchBattery()]);
    suggestionsCache = data?.suggestions ?? [];

    const items = suggestionsCache.length > 0
      ? suggestionsCache.map((s) => s.label)
      : ['Compose (voice)'];

    await showPage(ctx.bridge, {
      texts: [
        { id: TITLE_ID, x: 0, y: 0, w: 576, h: 56, capture: false, content: titleBar(data, battery) },
        { id: FOOTER_ID, x: 0, y: 230, w: 576, h: 58, capture: false, content: footer(data) },
      ],
      lists: [{ id: LIST_ID, x: 0, y: 60, w: 576, h: 166, capture: true, items }],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'list-select') {
      const picked = suggestionsCache[event.index];
      if (!picked) return;
      await routeToAction(picked.action, ctx);
      return;
    }
    if (event.kind === 'foreground-enter') {
      // Returning to the app — refresh suggestions.
      await IdlePage.mount(ctx);
    }
    // scroll within the list is handled natively by the firmware
  },
};

/** Cache so a list-select event can map index → action. */
let suggestionsCache: IdleSuggestion[] = [];

async function routeToAction(action: IdleAction, ctx: PageContext): Promise<void> {
  switch (action.kind) {
    case 'compose':
      await ctx.router.push(ComposePage);
      break;
    case 'compose-to':
      // P14 pre-fills the recipient; for now the voice compose flow runs and
      // the confirm screen's TO atom is editable.
      await ctx.router.push(ComposePage);
      break;
    case 'reply':
      await ctx.router.push(makeStubPage('reply', 'REPLY', 'Inbox + reply ships in P15.'));
      break;
  }
}

async function fetchIdle(): Promise<IdleResponse | null> {
  try {
    return await apiGet<IdleResponse>('/api/idle-suggestions');
  } catch (err) {
    if (err instanceof HudApiError) {
      console.warn(`[idle] suggestions fetch failed: ${err.code}`);
    }
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

function titleBar(data: IdleResponse | null, battery: number | null): string {
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const net = data ? '●' : '○';
  const twl = data?.status.twilio ? '●' : '○';
  const mail = data?.status.email ? '●' : '○';
  const bat = battery != null ? `${battery}%` : '--';
  return `${spread('VOX', clock, 40)}\nNET ${net}  TWL ${twl}  MAIL ${mail}  BAT ${bat}`;
}

function footer(data: IdleResponse | null): string {
  const today = data
    ? `Today  ${data.status.today_sent} sent · ${data.status.today_failed} failed · ${data.status.unread} unread`
    : 'Today  --';
  return `${today}\n[TAP] open   [SCRL] move   [X2] exit`;
}

async function renderUnpaired(ctx: PageContext): Promise<void> {
  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: 0, w: 576, h: 48, capture: false, content: 'VOX' },
      {
        id: LIST_ID,
        x: 0,
        y: 52,
        w: 576,
        h: 178,
        capture: true,
        content: '\n  Not paired.\n\n  Open the VOX dashboard on your phone\n  and scan the pairing QR.',
      },
      { id: FOOTER_ID, x: 0, y: 234, w: 576, h: 50, capture: false, content: '[X2] exit' },
    ],
  });
  void updateText; // referenced for future in-place title-bar refresh
}
