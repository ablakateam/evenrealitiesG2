import type { TextBox } from './render.js';

/**
 * Persistent header + footer "chrome" for every page.
 *
 * The G2's `rebuildPageContainer` replaces ALL containers atomically, so
 * there is no real "persistent" overlay — what we have instead is a
 * convention: every page that opts in (`chrome` field on its PageSpec) gets
 * two extra text containers automatically added by `showPage`, one across
 * the top with system status and one across the bottom with page-specific
 * hint text.
 *
 * Status (Twilio/Mail/Battery) lives in this module's cache. Pages that
 * know fresh values (Idle on mount, Voice during a flow) push updates via
 * `setAppStatus()`; subsequent renders pick them up. The chrome footer
 * hint is per-page and is passed in at render time.
 *
 * Reserved container IDs: 90 for the header, 99 for the footer. Body pages
 * should use IDs 1–8 to avoid collision.
 */

export const CHROME_HEADER_ID = 90;
export const CHROME_FOOTER_ID = 99;

const HEADER_H = 36;
const FOOTER_H = 28;
const FOOTER_Y = 288 - FOOTER_H;

/** Y-coordinate where page body content can safely start (below the header). */
export const BODY_TOP = HEADER_H + 4;
/** Y-coordinate where page body content must end (above the footer). */
export const BODY_BOTTOM = FOOTER_Y - 4;

export interface AppStatus {
  twilio: boolean;
  email: boolean;
  battery: number | null;
  unread: number;
}

let appStatus: AppStatus = { twilio: false, email: false, battery: null, unread: 0 };

export function getAppStatus(): AppStatus {
  return appStatus;
}

export function setAppStatus(partial: Partial<AppStatus>): void {
  appStatus = { ...appStatus, ...partial };
}

export interface ChromeOpts {
  /** Footer hint line. Empty string renders an empty footer band. */
  hint: string;
}

export function chromeHeaderBox(): TextBox {
  const { twilio, email, battery } = appStatus;
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const bat = battery != null ? `${battery}%` : '--';
  const twl = twilio ? '*' : 'o';
  const mail = email ? '*' : 'o';
  return {
    id: CHROME_HEADER_ID,
    x: 0,
    y: 0,
    w: 576,
    h: HEADER_H,
    border: 0,
    padding: 6,
    capture: false,
    content: `VOX    TWL ${twl}  MAIL ${mail}  BAT ${bat}    ${clock}`,
  };
}

export function chromeFooterBox(hint: string): TextBox {
  return {
    id: CHROME_FOOTER_ID,
    x: 0,
    y: FOOTER_Y,
    w: 576,
    h: FOOTER_H,
    border: 0,
    padding: 6,
    capture: false,
    content: hint,
  };
}
