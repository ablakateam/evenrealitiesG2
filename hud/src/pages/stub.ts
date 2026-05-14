import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';

/**
 * Placeholder page factory.
 *
 * P12 wires Smart Idle's suggestion taps to real destinations, but the
 * compose / reply / contact flows land in P13–P15. Until then a tap routes
 * here — an honest "coming in P<n>" screen — and the back stack still works
 * (double-tap exits via the global gate; a single tap goes back).
 */
export function makeStubPage(id: string, title: string, note: string): Page {
  return {
    id,
    async mount(ctx: PageContext): Promise<void> {
      await showPage(ctx.bridge, {
        texts: [
          { id: 1, x: 0, y: 0, w: 576, h: 60, content: title, capture: false },
          { id: 2, x: 0, y: 64, w: 576, h: 160, content: `\n  ${note}`, capture: true },
          {
            id: 3,
            x: 0,
            y: 228,
            w: 576,
            h: 56,
            content: '[TAP] back   [X2] exit',
            capture: false,
          },
        ],
      });
    },
    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      if (event.kind === 'tap') {
        // Single tap → go back to the previous page (Smart Idle).
        await ctx.router.back();
      }
      // double-tap is intercepted upstream as the exit gate
    },
  };
}
