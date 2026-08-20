/**
 * Glasses-safe text.
 *
 * The G2 firmware font covers ASCII, single-line box drawing, arrows, a few
 * geometric shapes and the card suits - and nothing else. Anything outside
 * that renders as a missing-glyph box (the sim logs `glyph dsc. not found`).
 *
 * Incoming messages were already scrubbed server-side by
 * `server/src/sms/sanitize.ts`. OUTBOUND rewrites were not: the LLM happily
 * returns curly apostrophes, em-dashes and the odd emoji, and every one of
 * those reached the Confirm screen raw. That is open issue I-003, and it is
 * why a perfectly good rewrite could show up on the glasses peppered with
 * missing-glyph boxes.
 *
 * We sanitize for DISPLAY and send the same sanitized string, so the wearer
 * always sends exactly the text they approved. Divergence between what the
 * HUD shows and what goes over the wire is worse than losing a curly quote.
 *
 * Every pattern below uses \u escapes on purpose: this file is full of
 * characters that are invisible or ambiguous in an editor, and spelling them
 * out is the only way the intent stays readable.
 */

const REPLACEMENTS: Array<[RegExp, string]> = [
  // Smart quotes -> ASCII
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  // Dashes -> ASCII
  [/–/g, '-'],
  [/[—―]/g, '--'],
  // Ellipsis -> three dots
  [/…/g, '...'],
  // Non-breaking / thin / narrow spaces -> plain space
  [/[    ]/g, ' '],
  // Common emoji the model reaches for, mapped rather than dropped
  [/❤️?/g, '<3'],
  [/\u{1F44D}/gu, '+1'],
  [/\u{1F44E}/gu, '-1'],
  [/\u{1F64F}/gu, 'thx'],
  [/\u{1F602}/gu, ':D'],
  [/[\u{1F60A}\u{1F642}\u{1F600}]/gu, ':)'],
  [/\u{1F622}/gu, ':('],
  [/\u{1F609}/gu, ';)'],
];

/** Everything left that the font cannot draw. */
const UNSUPPORTED =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{265F}\u{2668}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}]/gu;

/** Card suits U+2660..U+2667 ARE in the G2 font - keep them. */
const CARD_SUITS = /[♠-♧]/g;

/** Private-use sentinel that shields the suits from the sweep above. */
const SUIT_SENTINEL = String.fromCharCode(0xe000);
const SUIT_SENTINEL_ALL = new RegExp(SUIT_SENTINEL, "g");

/** Combining diacritical marks left over after NFD decomposition. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** ASCII control characters, except newline (\n) and tab (\t). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Make a string safe to draw on the glasses. */
export function sanitizeForGlasses(input: string): string {
  if (!input) return '';
  let out = input;

  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  // Shield the supported card suits, sweep the rest, then restore them.
  const suits: string[] = [];
  out = out.replace(CARD_SUITS, (m) => {
    suits.push(m);
    return SUIT_SENTINEL;
  });
  out = out.replace(UNSUPPORTED, '');
  out = out.replace(SUIT_SENTINEL_ALL, () => suits.shift() ?? '');

  out = out.normalize('NFD').replace(COMBINING_MARKS, '');
  out = out.replace(CONTROL_CHARS, '');
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}
