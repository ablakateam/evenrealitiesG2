import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { getDraft, setChannel, type ComposeDraft } from '../draft.js';
import { makeStubPage } from './stub.js';

/**
 * Channel toggle — SMS, Email, or both. Disables options the picked
 * recipient can't be reached on (no phone → SMS hidden; no email → Email
 * hidden). On select, updates the draft and pops back.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

type ChannelChoice = 'sms' | 'email' | 'both';

let choices: ChannelChoice[] = [];

export const ChannelPickerPage: Page = {
  id: 'pick-via',

  async mount(ctx: PageContext): Promise<void> {
    const draft = getDraft();
    if (!draft) {
      await ctx.router.go(makeStubPage('via-empty', 'Hmm.', 'No active compose.'));
      return;
    }
    choices = availableChoices(draft);
    if (choices.length === 0) {
      await showPage(ctx.bridge, {
        texts: [
          { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: 'VIA  -  no channels' },
          { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: '[X2] back' },
        ],
        lists: [
          {
            id: LIST_ID,
            x: 0,
            y: 48,
            w: 576,
            h: 184,
            capture: true,
            items: ['This recipient has no phone', 'or email saved.'],
          },
        ],
      });
      return;
    }
    await showPage(ctx.bridge, {
      texts: [
        { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: 'VIA  -  pick a channel' },
        { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: '[SCRL] move  [TAP] pick  [X2] back' },
      ],
      lists: [
        {
          id: LIST_ID,
          x: 0,
          y: 48,
          w: 576,
          h: 184,
          capture: true,
          items: choices.map((c) => formatChoice(c, draft)),
        },
      ],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const picked = choices[event.index];
    if (!picked) return;
    setChannel(picked);
    await ctx.router.back();
  },
};

function availableChoices(draft: ComposeDraft): ChannelChoice[] {
  const out: ChannelChoice[] = [];
  if (draft.recipient.phone) out.push('sms');
  if (draft.recipient.email) out.push('email');
  if (draft.recipient.phone && draft.recipient.email) out.push('both');
  return out;
}

function formatChoice(c: ChannelChoice, d: ComposeDraft): string {
  const label = c === 'sms' ? 'SMS' : c === 'email' ? 'EMAIL' : 'BOTH';
  const target =
    c === 'sms'
      ? d.recipient.phone ?? ''
      : c === 'email'
        ? d.recipient.email ?? ''
        : 'sms + email';
  const t = target.length > 22 ? target.slice(0, 21) + '~' : target;
  return `${label.padEnd(6)} ${t}`;
}
