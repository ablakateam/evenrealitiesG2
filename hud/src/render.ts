import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerUpgrade,
  validateEvenHubPageContainer,
  formatEvenHubPageContainerValidationError,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { chromeHeaderBox, chromeFooterBox, type ChromeOpts } from './chrome.js';

/**
 * HUD render system.
 *
 * The G2 display is 576x288, 4-bit greyscale (green), origin top-left. There
 * is no CSS / DOM — a "page" is up to 12 absolutely-positioned containers
 * (max 4 image + 8 text/list). Exactly one container must have
 * `isEventCapture: 1`.
 *
 * The framed Pine/Norton-Commander look comes from each container's REAL
 * `borderWidth` / `borderColor` — NOT box-drawing chars in text (I-007: the
 * G2 font renders box glyphs and letters at different advance widths, so a
 * text-drawn frame can't align). Text `content` carries only inner lines.
 */
export const SCREEN_W = 576;
export const SCREEN_H = 288;

/** 4-bit greyscale levels (0 = off, 15 = bright green) mapped to UI hierarchy. */
export const Bright = {
  cursor: 15,
  body: 13,
  label: 10,
  hint: 6,
  border: 6,
} as const;

/** createStartUpPageContainer result codes. */
export const PAGE_OK = 0;

/** A text container spec. */
export interface TextBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  capture?: boolean;
  border?: number; // borderWidth 0-5, default 1
  padding?: number; // 0-32, default 6
}

/** A list container spec. */
export interface ListBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  items: string[]; // max 20, each max 64 chars
  capture?: boolean;
  border?: number;
  padding?: number;
  /**
   * Draw the firmware selection highlight. Defaults to true for real menus.
   * The off-screen padding lists (see CHROME_BODY_LIST_IDS) set this false so
   * the firmware never routes a selection event to a container the user
   * cannot see — that used to surface as a phantom tap on the mounted page.
   */
  selectable?: boolean;
}

/**
 * Vertical budget for a native list.
 *
 * Measured on the simulator at 576x288 by reading row baselines off a
 * rendered 7-item list (y = 99, 140, 181, 219, ...): the firmware draws each
 * row at a ~40 px pitch — glyph line, selection border and inter-item gap —
 * and the container's own `paddingLength` applies top AND bottom.
 *
 * An earlier estimate of 32 px is what produced the v0.1.15 bug: Confirm's
 * action list was sized for three rows at 32 px (78 px) but the third row
 * needed 120 px, so the style entry was never drawn at all. Rows past the
 * container's height are NOT scrolled to — they simply do not render.
 *
 * Always size a menu list with this helper instead of a hand-picked pixel
 * height so a row can never fall off the bottom again.
 */
export const LIST_ROW_PITCH = 40;

export function listHeightFor(rows: number, padding = 6): number {
  return rows * LIST_ROW_PITCH + padding * 2 + 2;
}

/** How many rows a list of height `h` can actually show. */
export function listRowsVisible(h: number, padding = 6): number {
  return Math.floor((h - padding * 2 - 2) / LIST_ROW_PITCH);
}

function textProp(box: TextBox): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.w,
    height: box.h,
    borderWidth: box.border ?? 1,
    borderColor: Bright.border,
    borderRadius: 0,
    paddingLength: box.padding ?? 6,
    containerID: box.id,
    containerName: `c${box.id}`,
    content: box.content,
    isEventCapture: box.capture ? 1 : 0,
  });
}

function listProp(box: ListBox): ListContainerProperty {
  // List caps: max 20 items, 64 chars each. Clip defensively.
  const items = box.items.slice(0, 20).map((s) => (s.length > 64 ? s.slice(0, 64) : s));
  return new ListContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.w,
    height: box.h,
    borderWidth: box.border ?? 1,
    borderColor: Bright.border,
    borderRadius: 0,
    paddingLength: box.padding ?? 6,
    containerID: box.id,
    containerName: `c${box.id}`,
    isEventCapture: box.capture ? 1 : 0,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: box.w - (box.padding ?? 6) * 2,
      isItemSelectBorderEn: box.selectable === false ? 0 : 1,
      itemName: items,
    }),
  });
}

/**
 * The first page of the app must use createStartUpPageContainer; every page
 * after that uses rebuildPageContainer. We track that here so callers just
 * call `showPage()` and don't have to care.
 *
 * Vite HMR / page reload resets this flag, but the simulator (and real
 * firmware) keep the previously-created startup container alive. In that
 * case createStartUp returns a non-zero error code; we fall back to
 * rebuild so the page renders anyway. Same logic protects against double
 * boot races on real hardware.
 */
let firstPageShown = false;

export interface PageSpec {
  texts?: TextBox[];
  lists?: ListBox[];
  /**
   * When set, the renderer auto-injects a persistent header + footer band
   * (see `chrome.ts`). Pages that opt in should keep body containers within
   * y = BODY_TOP..BODY_BOTTOM and avoid container IDs 90 / 99.
   */
  chrome?: ChromeOpts;
}

/**
 * Container IDs every chrome page must include, hidden when not in use.
 *
 * The SDK silently fails any rebuildPageContainer that re-introduces an ID
 * dropped by a prior smaller rebuild (L:38). To dodge that quirk completely,
 * every chrome page emits the SAME maximal shape — body text 2, 3, 4 + list
 * 5 + chrome 90, 99 — and the renderer pads any container the page didn't
 * declare with a 1×1 invisible placeholder. No drop, nothing to re-introduce.
 */
const CHROME_BODY_TEXT_IDS = [2, 3, 4] as const;
const CHROME_BODY_LIST_IDS = [5] as const;

function hiddenText(id: number): TextBox {
  // Off-screen below the footer (288px-tall display, footer ends at 288).
  // Width/height kept comfortably above 0 because some SDK paths compute
  // `width - padding*2` for the inner layout box and barf on negatives.
  return { id, x: 0, y: 290, w: 16, h: 16, border: 0, padding: 0, content: '', capture: false };
}

function hiddenList(id: number): ListBox {
  // `selectable: false` matters as much as the off-screen position: a padding
  // list that still declares a selection border can win a firmware selection
  // event, which the mounted page then reads as a real menu tap.
  return {
    id,
    x: 0,
    y: 290,
    w: 32,
    h: 16,
    border: 0,
    padding: 0,
    items: [' '],
    capture: false,
    selectable: false,
  };
}

/** Render a page. Picks createStartUp vs rebuild automatically. */
export async function showPage(bridge: EvenAppBridge, spec: PageSpec): Promise<boolean> {
  const bodyTexts = [...(spec.texts ?? [])];
  const bodyLists = [...(spec.lists ?? [])];

  if (spec.chrome) {
    // Auto-pad to the maximal chrome shape so successive pages share the
    // same container IDs and never trip the L:38 silent-rebuild bug.
    for (const id of CHROME_BODY_TEXT_IDS) {
      if (!bodyTexts.some((t) => t.id === id)) bodyTexts.push(hiddenText(id));
    }
    for (const id of CHROME_BODY_LIST_IDS) {
      if (!bodyLists.some((l) => l.id === id)) bodyLists.push(hiddenList(id));
    }
  }

  const chromeTexts: TextBox[] = spec.chrome
    ? [chromeHeaderBox(), chromeFooterBox(spec.chrome.hint)]
    : [];
  const textObject = [...bodyTexts, ...chromeTexts].map(textProp);
  const listObject = bodyLists.map(listProp);
  const total = textObject.length + listObject.length;

  // SDK 0.0.14 ships client-side validators for every rule the native layer
  // can reject a page on. They run entirely in our bundle (no host round-trip,
  // so this does NOT raise our min_sdk_version) and turn what used to be a
  // silent `false` from the bridge into a named, loggable cause.
  const validation = validateEvenHubPageContainer({ textObject, listObject });
  if (!validation.valid) {
    console.warn(`[render] page container invalid: ${formatEvenHubPageContainerValidationError(validation)}`);
  }

  if (!firstPageShown) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ containerTotalNum: total, textObject, listObject }),
    );
    firstPageShown = true;
    if (result === PAGE_OK) return true;
    // Startup container already exists (after HMR / reload) — fall through.
    console.warn(`[render] createStartUpPageContainer returned ${result}, falling back to rebuild`);
  }

  let ok = await bridge.rebuildPageContainer(
    new RebuildPageContainer({ containerTotalNum: total, textObject, listObject }),
  );
  if (!ok) {
    // Brief retry — see L:38: lists with overlong items or rapid back-to-back
    // rebuilds occasionally return false on the first try.
    await new Promise((r) => setTimeout(r, 80));
    ok = await bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: total, textObject, listObject }),
    );
    if (!ok) console.warn(`[render] rebuildPageContainer failed twice (total=${total})`);
  }
  return ok;
}

/** Flicker-free in-place update of a single text container's content. */
export async function updateText(bridge: EvenAppBridge, id: number, content: string): Promise<boolean> {
  return bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: id, containerName: `c${id}`, content }),
  );
}

/* --- Small text helpers (no box-drawing — just spacing) ------------------- */

/** Pad `left` and `right` onto one line ~`width` chars wide (best-effort). */
export function spread(left: string, right: string, width = 40): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

/**
 * Center each line of `text` within a roughly-`charWidth`-wide container.
 *
 * Measured on the simulator and confirmed against the chrome header which
 * spans ~58 chars edge-to-edge: the G2 font renders at ~9.7px per char
 * (NOT the 16px we initially assumed). A 576px container minus padding
 * holds about 56 characters per line; default to that.
 */
export function center(text: string, charWidth = 100): string {
  return text
    .split('\n')
    .map((line) => {
      const pad = Math.max(0, Math.floor((charWidth - line.length) / 2));
      return ' '.repeat(pad) + line;
    })
    .join('\n');
}
