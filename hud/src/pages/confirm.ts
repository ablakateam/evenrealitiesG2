import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP } from '../chrome.js';
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

// Layout: three per-mode geometries share the same container IDs so the
// rebuild-shape rule (L:38) holds across mode flips. All fit inside the
// body area BODY_TOP=40 .. BODY_BOTTOM=256 (216px total).
//
// Text containers need ≥26px vertical to hold a rendered line without
// clipping (tested on sim). List items rendered by the SDK take ~32px
// each including selection border + padding, so 4 items ≈ 128px.
//
//   ready / needs-recipient — main action list is tiny (3 items: SEND,
//   switch-channel, tone-picker-entry), so we can afford a bigger body:
//     y 40– 66   title  (26px)
//     y 68– 94   meta   (26px — full height so descenders don't clip)
//     y 96–176   body   (80px, 3 wrapped lines, no border — reads as
//                        content, not a container)
//     y 178–256  list   (78px, holds 3 short items: SEND / switch / tone)
//
//   picking-tone — same as picking-recipient (body collapses, list wins):
//     (identical container geometry, only list contents change)
//
//   picking-recipient — body collapses to 4px spacer so list dominates:
//     y 40– 66   title
//     y 68– 94   meta
//     y 96–100   body   (4px spacer, invisible)
//     y 102–256  list   (154px, ~5 contacts visible)
const TITLE_Y = BODY_TOP;                   // 40
const TITLE_H = 26;
const META_Y = TITLE_Y + TITLE_H + 2;       // 68
const META_H = 26;                          // full 26px so descenders don't clip

const READY_BODY_Y = META_Y + META_H + 2;   // 96
const READY_BODY_H = 80;                    // 96..176 — 3 wrapped lines
const READY_LIST_Y = READY_BODY_Y + READY_BODY_H + 2; // 178
const READY_LIST_H = 78;                    // 178..256 — holds 3 tiny items

// Picker collapses body to an invisible 4px spacer so the list dominates.
// Same container IDs as ready mode preserves the shape rule (L:38).
const PICKER_BODY_Y = META_Y + META_H + 2;  // 96
const PICKER_BODY_H = 4;                    // 96..100 (effectively invisible)
const PICKER_LIST_Y = PICKER_BODY_Y + PICKER_BODY_H + 2; // 102
const PICKER_LIST_H = 154;                  // 102..256 — 5+ contacts visible

const BODY_WRAP = 36;
const BODY_MAX_LINES = 3; // matches READY_BODY_H — 3 lines fits real messages

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
const SWITCH_TO_EMAIL_LABEL = 'switch to Email';
const SWITCH_TO_SMS_LABEL = 'switch to SMS';
const TONE_MENU_ENTRY = 'tone: ';         // suffix filled with current tone name
const PICK_LABEL = 'pick recipient';
const CANCEL_LABEL = 'cancel';
const PICKING_CANCEL_LABEL = '── cancel ──';
const TONE_BACK_LABEL = '── back ──';

const MAX_CONTACTS_VISIBLE = 19; // 20-item list cap, save one for cancel

type Mode = 'ready' | 'needs-recipient' | 'picking-recipient' | 'picking-tone';

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

    if (mode === 'picking-tone') {
      // Items are [TONE_BACK_LABEL, ...listTones]. Back at index 0 returns
      // to ready; any other index is a tone selection.
      if (event.index === 0) {
        mode = 'ready';
        await render(ctx, draft);
        return;
      }
      const toneIndex = event.index - 1;
      if (toneIndex >= 0 && toneIndex < listTones.length) {
        const newTone = listTones[toneIndex]!;
        if (newTone !== draft.tone) {
          setTone(newTone);
        }
        // Return to ready regardless — user has made their pick.
        mode = 'ready';
        const fresh = getDraft();
        if (!fresh) return;
        await render(ctx, fresh);
      }
      return;
    }

    // mode === 'ready': items are [SEND, (switch-channel?), tone-entry].
    // SEND is always index 0; channel toggle is index 1 when present
    // (recipient has both phone+email AND not locked); tone-entry follows.
    if (event.index === 0) {
      await sendDraft(ctx);
      return;
    }

    const toggleVisible = canToggleChannel(draft);
    if (toggleVisible && event.index === 1) {
      // Flip channel in place — title + meta both change.
      const next = draft.channel === 'sms' ? 'email' : 'sms';
      setChannel(next);
      const fresh = getDraft();
      if (!fresh) return;
      await render(ctx, fresh);
      return;
    }

    // Any remaining index in ready mode is the tone-picker entry.
    const toneEntryIndex = toggleVisible ? 2 : 1;
    if (event.index === toneEntryIndex) {
      mode = 'picking-tone';
      await render(ctx, draft);
      return;
    }
  },
};

function canToggleChannel(draft: ComposeDraft): boolean {
  if (draft.locked.channel) return false;
  return Boolean(draft.recipient.phone && draft.recipient.email);
}

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
  // Picker/tone-picker modes keep their own state until the user picks or
  // cancels — don't auto-flip back to ready/needs based on draft readiness
  // while the user is still inside one of the sub-menus.
  if (mode !== 'picking-recipient' && mode !== 'picking-tone') {
    mode = isReady(draft) ? 'ready' : 'needs-recipient';
  }

  let items: string[];
  let title: string;
  let meta: string;
  let body: string;
  let hint: string;
  // Body has no border by default — the transcribed message reads as
  // content, not "a container." The list keeps its border because it's
  // an interactive surface the user needs to see the bounds of.
  let bodyBorder = 0;
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
    bodyY = PICKER_BODY_Y;
    bodyH = PICKER_BODY_H;
    listY = PICKER_LIST_Y;
    listH = PICKER_LIST_H;
    hint = 'tap to pick   ·   2x to cancel';
  } else if (mode === 'ready') {
    listTones = availableTones(draft);
    // Ready-mode list is deliberately TINY: SEND + (maybe) switch-channel
    // + tone submenu entry. Keeping the list at ~3 items means we can
    // give the body 3 lines instead of 2, which is the difference between
    // seeing a real message vs a truncated preview. Tapping the tone row
    // swaps the list into 'picking-tone' mode (all 7 tones + back).
    const head: string[] = [SEND_LABEL];
    if (canToggleChannel(draft)) {
      head.push(draft.channel === 'sms' ? SWITCH_TO_EMAIL_LABEL : SWITCH_TO_SMS_LABEL);
    }
    items = head.concat([`${TONE_MENU_ENTRY}${capitalize(draft.tone)}  >`]);
    title = center(titleLine(draft, true));
    meta = center(destinationLine(draft));
    body = wrapBody(getBodyText(draft));
    hint = 'tap SEND  ·  2x cancel';
  } else if (mode === 'picking-tone') {
    listTones = availableTones(draft);
    items = [TONE_BACK_LABEL].concat(
      listTones.map((t) => (t === draft.tone ? `> ${capitalize(t)}` : `  ${capitalize(t)}`)),
    );
    title = center(titleLine(draft, true));
    meta = center('pick a tone');
    // Collapse the body in tone-picker mode (mirrors recipient picker) so
    // the list dominates and 5+ tones are visible without scroll. Same
    // container IDs as ready mode preserves the L:38 shape rule.
    body = '';
    bodyY = PICKER_BODY_Y;
    bodyH = PICKER_BODY_H;
    listY = PICKER_LIST_Y;
    listH = PICKER_LIST_H;
    hint = `${listTones.length} tones  ·  tap to apply`;
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
  // Plain-English channel summary instead of cryptic PH/EM/PH+EM codes.
  const hint =
    c.phone && c.email ? 'both' : c.phone ? 'phone' : c.email ? 'email' : 'no address';
  const name = c.name.length > 22 ? c.name.slice(0, 21) + '~' : c.name;
  return `${name.padEnd(22)} ${hint}`;
}

function titleLine(draft: ComposeDraft, ready: boolean): string {
  if (!ready) return 'pick a recipient';
  // Title is one ~36-char line so we keep it compact: "<who>  ·  <channel>".
  // Tone shows in the list with `>` marker so doesn't need to ride here too.
  const who = draft.replyContext
    ? truncate(`reply to ${draft.replyContext.from_name}`, 22)
    : draft.recipient.name
      ? truncate(draft.recipient.name, 22)
      : 'send';
  const channel =
    draft.channel === 'sms' ? 'SMS' : draft.channel === 'email' ? 'Email' : 'SMS+Email';
  return `${who}  ·  ${channel}`;
}

function destinationLine(draft: ComposeDraft): string {
  // Show the actual destination address + the active tone, so the user
  // can verify BOTH "where is this going" and "what voice am I using"
  // without scrolling back to the tone list.
  let address: string;
  if (draft.channel === 'email' && draft.recipient.email) address = draft.recipient.email;
  else if (draft.channel === 'sms' && draft.recipient.phone) address = draft.recipient.phone;
  else if (draft.recipient.phone) address = draft.recipient.phone;
  else if (draft.recipient.email) address = draft.recipient.email;
  else address = '(no address)';
  return `${address}  ·  ${capitalize(draft.tone)}`;
}

function metaLine(draft: ComposeDraft): string {
  // Kept for needs-recipient / picker placeholder paths (no destination yet).
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
