import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { ComposePage } from './compose.js';
import type { ComposeDraft } from '../draft.js';

/**
 * Sent confirmation — channel-aware copy + glyph. Tap to start another
 * compose; double-tap exits to idle (root). Built as a factory so it can
 * capture the (now-cleared) draft details for display.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

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

  return {
    id: 'sent',

    async mount(ctx: PageContext): Promise<void> {
      await showPage(ctx.bridge, {
        texts: [
          { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: glyph },
          { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: '[TAP] new  [X2] home' },
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
      // Single-tap on the list-capture container = start a new compose.
      // (Double-tap is intercepted globally in main.ts → exits the app,
      // which is the right behavior at this terminal state too.)
      if (event.kind === 'tap' || event.kind === 'list-select') {
        await ctx.router.go(ComposePage);
      }
    },
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
