import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { IdlePage } from './idle.js';

/**
 * Placeholder page factory — used by error/incomplete flows to surface an
 * "honest" message and offer back navigation.
 *
 * Uses the same canonical 2-text-container body shape (id 2 = title,
 * id 3 = capture body) + chrome. Keeps the container-shape rule (L:38)
 * satisfied across forward/back transitions between stub and any
 * chrome-enabled page.
 */
const TITLE_ID = 2;
const BODY_ID = 3;

export function makeStubPage(id: string, title: string, note: string): Page {
  return {
    id,
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
            content: center(title),
          },
          {
            id: BODY_ID,
            x: 0,
            y: BODY_TOP + 40,
            w: 576,
            h: BODY_BOTTOM - (BODY_TOP + 40),
            border: 0,
            padding: 8,
            capture: true,
            content: center('\n' + note),
          },
        ],
        chrome: { hint: 'tap to back   ·   2x to Idle' },
      });
    },
    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      if (event.kind === 'tap' || event.kind === 'list-select') {
        // Try the back stack first (stub was pushed from a flow page).
        // If that's empty — which is the case when the stub was launched
        // via router.go() after a send error — fall through to Idle so
        // the wearer is never stranded on an error screen.
        const popped = await ctx.router.back();
        if (!popped) await ctx.router.go(IdlePage);
      }
    },
  };
}
