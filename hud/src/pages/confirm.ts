import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { getDraft, getBodyText, type ComposeDraft } from '../draft.js';
import { RecipientPickerPage } from './recipient-picker.js';
import { ChannelPickerPage } from './channel-picker.js';
import { TonePickerPage } from './tone-picker.js';
import { SubjectPromptPage } from './subject-prompt.js';
import { ComposePage } from './compose.js';
import { sendDraft } from './send.js';
import { makeStubPage } from './stub.js';

/**
 * Confirm page — the parsed-intent review screen.
 *
 * Singleton: reads from the shared compose-draft module on every mount, so
 * after a picker mutates the draft and pops back, the screen reflects the
 * edit. Each atom row (TO / VIA / TONE / MSG / SUBJECT for email) routes a
 * tap to its picker. The SEND row triggers the outbound call.
 *
 * Layout: same 3-container shape as the rest of the app (title-text c1,
 * list c2 capture, footer-text c3) — see LESSONSLEARNED §P13 for why.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

type AtomKey = 'to' | 'via' | 'subject' | 'tone' | 'msg' | 'send';

interface Atom {
  key: AtomKey;
  label: string;
}

// Build atoms list dynamically — kept in module state so onEvent can map
// the list-select index back to the atom it represents.
let atoms: Atom[] = [];

export const ConfirmPage: Page = {
  id: 'confirm',

  async mount(ctx: PageContext): Promise<void> {
    const draft = getDraft();
    if (!draft) {
      // Defensive: confirm reached without a draft — drop to a stub.
      await ctx.router.go(makeStubPage('confirm-empty', 'Hmm.', "Nothing to confirm — start a new compose."));
      return;
    }

    atoms = buildAtoms(draft);
    const isEmail = draft.channel === 'email';
    const title = draft.replyContext
      ? `Reply to ${clip(draft.replyContext.from_name, 32)}`
      : isEmail
        ? 'Send this email?'
        : 'Send this?';
    await showPage(ctx.bridge, {
      texts: [
        { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: title },
        { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: `[SCRL] move  [TAP] pick  [X2] cancel` },
      ],
      lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items: atoms.map((a) => a.label) }],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const atom = atoms[event.index];
    if (!atom) return;
    const draft = getDraft();
    switch (atom.key) {
      case 'to':
        if (draft?.locked.recipient) return; // reply flow — TO is locked
        await ctx.router.push(RecipientPickerPage);
        break;
      case 'via':
        if (draft?.locked.channel) return; // reply flow — VIA is locked
        await ctx.router.push(ChannelPickerPage);
        break;
      case 'subject':
        await ctx.router.push(SubjectPromptPage);
        break;
      case 'tone':
        await ctx.router.push(TonePickerPage);
        break;
      case 'msg':
        // Re-record — push compose page; on its completion it'll set a new
        // draft and replace the current page with ConfirmPage again.
        await ctx.router.push(ComposePage);
        break;
      case 'send':
        await sendDraft(ctx);
        break;
    }
  },
};

/* --- helpers ------------------------------------------------------------- */

function buildAtoms(draft: ComposeDraft): Atom[] {
  const isEmail = draft.channel === 'email';
  const out: Atom[] = [];
  // Locked rows show 3-dot confidence and a `=` prefix instead of the label.
  // Picker is no-op when locked (see onEvent guard).
  const toConf = draft.locked.recipient ? 3 : draft.baseIntent.confidence.recipient;
  const viaConf = draft.locked.channel ? 3 : draft.baseIntent.confidence.channel;
  out.push({
    key: 'to',
    label: row(draft.locked.recipient ? '=TO' : 'TO', draft.recipient.name ?? '(pick)', toConf),
  });
  if (isEmail) {
    out.push({
      key: 'subject',
      label: row('SUBJ', draft.subject ?? '(none)', draft.subject ? 3 : 1),
    });
  }
  out.push({
    key: 'via',
    label: row(draft.locked.channel ? '=VIA' : 'VIA', channelLabel(draft.channel), viaConf),
  });
  out.push({ key: 'tone', label: row('TONE', toneLabel(draft.tone), 2) });
  out.push({
    key: 'msg',
    label: row(isEmail ? 'BODY' : 'MSG', clip(getBodyText(draft), 22), draft.baseIntent.confidence.body),
  });
  // Send row uses no dots — its readiness is reflected by whether everything
  // above resolved (TO present, channel reachable).
  const ready = isReady(draft);
  out.push({ key: 'send', label: ready ? '--  SEND  --' : '--  SEND (fix above) --' });
  return out;
}

function isReady(draft: ComposeDraft): boolean {
  if (!draft.recipient.id) return false;
  if (draft.channel === 'sms' && !draft.recipient.phone) return false;
  if (draft.channel === 'email' && !draft.recipient.email) return false;
  return true;
}

/** One atom row: `LABEL value___________________ ***` — capped at 32 chars. */
function row(label: string, value: string, confidence: 1 | 2 | 3): string {
  const dots = confidence === 3 ? '***' : confidence === 2 ? '**.' : '*..';
  const v = value.length > 22 ? value.slice(0, 21) + '~' : value;
  return `${label.padEnd(5)} ${v.padEnd(22)} ${dots}`;
}

function channelLabel(channel: ComposeDraft['channel']): string {
  switch (channel) {
    case 'sms':
      return 'SMS';
    case 'email':
      return 'Email';
    case 'both':
      return 'SMS+Email';
  }
}

function toneLabel(tone: ComposeDraft['tone']): string {
  return tone[0]!.toUpperCase() + tone.slice(1);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
