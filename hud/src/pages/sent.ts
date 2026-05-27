import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { ComposePage } from './compose.js';
import { IdlePage } from './idle.js';
import type { ComposeDraft } from '../draft.js';

/**
 * Sent confirmation — channel-aware copy + glyph. Tap to start another
 * compose; auto-returns to Idle after AUTO_RETURN_MS so the wearer is
 * never stranded on the success screen.
 *
 * Container shape MATCHES the chrome flow (text 2, 3 + chrome 90, 99) —
 * see the note in send.ts. The previous shape ({1, 2, 3}, no chrome)
 * crashed the app on the double-tap-back-to-Idle hop because Idle had
 * to re-introduce the chrome IDs we'd just dropped (L:38 SDK quirk).
 */

const TITLE_ID = 2;
const BODY_ID = 3;
// The auto-return used to be 4s, which raced badly with the user's manual
// double-tap-to-home — by the time they double-tapped, they were already
// on Idle, and double-tap on Idle exits the app (Even Hub submission gate).
// Keep the Sent screen up long enough that the user is always in control:
// they tap for another compose, double-tap to head back to Idle themselves.
const AUTO_RETURN_MS = 30000;

export function makeSentPage(draft: ComposeDraft): Page {
  const channel = draft.channel;
  const glyph = channel === 'email' ? '>>>' : channel === 'both' ? '-->' : '->';
  const name = draft.recipient.name ?? 'them';
  const headline =
    channel === 'email'
      ? `Off to ${name}'s inbox.`
      : channel === 'both'
        ? `Off to ${name} (SMS + Email).`
        : `Off to ${name}.`;
  const pill =
    channel === 'email' ? 'Email - sent' : channel === 'both' ? 'SMS + Email - sent' : 'SMS - sent';

  let autoReturnTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    id: 'sent',

    async mount(ctx: PageContext): Promise<void> {
      if (autoReturnTimer) clearTimeout(autoReturnTimer);
      autoReturnTimer = setTimeout(() => {
        autoReturnTimer = null;
        void ctx.router.go(IdlePage);
      }, AUTO_RETURN_MS);

      await showPage(ctx.bridge, {
        texts: [
          {
            id: TITLE_ID,
            x: 0,
            y: BODY_TOP,
            w: 576,
            h: 48,
            border: 0,
            padding: 4,
            capture: false,
            content: center(glyph),
          },
          {
            id: BODY_ID,
            x: 0,
            y: BODY_TOP + 56,
            w: 576,
            h: BODY_BOTTOM - (BODY_TOP + 56),
            border: 1,
            padding: 8,
            capture: true,
            content: center(`\n${clip(headline, 36)}\n\n${pill}`),
          },
        ],
        chrome: { hint: 'tap for another  ·  2x to head home' },
      });
    },

    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      // Single-tap = start a new compose; cancels the auto-return.
      if (event.kind === 'tap' || event.kind === 'list-select') {
        if (autoReturnTimer) {
          clearTimeout(autoReturnTimer);
          autoReturnTimer = null;
        }
        await ctx.router.go(ComposePage);
      }
    },

    unmount(): void {
      if (autoReturnTimer) {
        clearTimeout(autoReturnTimer);
        autoReturnTimer = null;
      }
    },
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
