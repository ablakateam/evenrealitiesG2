import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center, listHeightFor, listRowsVisible } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import {
  getDraft,
  getBodyText,
  setTone,
  setChannel,
  setRecipient,
  type ComposeDraft,
} from '../draft.js';
import type { Tone } from '../api.js';
import { apiGet, HudApiError } from '../api.js';
import { sendDraft } from './send.js';
import { IdlePage } from './idle.js';
import { makeStubPage } from './stub.js';

/**
 * Confirm — review the message before sending, and change its style.
 *
 * ── Why this page was rebuilt in v0.1.17 ────────────────────────────────
 * v0.1.15 collapsed the main list to three rows (SEND / switch-channel /
 * "tone: X >") and hid the tone list behind a submenu. The information
 * architecture was right; the geometry was not. The list container was
 * 78 px tall and the firmware draws list rows at a ~32 px pitch, so only
 * TWO rows ever rendered. The third row — the tone submenu entry — fell off
 * the bottom of the container. It was not scrolled to, it was never drawn.
 *
 * From the wearer's seat that reads exactly as the bug report: "there is no
 * way to select the message style, it is permanently Casual."
 *
 * The fix is to derive every list height from `listHeightFor(rows)` instead
 * of hand-picking pixels, and to keep the main list at a number of rows that
 * provably fits. Channel switching moved into the style submenu so the main
 * list is a fixed two rows that always render.
 *
 * ── Modes (all share ONE container shape: text 2,3,4 + list 5 + chrome) ──
 *   ready              list = [SEND, "Style: Casual  >"]
 *   picking-style      list = [back, ...tones, switch-channel?]
 *   needs-recipient    list = [pick recipient, cancel]
 *   picking-recipient  list = [...contacts, cancel]
 */

const TITLE_ID = 2;
const BODY_ID = 4;
const LIST_ID = 5;

/* --- geometry ----------------------------------------------------------
 * BODY_TOP = 40, BODY_BOTTOM = 256 -> 216 px of body to spend.
 * Text containers need >= 26 px to render a line without clipping.
 * List heights come from listHeightFor() so a row can never be orphaned.
 *
 * The header is ONE line ("Dennis  ·  SMS  ·  +1555...") rather than the
 * title+meta pair it used to be. At the corrected 40 px row pitch the action
 * list needs 94 px, and spending 26 px on a second header line would have
 * cost the message body its third line — the exact complaint ("message not
 * fully visible") that predates this screen's last redesign. The active
 * style moved onto its own list row, so the header no longer has to carry it.
 */
const HEADER_Y = BODY_TOP;                              // 40
const HEADER_H = 26;

/** ready: 2-row action list + a 3-line message body. */
const READY_LIST_ROWS = 2;
const READY_LIST_H = listHeightFor(READY_LIST_ROWS);    // 94
const READY_LIST_Y = BODY_BOTTOM - READY_LIST_H;        // 162
const READY_BODY_Y = HEADER_Y + HEADER_H + 4;           // 70
const READY_BODY_H = READY_LIST_Y - READY_BODY_Y - 4;   // 88 -> 3 lines

/** picker: body collapses to a spacer so the list dominates (4 rows). */
const PICKER_BODY_Y = READY_BODY_Y;                     // 70
const PICKER_BODY_H = 4;
const PICKER_LIST_Y = PICKER_BODY_Y + PICKER_BODY_H + 4; // 78
const PICKER_LIST_H = BODY_BOTTOM - PICKER_LIST_Y;      // 178 -> 4 rows

const BODY_WRAP = 36;
const BODY_MAX_LINES = 3;

const TONE_ORDER: Tone[] = [
  'casual',
  'professional',
  'friendly',
  'formal',
  'sarcastic',
  'grammar',
  'original',
];

const SEND_LABEL = '── SEND ──';
const BACK_LABEL = '── back ──';
const PICKING_CANCEL_LABEL = '── cancel ──';
const PICK_LABEL = 'pick recipient';
const CANCEL_LABEL = 'cancel';

const MAX_CONTACTS_VISIBLE = 19; // 20-item firmware cap, save one for cancel

type Mode = 'ready' | 'needs-recipient' | 'picking-recipient' | 'picking-style';

interface PickerContact {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

// Module state — what the list represents at render time. onEvent maps a
// selection index back to an action through these.
let mode: Mode = 'ready';
let styleRows: Tone[] = [];
let styleHasChannelRow = false;
let pickerRows: PickerContact[] = [];
let pickerError: string | null = null;

export const ConfirmPage: Page = {
  id: 'confirm',

  async mount(ctx: PageContext): Promise<void> {
    const draft = getDraft();
    if (!draft) {
      await ctx.router.push(
        makeStubPage('confirm-empty', 'Hmm.', 'Nothing to confirm — start a new compose.'),
      );
      return;
    }
    // Entering Confirm always starts on the review screen, never inside a
    // submenu left over from a previous message.
    mode = isReady(draft) ? 'ready' : 'needs-recipient';
    await render(ctx, draft);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    // Ignore selections attributed to any container other than our menu —
    // chrome pages carry off-screen padding lists.
    if (event.containerID !== LIST_ID) return;
    const draft = getDraft();
    if (!draft) return;

    if (mode === 'needs-recipient') return onNeedsRecipient(event.index, ctx, draft);
    if (mode === 'picking-recipient') return onPickingRecipient(event.index, ctx, draft);
    if (mode === 'picking-style') return onPickingStyle(event.index, ctx, draft);
    return onReady(event.index, ctx, draft);
  },
};

/* --- event handlers ---------------------------------------------------- */

async function onReady(index: number, ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Items are exactly [SEND, style-entry].
  if (index === 0) {
    await sendDraft(ctx);
    return;
  }
  mode = 'picking-style';
  await render(ctx, draft);
}

async function onPickingStyle(index: number, ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Items are [BACK, ...styleRows, (switch-channel)?].
  if (index === 0) {
    mode = 'ready';
    await render(ctx, draft);
    return;
  }
  const toneIndex = index - 1;
  if (toneIndex < styleRows.length) {
    const picked = styleRows[toneIndex]!;
    setTone(picked);
    mode = 'ready';
    await render(ctx, getDraft() ?? draft);
    return;
  }
  // The trailing row, when present, flips the channel.
  if (styleHasChannelRow && toneIndex === styleRows.length) {
    setChannel(draft.channel === 'sms' ? 'email' : 'sms');
    mode = 'ready';
    await render(ctx, getDraft() ?? draft);
  }
}

async function onNeedsRecipient(index: number, ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Items are [PICK_LABEL, CANCEL_LABEL].
  if (index === 0) {
    await enterPickingRecipient(ctx, draft);
    return;
  }
  await ctx.router.go(IdlePage);
}

async function onPickingRecipient(index: number, ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Items are [...contacts, PICKING_CANCEL_LABEL].
  if (index >= 0 && index < pickerRows.length) {
    const picked = pickerRows[index]!;
    setRecipient({ id: picked.id, name: picked.name, phone: picked.phone, email: picked.email });
    const fresh = getDraft();
    if (!fresh) return;
    mode = isReady(fresh) ? 'ready' : 'needs-recipient';
    await render(ctx, fresh);
    return;
  }
  if (index === pickerRows.length) {
    mode = isReady(draft) ? 'ready' : 'needs-recipient';
    await render(ctx, draft);
  }
}

async function enterPickingRecipient(ctx: PageContext, draft: ComposeDraft): Promise<void> {
  pickerError = null;
  pickerRows = [];
  mode = 'picking-recipient';
  // Interim state so the wearer gets feedback during the round trip.
  await render(ctx, draft);

  try {
    const data = await apiGet<{
      items: Array<{ id: number; name: string; phone_e164: string | null; email: string | null }>;
    }>('/api/contacts?limit=50');
    pickerRows = data.items.slice(0, MAX_CONTACTS_VISIBLE).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone_e164,
      email: c.email,
    }));
  } catch (err) {
    pickerError = err instanceof HudApiError ? `contacts: ${err.code}` : 'network error';
  }
  await render(ctx, draft);
}

/* --- render ------------------------------------------------------------ */

async function render(ctx: PageContext, draft: ComposeDraft): Promise<void> {
  let items: string[];
  let title: string;
  let body: string;
  let hint: string;
  let bodyY = READY_BODY_Y;
  let bodyH = READY_BODY_H;
  let listY = READY_LIST_Y;
  let listH = READY_LIST_H;

  if (mode === 'picking-recipient') {
    styleRows = [];
    items = pickerError
      ? [pickerError, PICKING_CANCEL_LABEL]
      : pickerRows.length > 0
        ? pickerRows.map(formatContactRow).concat([PICKING_CANCEL_LABEL])
        : ['loading contacts...'];
    title = center(
      pickerRows.length > 0 ? `pick recipient  ·  ${pickerRows.length} contacts` : 'pick recipient',
    );
    body = '';
    bodyY = PICKER_BODY_Y;
    bodyH = PICKER_BODY_H;
    listY = PICKER_LIST_Y;
    listH = PICKER_LIST_H;
    hint = 'tap to pick  ·  2x for home';
  } else if (mode === 'picking-style') {
    styleRows = availableTones(draft);
    styleHasChannelRow = canToggleChannel(draft);
    const rows = styleRows.map((t) =>
      t === draft.tone ? `> ${capitalize(t)}` : `  ${capitalize(t)}`,
    );
    if (styleHasChannelRow) {
      rows.push(draft.channel === 'sms' ? '  Send as Email instead' : '  Send as SMS instead');
    }
    items = [BACK_LABEL].concat(rows);
    title = center(`message style  ·  now: ${capitalize(draft.tone)}`);
    body = '';
    bodyY = PICKER_BODY_Y;
    bodyH = PICKER_BODY_H;
    listY = PICKER_LIST_Y;
    listH = PICKER_LIST_H;
    hint = 'scroll to browse  ·  tap to apply';
  } else if (mode === 'ready') {
    styleRows = [];
    // Exactly two rows, and listHeightFor(2) guarantees both render.
    items = [SEND_LABEL, `Style: ${capitalize(draft.tone)}`.padEnd(26) + '>'];
    title = center(headerLine(draft));
    body = wrapBody(getBodyText(draft));
    hint = 'tap SEND  ·  scroll for style  ·  2x cancel';
  } else {
    styleRows = [];
    items = [PICK_LABEL, CANCEL_LABEL];
    title = center('pick a recipient');
    body = wrapBody(getBodyText(draft));
    hint = 'no recipient — pick one';
  }

  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: HEADER_Y, w: 576, h: HEADER_H, border: 0, padding: 4, capture: false, content: title },
      { id: BODY_ID, x: 0, y: bodyY, w: 576, h: bodyH, border: 0, padding: 8, capture: false, content: body },
    ],
    lists: [
      { id: LIST_ID, x: 0, y: listY, w: 576, h: listH, border: 1, padding: 6, capture: true, items },
    ],
    chrome: { hint },
  });
}

/* --- helpers ----------------------------------------------------------- */

function canToggleChannel(draft: ComposeDraft): boolean {
  if (draft.locked.channel) return false;
  return Boolean(draft.recipient.phone && draft.recipient.email);
}

function formatContactRow(c: PickerContact): string {
  const hint = c.phone && c.email ? 'both' : c.phone ? 'phone' : c.email ? 'email' : 'no address';
  const name = c.name.length > 22 ? c.name.slice(0, 21) + '~' : c.name;
  return `${name.padEnd(22)} ${hint}`;
}

/**
 * One line answering "who, how, where" — the three things the wearer must be
 * able to verify before tapping SEND. Style is deliberately absent: it has
 * its own row in the action list right below.
 */
function headerLine(draft: ComposeDraft): string {
  const who = draft.replyContext
    ? truncate(`reply to ${draft.replyContext.from_name}`, 18)
    : draft.recipient.name
      ? truncate(draft.recipient.name, 18)
      : 'send';
  const channel =
    draft.channel === 'sms' ? 'SMS' : draft.channel === 'email' ? 'Email' : 'SMS+Email';
  return `${who}  ·  ${channel}  ·  ${truncate(destination(draft), 24)}`;
}

/** The address this will actually go to, for eyes-on verification. */
function destination(draft: ComposeDraft): string {
  if (draft.channel === 'email' && draft.recipient.email) return draft.recipient.email;
  if (draft.channel === 'sms' && draft.recipient.phone) return draft.recipient.phone;
  return draft.recipient.phone ?? draft.recipient.email ?? '(no address)';
}

function isReady(draft: ComposeDraft): boolean {
  if (!draft.recipient.id && !draft.recipient.phone && !draft.recipient.email) return false;
  if (draft.channel === 'sms' && !draft.recipient.phone) return false;
  if (draft.channel === 'email' && !draft.recipient.email) return false;
  return true;
}

/** Tones that actually came back with usable text for this message. */
function availableTones(draft: ComposeDraft): Tone[] {
  return TONE_ORDER.filter((t) => draft.variants.some((v) => v.tone === t && !v.error && v.text));
}

function wrapBody(body: string): string {
  const lines = wordWrap(body, BODY_WRAP);
  if (lines.length <= BODY_MAX_LINES) return lines.join('\n');
  const head = lines.slice(0, BODY_MAX_LINES - 1).join('\n');
  const tail = lines.slice(BODY_MAX_LINES - 1).join(' ');
  return head + '\n' + truncate(tail, BODY_WRAP - 3) + '...';
}

function wordWrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.length === 0) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word.slice(0, width);
      } else if (line.length + 1 + word.length <= width) {
        line += ' ' + word;
      } else {
        out.push(line);
        line = word.slice(0, width);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '~' : s;
}

/** Compile-time-ish guard: the ready list must never orphan a row. */
if (listRowsVisible(READY_LIST_H) < READY_LIST_ROWS) {
  console.warn('[confirm] ready list too short — a row will not render');
}
