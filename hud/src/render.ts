import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';

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
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  });
}

/**
 * The first page of the app must use createStartUpPageContainer; every page
 * after that uses rebuildPageContainer. We track that here so callers just
 * call `showPage()` and don't have to care.
 */
let firstPageShown = false;

export interface PageSpec {
  texts?: TextBox[];
  lists?: ListBox[];
}

/** Render a page. Picks createStartUp vs rebuild automatically. */
export async function showPage(bridge: EvenAppBridge, spec: PageSpec): Promise<boolean> {
  const textObject = (spec.texts ?? []).map(textProp);
  const listObject = (spec.lists ?? []).map(listProp);
  const total = textObject.length + listObject.length;

  if (!firstPageShown) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ containerTotalNum: total, textObject, listObject }),
    );
    firstPageShown = true;
    if (result !== PAGE_OK) {
      console.error(`[render] createStartUpPageContainer failed: ${result}`);
      return false;
    }
    return true;
  }

  return bridge.rebuildPageContainer(
    new RebuildPageContainer({ containerTotalNum: total, textObject, listObject }),
  );
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
