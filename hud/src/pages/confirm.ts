import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, updateText, center } from '../render.js';
import { BODY_TOP } from '../chrome.js';
import { getDraft, getBodyText, setTone, setRecipient, type ComposeDraft } from '../draft.js';
import type { Tone } from '../api.js';
import { apiGet, HudApiError } from '../api.js';
import { sendDraft } from './send.js';
import { IdlePage } from './idle.js';
import { makeStubPage } from './stub.js';

/**
 * Confirm — review the rewritten message before sending.
 *
 * Three modes, ALL rendered with the SAME container shape (4 text + 1
 * capture list + 2 chrome) so we never re-introduce a dropped container ID
 * across a back-pop (L:38 SDK quirk). The page never navigates to a
 * separate picker — pickers are embedded as list-content swaps.
 *
 *   ready (recipient resolved):
 *     list = [tone1, tone2, ..., toneN, "── SEND ──"]
 *     tap a tone → setTone() + updateText(BODY) in place
 *     tap SEND → sendDraft()
 *
 *   needs-recipient (recipient_id missing):
 *     list = ["pick recipient", "cancel"]
 *     tap pick → switch to picking-recipient mode (fetches contacts)
 *     tap cancel → router.go(IdlePage)
 *
 *   picking-recipient (in-place contact list):
 *     list = [contactName, contactName, ..., "── cancel ──"]
 *     tap a contact → setRecipient(), switch to ready mode
 *     tap cancel → switch back to needs-recipient mode
 *
 * Layout (all fit BODY_TOP..256, never overlap chrome):
 *   y  40– 62   title   (id 2, text)
 *   y  64– 84   meta    (id 3, text)
 *   y  86–186   body    (id 4, text, wrapped, ~5 visible lines)
 *   y 188–256   list    (id 5, list, CAPTURE, ~3 items visible scrollable)
 */

const TITLE_ID = 2;
const META_ID = 3;
const BODY_ID = 4;
const LIST_ID = 5;

// Layout: two per-mode geometries that share the same container IDs so
// the rebuild-shape rule (L:38) holds across mode flips. Each text
// container needs ~26px to hold a line without vertical clipping.
//
//   ready / needs-recipient — body bordered, ~3-line preview, list ~4 visible:
//     y 40–66    title
//     y 68–94    meta
//     y 100–156  body (border 1, 3 lines)
//     y 160–256  list (~4 items visible scrollable)
//
//   picking-recipient — body collapsed to a one-line helper, list dominates:
//     y 40–66    title
//     y 68–94    meta
//     y 96–116   body (no border, single helper line)
//     y 118–256  list (~5 items visible scrollable)
const TITLE_Y = BODY_TOP;             // 40
const TITLE_H = 26;
const META_Y = TITLE_Y + TITLE_H + 2; // 68
const META_H = 26;

const READY_BODY_Y = META_Y + META_H + 6;   // 100
const READY_BODY_H = 62;                    // 100..162 — fits 2 wrapped lines + breathing room
const READY_LIST_Y = READY_BODY_Y + READY_BODY_H + 4; // 166
const READY_LIST_H = 90;                    // 166..256 — ~3 items visible

// Picker collapses body to an invisible 4px spacer so the list dominates.
// Same container IDs as ready mode preserves the shape rule (L:38).
const PICKER_BODY_Y = META_Y + META_H + 2;  // 96
const PICKER_BODY_H = 4;                    // 96..100 (effectively invisible)
const PICKER_LIST_Y = PICKER_BODY_Y + PICKER_BODY_H + 2; // 102
const PICKER_LIST_H = 154;                  // 102..256

const BODY_WRAP = 32;
const BODY_MAX_LINES = 2; // matches READY_BODY_H — anything longer truncates with "..."

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
const PICK_LABEL = 'pick recipient';
const CANCEL_LABEL = 'cancel';
const PICKING_CANCEL_LABEL = '── cancel ──';

const MAX_CONTACTS_VISIBLE = 19; // 20-item list cap, save one for cancel

type Mode = 'ready' | 'needs-recipient' | 'picking-recipient';

interface PickerContact {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

// Module state — what the list represents at render time. onEvent uses this
// to map a list-select index back to an action.
let mode: Mode = 'ready';
let listTones: Tone[] = [];
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
    await render(ctx, draft);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const draft = getDraft();
    if (!draft) return;

    if (mode === 'needs-recipient') {
      // Items are [PICK_LABEL, CANCEL_LABEL] in that order.
      if (event.index === 0) {
        await enterPickingRecipient(ctx, draft);
      } else {
        await ctx.router.go(IdlePage);
      }
      return;
    }

    if (mode === 'picking-recipient') {
      // Items are [contactName, contactName, ..., PICKING_CANCEL_LABEL].
      if (event.index >= 0 && event.index < pickerRows.length) {
        const picked = pickerRows[event.index]!;
        setRecipient({
          id: picked.id,
          name: picked.name,
          phone: picked.phone,
          email: picked.email,
        });
        // Exit picker mode explicitly so render() flips to ready/needs based
        // on the new draft state.
        mode = 'ready';
        const fresh = getDraft();
        if (!fresh) return;
        await render(ctx, fresh);
      } else if (event.index === pickerRows.length) {
        // Cancel back to needs-recipient (or ready if draft happens to be).
        mode = isReady(draft) ? 'ready' : 'needs-recipient';
        await render(ctx, draft);
      }
      return;
    }

    // mode === 'ready': items are [SEND_LABEL, ...listTones]. SEND is now
    // at index 0 — first thing the cursor lands on — so the user never has
    // to scroll past the tone list to reach it.
    if (event.index === 0) {
      await sendDraft(ctx);
      return;
    }
    const toneIndex = event.index - 1;
    if (toneIndex >= 0 && toneIndex < listTones.length) {
      const newTone = listTones[toneIndex]!;
      if (newTone !== draft.tone) {
        setTone(newTone);
        const fresh = getDraft();
        if (!fresh) return;
        // Patch the parts that depend on tone — body + meta — and re-render
        // the list so the cursor marker moves to the new selection.
        await updateText(ctx.bridge, BODY_ID, wrapBody(getBodyText(fresh)));
        await updateText(ctx.bridge, META_ID, metaLine(fresh));
        await render(ctx, fresh);
      }
    }
  },
};

async function enterPickingRecipient(ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Render an interim "loading contacts" state so the user sees feedback
  // immediately while we hit /api/contacts. Then re-render with the list.
  pickerError = null;
  pickerRows = [];
  mode = 'picking-recipient';
  await renderPickingPlaceholder(ctx);

  try {
    const data = await apiGet<{ items: Array<{ id: number; name: string; phone_e164: string | null; email: string | null }> }>(
      '/api/contacts?limit=50',
    );
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

async function renderPickingPlaceholder(ctx: PageContext): Promise<void> {
  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: TITLE_Y, w: 576, h: TITLE_H, border: 0, padding: 4, capture: false, content: center('pick recipient') },
      { id: META_ID,  x: 0, y: META_Y,  w: 576, h: META_H,  border: 0, padding: 4, capture: false, content: center('loading contacts...') },
      { id: BODY_ID,  x: 0, y: PICKER_BODY_Y, w: 576, h: PICKER_BODY_H, border: 0, padding: 4, capture: false, content: '' },
    ],
    lists: [
      { id: LIST_ID, x: 0, y: PICKER_LIST_Y, w: 576, h: PICKER_LIST_H, border: 1, padding: 6, capture: true, items: ['...'] },
    ],
    chrome: { hint: '2x to cancel' },
  });
}

/* --- render ----------------------------------------------------------- */

async function render(ctx: PageContext, draft: ComposeDraft): Promise<void> {
  // Picker mode keeps its own state until the user picks or cancels —
  // don't auto-flip back to ready/needs based on draft readiness while
  // the user is still inside the picker.
  if (mode !== 'picking-recipient') {
    mode = isReady(draft) ? 'ready' : 'needs-recipient';
  }

  let items: string[];
  let title: string;
  let meta: string;
  let body: string;
  let hint: string;
  let bodyBorder = 1;
  let bodyY = READY_BODY_Y;
  let bodyH = READY_BODY_H;
  let listY = READY_LIST_Y;
  let listH = READY_LIST_H;

  if (mode === 'picking-recipient') {
    listTones = [];
    if (pickerError) {
      items = [pickerError, PICKING_CANCEL_LABEL];
    } else {
      items = pickerRows.map(formatContactRow).concat([PICKING_CANCEL_LABEL]);
    }
    title = center('pick recipient');
    meta = center(`${pickerRows.length} contacts${pickerError ? ' (error)' : ''}`);
    body = ''; // body is collapsed to a 4px spacer in picker mode
    bodyBorder = 0;
    bodyY = PICKER_BODY_Y;
    bodyH = PICKER_BODY_H;
    listY = PICKER_LIST_Y;
    listH = PICKER_LIST_H;
    hint = 'tap to pick   ·   2x to cancel';
  } else if (mode === 'ready') {
    listTones = availableTones(draft);
    // SEND at the TOP so it's the first thing under the cursor — earlier
    // we buried it at the bottom of 7 tones and the user couldn't reach
    // it without ~5 scrolls.
    items = [SEND_LABEL].concat(
      listTones.map((t) => (t === draft.tone ? `> ${capitalize(t)}` : `  ${capitalize(t)}`)),
    );
    title = center(titleLine(draft, true));
    meta = center(metaLine(draft));
    body = wrapBody(getBodyText(draft));
    hint = 'tap SEND or pick a tone   ·   2x to cancel';
  } else {
    listTones = [];
    items = [PICK_LABEL, CANCEL_LABEL];
    title = center(titleLine(draft, false));
    meta = center(metaLine(draft));
    body = wrapBody(getBodyText(draft));
    hint = 'no recipient — pick one';
  }

  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: TITLE_Y, w: 576, h: TITLE_H, border: 0, padding: 4, capture: false, content: title },
      { id: META_ID,  x: 0, y: META_Y,  w: 576, h: META_H,  border: 0, padding: 4, capture: false, content: meta },
      { id: BODY_ID,  x: 0, y: bodyY,   w: 576, h: bodyH,   border: bodyBorder, padding: 8, capture: false, content: body },
    ],
    lists: [
      { id: LIST_ID, x: 0, y: listY, w: 576, h: listH, border: 1, padding: 6, capture: true, items },
    ],
    chrome: { hint },
  });
}

function formatContactRow(c: PickerContact): string {
  const hint = c.phone && c.email ? 'PH+EM' : c.phone ? 'PH' : c.email ? 'EM' : '--';
  const name = c.name.length > 22 ? c.name.slice(0, 21) + '~' : c.name;
  return `${name.padEnd(22)} ${hint}`;
}

function titleLine(draft: ComposeDraft, ready: boolean): string {
  if (!ready) return 'pick a recipient';
  if (draft.replyContext) return `reply to ${draft.replyContext.from_name}`;
  if (draft.recipient.name) return `send to ${draft.recipient.name}`;
  return 'send';
}

function metaLine(draft: ComposeDraft): string {
  const channel =
    draft.channel === 'sms' ? 'SMS' : draft.channel === 'email' ? 'Email' : 'SMS+Email';
  const tone = capitalize(draft.tone);
  return `${channel}  ·  ${tone}`;
}

function isReady(draft: ComposeDraft): boolean {
  if (!draft.recipient.id) return false;
  if (draft.channel === 'sms' && !draft.recipient.phone) return false;
  if (draft.channel === 'email' && !draft.recipient.email) return false;
  return true;
}

function availableTones(draft: ComposeDraft): Tone[] {
  return TONE_ORDER.filter((t) =>
    draft.variants.some((v) => v.tone === t && !v.error && v.text),
  );
}

/* --- body wrapping ---------------------------------------------------- */

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
