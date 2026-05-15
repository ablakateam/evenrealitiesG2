import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { ComposePage } from './compose.js';
import { IdlePage } from './idle.js';
import type { ComposeDraft } from '../draft.js';

/**
 * Sent confirmation — channel-aware copy + glyph. Tap to start another
 * compose; auto-returns to Idle after AUTO_RETURN_MS so the wearer is
 * never stranded on the success screen. Double-tap exits the app.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;
const AUTO_RETURN_MS = 4000;

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
          { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: glyph },
          {
            id: FOOTER_ID,
            x: 0,
            y: 236,
            w: 576,
            h: 48,
            capture: false,
            content: '[TAP] new  [X2] home  (back in 4s)',
          },
        ],
        lists: [
          {
            id: LIST_ID,
            x: 0,
            y: 48,
            w: 576,
            h: 184,
            capture: true,
            items: [clip(headline, 28), '', pill],
          },
        ],
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
