import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { markVoiceCueSeen } from '../kvs.js';
import { IdlePage } from './idle.js';

/**
 * First-run voice cue card. Shown exactly once — on the first launch
 * after pairing — to teach the wearer the universal-voice pattern.
 * Tap or scroll dismisses; the seen flag persists across cold starts.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

export const VoiceCuePage: Page = {
  id: 'voice-cue',

  async mount(ctx: PageContext): Promise<void> {
    await showPage(ctx.bridge, {
      texts: [
        { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: 'first time?' },
        { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: '[TAP] got it' },
      ],
      lists: [
        {
          id: LIST_ID,
          x: 0,
          y: 48,
          w: 576,
          h: 184,
          capture: true,
          items: [
            'Pick "> Speak" to talk.',
            'Try:',
            '"send dan running late"',
            '"open inbox"',
            '"save 415-555-0142 mom"',
          ],
        },
      ],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'tap' || event.kind === 'list-select') {
      await markVoiceCueSeen();
      await ctx.router.go(IdlePage);
    }
  },
};
