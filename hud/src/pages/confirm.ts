import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import type { ComposeResult, IntentResult, VariantResult, Tone } from '../api.js';
import { makeStubPage } from './stub.js';

/**
 * Confirm page — the parsed-intent review screen.
 *
 * Renders the /api/compose result as a list of atom rows the wearer scans +
 * fixes before sending: TO / VIA / TONE / MSG (plus SUBJECT for email). Each
 * row carries a confidence dot (●●● sure / ●●○ likely / ●○○ guess) so the
 * eye lands on the uncertain bits first. A final "SEND" row sits at the
 * bottom of the list.
 *
 * The native list container IS the cursor — firmware highlights the selected
 * row, `list-select` tells us which atom was tapped. P13 routes taps to stub
 * sub-flows; P14 wires the real recipient/tone pickers + the send.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

const DEFAULT_TONE: Tone = 'casual';

interface Atom {
  key: 'to' | 'via' | 'subject' | 'tone' | 'msg' | 'send';
  label: string;
}

export function makeConfirmPage(result: ComposeResult): Page {
  // Guard: intent parse can fail — show a clean error rather than crash.
  if ('error' in result.intent) {
    return makeStubPage(
      'confirm-error',
      'Hmm.',
      `Couldn't read that as a message.\n  "${result.transcription.slice(0, 80)}"`,
    );
  }

  const intent = result.intent;
  const isEmail = intent.channel === 'email';
  const tone = pickTone(result.variants, DEFAULT_TONE);
  const bodyText = tone.text || intent.body;

  // Build the atom rows in display order.
  const atoms: Atom[] = [];
  atoms.push({ key: 'to', label: row('TO', intent.recipient_name ?? '(pick recipient)', intent.confidence.recipient) });
  if (isEmail) {
    atoms.push({ key: 'subject', label: row('SUBJ', intent.subject ?? '(none)', intent.subject ? 3 : 1) });
  }
  atoms.push({ key: 'via', label: row('VIA', channelLabel(intent.channel), intent.confidence.channel) });
  atoms.push({ key: 'tone', label: row('TONE', toneLabel(tone.tone), 2) });
  atoms.push({ key: 'msg', label: row(isEmail ? 'BODY' : 'MSG', clip(bodyText, 38), intent.confidence.body) });
  atoms.push({ key: 'send', label: '--  SEND  --' });

  return {
    id: 'confirm',

    async mount(ctx: PageContext): Promise<void> {
      await showPage(ctx.bridge, {
        texts: [
          {
            id: TITLE_ID,
            x: 0,
            y: 0,
            w: 576,
            h: 44,
            capture: false,
            content: isEmail ? 'Send this email?' : 'Send this?',
          },
          {
            id: FOOTER_ID,
            x: 0,
            y: 236,
            w: 576,
            h: 48,
            capture: false,
            content: `lang ${intent.language}   ·   [SCRL] move   [TAP] pick   [X2] cancel`,
          },
        ],
        lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items: atoms.map((a) => a.label) }],
      });
    },

    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      if (event.kind !== 'list-select') return;
      const atom = atoms[event.index];
      if (!atom) return;
      // P14 wires the real recipient picker, channel toggle, tone picker, and
      // the actual send. For P13 each lands on an honest stub.
      switch (atom.key) {
        case 'send':
          await ctx.router.push(makeStubPage('send', 'SEND', 'Sending ships in P14 (tone picker + send).'));
          break;
        case 'to':
          await ctx.router.push(makeStubPage('pick-to', 'TO', 'Recipient picker ships in P14.'));
          break;
        case 'via':
          await ctx.router.push(makeStubPage('pick-via', 'VIA', 'Channel toggle ships in P14.'));
          break;
        case 'subject':
          await ctx.router.push(makeStubPage('pick-subject', 'SUBJECT', 'Subject prompt ships in P14.'));
          break;
        case 'tone':
          await ctx.router.push(makeStubPage('pick-tone', 'TONE', 'Tone picker ships in P14.'));
          break;
        case 'msg':
          await ctx.router.push(makeStubPage('redo-msg', 'MSG', 'Re-record ships in P14.'));
          break;
      }
    },
  };
}

/* --- helpers ------------------------------------------------------------- */

function pickTone(variants: VariantResult[], preferred: Tone): VariantResult {
  return (
    variants.find((v) => v.tone === preferred && !v.error && v.text) ??
    variants.find((v) => v.tone === 'original' && v.text) ??
    variants.find((v) => v.text) ??
    { tone: 'original', text: '', latency_ms: 0 }
  );
}

/** One atom row: `LABEL  value  ***` (label padded, dots inline, short). */
function row(label: string, value: string, confidence: 1 | 2 | 3): string {
  // Keep rows ≤32 chars — longer rows seem to make the firmware reject the
  // list rebuild silently. ASCII-only for the same reason.
  const dots = confidence === 3 ? '***' : confidence === 2 ? '**.' : '*..';
  const v = value.length > 22 ? value.slice(0, 21) + '~' : value;
  return `${label.padEnd(5)} ${v.padEnd(22)} ${dots}`;
}

function channelLabel(channel: IntentResult['channel']): string {
  switch (channel) {
    case 'sms':
      return 'SMS';
    case 'email':
      return 'Email';
    case 'both':
      return 'SMS + Email';
    default:
      return '(ambiguous — pick)';
  }
}

function toneLabel(tone: Tone): string {
  return tone[0]!.toUpperCase() + tone.slice(1);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
