import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import type { Tone } from '../api.js';
import { getPrefs, setDefaultTone } from '../prefs.js';

/**
 * Message style — set the DEFAULT tone from the glasses.
 *
 * Reachable from the Idle menu. Writes through to /api/config so the choice
 * is the same value the phone dashboard's Preferences page shows: picking
 * "Formal" here and opening the dashboard shows Formal, and vice versa.
 *
 * This is the wearer's standing preference. Overriding the style for a
 * single message happens on the Confirm screen instead, which starts from
 * this value.
 *
 * Container shape matches the chrome flow (text 2 title + list 5) so the
 * hop back to Idle never re-introduces a dropped id (L:38).
 */

const TITLE_ID = 2;
const LIST_ID = 5;

const TITLE_H = 26;
const LIST_Y = BODY_TOP + TITLE_H + 4;
const LIST_H = BODY_BOTTOM - LIST_Y;

const BACK_LABEL = '── back ──';

/** Same order the compose pipeline returns variants in. */
const TONES: Tone[] = [
  'casual',
  'professional',
  'friendly',
  'formal',
  'sarcastic',
  'grammar',
  'original',
];

/**
 * One-line description so the wearer knows what they're choosing.
 *
 * Hard budget: the firmware silently drops list rows past 32 characters
 * (P13). The row is "> " + name padded to 13 + blurb, so a blurb has 17
 * characters. Anything longer gets cut mid-word and reads as a rendering
 * bug rather than a hint.
 */
const BLURB: Record<Tone, string> = {
  casual: 'relaxed',
  professional: 'businesslike',
  friendly: 'warm',
  formal: 'no contractions',
  sarcastic: 'playful',
  grammar: 'cleaned up',
  original: 'word for word',
};

let saving = false;
let errorMsg: string | null = null;

function rowLabel(tone: Tone, active: Tone): string {
  const mark = tone === active ? '>' : ' ';
  // 32-char budget per row (P13 firmware limit); pad the name so the blurbs
  // line up into a readable second column.
  const name = capitalize(tone).padEnd(13);
  return `${mark} ${name}${BLURB[tone]}`.slice(0, 32);
}

export const StylePage: Page = {
  id: 'style',

  async mount(ctx: PageContext): Promise<void> {
    await render(ctx);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    if (event.containerID !== LIST_ID) return;
    if (saving) return;

    // Items are [...TONES, BACK_LABEL].
    if (event.index >= TONES.length) {
      await ctx.router.back();
      return;
    }
    const picked = TONES[event.index];
    if (!picked) return;

    saving = true;
    errorMsg = null;
    // Optimistic: setDefaultTone updates the local cache first, so this
    // re-render already shows the new marker while the PUT is in flight.
    const write = setDefaultTone(picked);
    await render(ctx);
    try {
      await write;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message.slice(0, 40) : 'save failed';
    } finally {
      saving = false;
    }
    await render(ctx);
    // Land back on Idle so the wearer sees the new style on the menu row.
    if (!errorMsg) await ctx.router.back();
  },
};

async function render(ctx: PageContext): Promise<void> {
  const active = getPrefs().default_tone;
  const items = TONES.map((t) => rowLabel(t, active)).concat([BACK_LABEL]);
  const hint = errorMsg
    ? `couldn't save: ${errorMsg}`
    : saving
      ? 'saving...'
      : 'tap to set  ·  2x to go back';

  await showPage(ctx.bridge, {
    texts: [
      {
        id: TITLE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: TITLE_H,
        border: 0,
        padding: 4,
        capture: false,
        content: center('message style'),
      },
    ],
    lists: [
      {
        id: LIST_ID,
        x: 0,
        y: LIST_Y,
        w: 576,
        h: LIST_H,
        border: 1,
        padding: 6,
        capture: true,
        items,
      },
    ],
    chrome: { hint },
  });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
