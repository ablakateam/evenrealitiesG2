import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { getPairing } from '../kvs.js';
import { hydratePrefs } from '../prefs.js';
import { IdlePage } from './idle.js';

/**
 * Shown when the app has no credential — the state every public install
 * starts in, since the distributed .ehpk carries no server address and no
 * secret.
 *
 * Pairing itself cannot happen here. The glasses' entire input vocabulary is
 * click, scroll and long-press (see `OsEventTypeList`); there is no text
 * entry and no camera on the G2 — `captureImageFromCamera` in the SDK is the
 * *phone's* camera. So this page's whole job is to point at the phone, and to
 * notice when pairing has finished there.
 *
 * A tap re-checks KVS. Both surfaces run in one WebView (see main.ts), so the
 * pairing the companion writes is visible here immediately — the wearer taps
 * once after pairing on the phone and lands on Idle.
 *
 * Uses the canonical text-2 + text-3 chrome shape so the hop to Idle shares
 * container IDs and cannot trip the L:38 silent-rebuild trap.
 */

const TITLE_ID = 2;
const BODY_ID = 3;

// SIX lines, not seven. The body container is 176 px tall and the firmware
// needs >= 26 px per rendered line, so line 7 is silently dropped — it does not
// clip visibly or scroll, it just never draws. Verified in the simulator.
const BODY = [
  '   VOX runs on a server you host,',
  '   so this app ships with no',
  '   credentials of its own.',
  '',
  '   On your phone: open VOX and',
  '   paste your pairing link.',
].join('\n');

const CHECKING = [
  '',
  '',
  '            checking...',
].join('\n');

export const NotPairedPage: Page = {
  id: 'not-paired',

  async mount(ctx: PageContext): Promise<void> {
    await showPage(ctx.bridge, {
      texts: [
        {
          id: TITLE_ID,
          x: 0,
          y: BODY_TOP,
          w: 576,
          h: 32,
          border: 0,
          padding: 4,
          capture: false,
          content: center('not paired yet'),
        },
        {
          id: BODY_ID,
          x: 0,
          y: BODY_TOP + 36,
          w: 576,
          h: BODY_BOTTOM - (BODY_TOP + 36),
          border: 1,
          padding: 8,
          capture: true,
          content: BODY,
        },
      ],
      chrome: { hint: 'tap once paired on phone' },
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'tap' && event.kind !== 'list-select') return;
    if (event.containerID != null && event.containerID !== BODY_ID) return;

    await showPage(ctx.bridge, {
      texts: [
        {
          id: TITLE_ID,
          x: 0,
          y: BODY_TOP,
          w: 576,
          h: 32,
          border: 0,
          padding: 4,
          capture: false,
          content: center('not paired yet'),
        },
        {
          id: BODY_ID,
          x: 0,
          y: BODY_TOP + 36,
          w: 576,
          h: BODY_BOTTOM - (BODY_TOP + 36),
          border: 1,
          padding: 8,
          capture: true,
          content: CHECKING,
        },
      ],
      chrome: { hint: '' },
    });

    if ((await getPairing()) !== null) {
      // Preferences have never been fetched on an unpaired install, so pull
      // them before Idle paints its "Style:" row.
      await hydratePrefs();
      await ctx.router.go(IdlePage);
      return;
    }

    await this.mount!(ctx);
  },
};
