import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { renderTextPage, updateText, PAGE_OK } from '../render.js';
import { getPairing } from '../kvs.js';

const CONTAINER_ID = 1;

/**
 * Idle page — the HUD's root.
 *
 * P11 placeholder: proves the boot path, the event loop (tap / scroll /
 * double-tap), and pairing detection. Plain left-aligned text — the
 * Pine/Norton-Commander framed visual system is built in P12 using real
 * container borders (text-drawn box chars can't align because box-drawing
 * glyphs and letters have different advance widths in the G2 font — see
 * ISSUES.md I-007).
 */
export const IdlePage: Page = {
  id: 'idle',

  async mount(ctx: PageContext): Promise<void> {
    const paired = (await getPairing()) !== null;
    const result = await renderTextPage(ctx.bridge, CONTAINER_ID, renderIdle({ paired, hint: null }));
    if (result !== PAGE_OK) {
      console.error(`[idle] createStartUpPageContainer failed: ${result}`);
    }
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    // Root double-tap is handled upstream in main.ts (the exit gate). A
    // single tap / scroll here echoes into the hint line so the event loop
    // is verifiable on the simulator + on hardware.
    let hint: string | null = null;
    switch (event.kind) {
      case 'tap':
        hint = 'tap received';
        break;
      case 'scroll-up':
        hint = 'scroll up';
        break;
      case 'scroll-down':
        hint = 'scroll down';
        break;
      case 'foreground-enter':
        hint = 'foreground';
        break;
      default:
        return;
    }
    const paired = (await getPairing()) !== null;
    await updateText(ctx.bridge, CONTAINER_ID, renderIdle({ paired, hint }));
  },
};

function renderIdle(opts: { paired: boolean; hint: string | null }): string {
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lines = [
    `VOX                              ${clock}`,
    '',
    opts.paired ? 'Paired. Ready for voice (P12+).' : 'Not paired — scan the pairing QR.',
    '',
    opts.hint ? `> ${opts.hint}` : '',
    '',
    '[TAP] test   [SCRL] test   [X2] exit',
  ];
  return lines.join('\n');
}
