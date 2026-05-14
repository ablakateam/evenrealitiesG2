/**
 * Sanitize an incoming SMS / email body for HUD display.
 *
 * The G2 font lacks most emoji and accented characters. We map common emoji
 * to ASCII alternatives, normalize smart quotes / dashes, and strip control
 * characters. The full raw body is preserved separately in `inbox.raw_payload_json`
 * so the dashboard can still display the original.
 */
const EMOJI_MAP: Record<string, string> = {
  '❤': '<3',
  '❤️': '<3',
  '♥': '♥', // card suit IS in G2 font
  '♥️': '♥',
  '👍': '+1',
  '👎': '-1',
  '🙏': 'thx',
  '😂': ':D',
  '😊': ':)',
  '🙂': ':)',
  '😀': ':)',
  '😢': ':(',
  '☺': ':)',
  '😉': ';)',
  '😜': ';P',
  '🔥': 'fire',
  '✨': '*',
  '💯': '100',
};

const SMART_QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
};

const DASHES: Record<string, string> = {
  '–': '-', // en dash
  '—': '--', // em dash
  '―': '--', // horizontal bar
};

const MAX_DISPLAY_CHARS = 200;

export function sanitizeForHud(input: string): string {
  if (!input) return '';
  let out = input;

  // Map known emoji to ASCII first
  for (const [from, to] of Object.entries(EMOJI_MAP)) {
    out = out.split(from).join(to);
  }
  // Smart quotes + dashes
  for (const [from, to] of Object.entries(SMART_QUOTES)) {
    out = out.split(from).join(to);
  }
  for (const [from, to] of Object.entries(DASHES)) {
    out = out.split(from).join(to);
  }

  // Strip remaining emoji-range characters.
  // Preserve card-suit chars U+2660–U+2667 (♠♡♢♣♤♥♦♧) — these ARE in the G2
  // font per community research; we use them as fallback for hearts.
  out = out.replace(
    /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{2600}-\u{265F}\u{2668}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    '',
  );
  // Strip variation selectors (e.g. emoji modifiers)
  out = out.replace(/[\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu, '');
  // Strip zero-width joiners
  out = out.replace(/‍/g, '');

  // Strip diacritics that aren't in the G2 font (NFD decompose, drop combining marks)
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Strip ASCII control chars except \n and \t
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Collapse repeated whitespace
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');

  // Truncate to keep HUD render fast
  if (out.length > MAX_DISPLAY_CHARS) {
    out = out.slice(0, MAX_DISPLAY_CHARS - 1).trimEnd() + '…';
  }

  return out.trim();
}
