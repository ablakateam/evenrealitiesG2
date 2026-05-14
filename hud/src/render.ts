import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';

/**
 * HUD render helpers.
 *
 * The G2 display is 576×288, 4-bit greyscale (green), single firmware font,
 * ~36 chars wide × ~12 rows. There's no free pixel drawing — a "page" is a
 * set of text/list/image containers whose `content` strings carry the
 * Pine/Norton-Commander framing (single-line box chars, ALL-CAPS labels,
 * bracketed `[TAP]` footer keys).
 *
 * Brightness (`borderColor` / implied content brightness) maps to hierarchy:
 *   15 cursor / primary · 13 body · 10 labels · 6 hints · 4 borders.
 */
export const SCREEN_W = 576;
export const SCREEN_H = 288;

export const Brightness = {
  cursor: 15,
  body: 13,
  label: 10,
  hint: 6,
  border: 4,
} as const;

/** Result code from createStartUpPageContainer (0 = success). */
export const PAGE_OK = 0;

/**
 * Build a single full-screen text container. Most VOX pages are one text
 * container whose `content` carries the whole framed layout; richer pages
 * (tone picker, recipient list) add a ListContainer — handled per-page.
 */
export function fullScreenText(opts: {
  containerID: number;
  content: string;
  /** Exactly one container per page must capture events. */
  isEventCapture?: boolean;
  padding?: number;
}): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    borderWidth: 0,
    borderColor: Brightness.border,
    paddingLength: opts.padding ?? 8,
    containerID: opts.containerID,
    containerName: `c${opts.containerID}`,
    content: opts.content,
    isEventCapture: opts.isEventCapture ? 1 : 0,
  });
}

/** Create a page from a single full-screen text container. */
export async function renderTextPage(
  bridge: EvenAppBridge,
  containerID: number,
  content: string,
): Promise<number> {
  return bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [fullScreenText({ containerID, content, isEventCapture: true })],
    }),
  );
}

/** Flicker-free update of a text container's content. */
export async function updateText(
  bridge: EvenAppBridge,
  containerID: number,
  content: string,
): Promise<boolean> {
  return bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID, containerName: `c${containerID}`, content }),
  );
}

/* --- Pine-frame text composition (PROVISIONAL — see ISSUES.md I-007) ------
 *
 * These draw the Pine/Norton-Commander frame using box-drawing characters in
 * the text content. Simulator testing in P11 revealed the G2 font renders
 * box-drawing glyphs and letters at DIFFERENT advance widths, so a
 * fixed-char-count frame can't keep its right edge aligned (a row of dashes
 * spans ~full width while a row of letters spans ~half).
 *
 * P12 redesigns the visual system to use the SDK's real container
 * `borderWidth` / `borderColor` for framing, with text content carrying only
 * the inner lines. Until then these helpers are kept for reference but the
 * pages use plain left-aligned text.
 */
const WIDTH = 37; // provisional inner char width — not reliable, see above

/** Top border with the page title baked in: `┌─[ TITLE ]──────── right ─┐` */
export function frameTop(title: string, right = ''): string {
  const left = `┌─[ ${title} ]`;
  const rightPart = right ? `${right} ─┐` : '─┐';
  const fill = Math.max(0, WIDTH - left.length - rightPart.length);
  return left + '─'.repeat(fill) + rightPart;
}

/** A horizontal divider row: `├───────────────┤` */
export function frameDivider(label = ''): string {
  if (!label) return '├' + '─'.repeat(WIDTH - 2) + '┤';
  const left = `├─[ ${label} ]`;
  const fill = Math.max(0, WIDTH - left.length - 1);
  return left + '─'.repeat(fill) + '┤';
}

/** Bottom border: `└───────────────┘` */
export function frameBottom(): string {
  return '└' + '─'.repeat(WIDTH - 2) + '┘';
}

/** A content row inside the frame: `│  text...        │` */
export function frameRow(text = ''): string {
  const inner = WIDTH - 4; // 2 for borders, 2 for padding
  const clipped = text.length > inner ? text.slice(0, inner) : text;
  return '│ ' + clipped.padEnd(inner) + ' │';
}

/** The standard footer with bracketed action keys. */
export function frameFooter(keys: string): string {
  return frameRow(keys);
}

/** Compose a full framed page from a title + body rows + footer. */
export function framedPage(opts: {
  title: string;
  titleRight?: string;
  rows: string[];
  footer: string;
}): string {
  const lines = [
    frameTop(opts.title, opts.titleRight),
    ...opts.rows.map(frameRow),
    frameDivider(),
    frameFooter(opts.footer),
    frameBottom(),
  ];
  return lines.join('\n');
}
