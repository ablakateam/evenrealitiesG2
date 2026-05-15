import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { getDraft, setTone, type ComposeDraft } from '../draft.js';
import type { Tone, VariantResult } from '../api.js';
import { makeStubPage } from './stub.js';

/**
 * Tone picker — list the 7 variants returned by /api/compose. Title shows
 * the currently-focused tone's preview (first line of the variant body).
 *
 * The simulator's automation doesn't emit a "list-cursor-moved" event, so
 * we can't update the title on scroll. Compromise for now: title shows the
 * CURRENTLY-SELECTED tone's preview. The wearer reads the preview by
 * picking the tone (one extra tap). On real hardware where cursor-move
 * events fire, we'll subscribe to them and update the preview live.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

let tones: Tone[] = [];

const TONE_ORDER: Tone[] = [
  'casual',
  'professional',
  'friendly',
  'formal',
  'sarcastic',
  'grammar',
  'original',
];

export const TonePickerPage: Page = {
  id: 'pick-tone',

  async mount(ctx: PageContext): Promise<void> {
    const draft = getDraft();
    if (!draft) {
      await ctx.router.go(makeStubPage('tone-empty', 'Hmm.', 'No active compose.'));
      return;
    }
    // Order: keep the canonical order but drop variants that errored.
    tones = TONE_ORDER.filter((t) => {
      const v = draft.variants.find((x) => x.tone === t);
      return v && !v.error && v.text;
    });
    const currentVariant = draft.variants.find((v) => v.tone === draft.tone);
    const previewLine = previewOf(currentVariant);

    await showPage(ctx.bridge, {
      texts: [
        {
          id: TITLE_ID,
          x: 0,
          y: 0,
          w: 576,
          h: 44,
          capture: false,
          content: `TONE  -  ${tones.length} cached`,
        },
        {
          id: FOOTER_ID,
          x: 0,
          y: 236,
          w: 576,
          h: 48,
          capture: false,
          content: previewLine,
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
          items: tones.map((t) => formatRow(t, draft)),
        },
      ],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const picked = tones[event.index];
    if (!picked) return;
    setTone(picked);
    await ctx.router.back();
  },
};

function formatRow(tone: Tone, draft: ComposeDraft): string {
  const label = tone[0]!.toUpperCase() + tone.slice(1);
  const v = draft.variants.find((x) => x.tone === tone);
  const preview = v?.text ? clip(v.text, 20) : '(unavailable)';
  return `${label.padEnd(8)} ${preview}`;
}

function previewOf(v: VariantResult | undefined): string {
  if (!v || !v.text) return '(no preview)';
  return clip(v.text, 56);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
