import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { getDraft, getBodyText, setSubject } from '../draft.js';
import { makeStubPage } from './stub.js';

/**
 * Subject prompt — surfaces when the user taps the SUBJECT row on Confirm
 * (only shown for email intents). Three pragmatic options:
 *   - Use the first line of the body as the subject
 *   - Skip subject entirely (null)
 *   - Keep current (if one already exists; otherwise this option is hidden)
 *
 * Re-record subject is not yet wired — P14 keeps the flow tight; that
 * variant lives in the broader voice-anywhere work (P16).
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

type Choice = { key: 'first-line' | 'skip' | 'keep'; label: string; value: string | null };

let choices: Choice[] = [];

export const SubjectPromptPage: Page = {
  id: 'pick-subject',

  async mount(ctx: PageContext): Promise<void> {
    const draft = getDraft();
    if (!draft) {
      await ctx.router.go(makeStubPage('subject-empty', 'Hmm.', 'No active compose.'));
      return;
    }
    const body = getBodyText(draft);
    const firstLine = body.split(/[\n.!?]/)[0]?.trim() ?? body.slice(0, 40);
    const suggested = clip(firstLine || 'Message from VOX', 28);

    choices = [
      { key: 'first-line', label: `Use: ${clip(suggested, 22)}`, value: suggested },
      { key: 'skip', label: 'Skip - no subject', value: null },
    ];
    if (draft.subject) {
      choices.unshift({ key: 'keep', label: `Keep: ${clip(draft.subject, 22)}`, value: draft.subject });
    }

    await showPage(ctx.bridge, {
      texts: [
        {
          id: TITLE_ID,
          x: 0,
          y: 0,
          w: 576,
          h: 44,
          capture: false,
          content: 'SUBJECT  -  pick one',
        },
        {
          id: FOOTER_ID,
          x: 0,
          y: 236,
          w: 576,
          h: 48,
          capture: false,
          content: '[SCRL] move  [TAP] pick  [X2] back',
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
          items: choices.map((c) => c.label),
        },
      ],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const picked = choices[event.index];
    if (!picked) return;
    setSubject(picked.value);
    await ctx.router.back();
  },
};

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
