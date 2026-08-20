import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { markVoiceCueSeen } from '../kvs.js';
import { IdlePage } from './idle.js';

/**
 * First-run voice cue card. Shown exactly once — on the first launch
 * after pairing — to teach the wearer the universal-voice pattern.
 * Tap dismisses; the seen flag persists across cold starts.
 *
 * Uses the canonical chrome shape (text 2 title + text 3 capture body)
 * so the next-page hop to Idle shares container IDs — no L:38 silent
 * rebuild trap on first launch.
 */

const TITLE_ID = 2;
const BODY_ID = 3;

const CUE_BODY = [
  '   Hi. I help you message',
  '   without taking out your phone.',
  '',
  '   Scroll the menu, tap to pick.',
  '   Start with "Speak a message":',
  '     "text dan running late"',
].join('\n');

export const VoiceCuePage: Page = {
  id: 'voice-cue',

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
          content: center('welcome to VOX'),
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
          content: CUE_BODY,
        },
      ],
      chrome: { hint: 'tap to open the menu' },
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'tap' || event.kind === 'list-select') {
      await markVoiceCueSeen();
      await ctx.router.go(IdlePage);
    }
  },
};
