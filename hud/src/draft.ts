import type { ComposeResult, IntentResult, VariantResult, Tone } from './api.js';
import { sanitizeForGlasses } from './text.js';
import { getPrefs } from './prefs.js';

/**
 * Compose draft — the shared, editable state between the confirm page and the
 * picker pages (recipient / channel / tone / subject).
 *
 * After /api/compose returns, the result is stored here; the confirm page
 * reads from this module on every mount. Pickers push themselves on the
 * router stack, mutate the draft, and pop back — confirm re-mounts and
 * re-renders with the new values.
 *
 * Singleton intentionally: there is only ever one in-flight compose at a
 * time, and the router's back stack handles the page transitions. Cleared
 * after a successful send (or when returning to idle).
 */

export interface DraftRecipient {
  id: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReplyContext {
  inbox_id: number;
  from_name: string;
  from_address: string;
  original_body: string;
  channel: 'sms' | 'email';
}

export interface ComposeDraft {
  transcription: string;
  baseIntent: IntentResult;
  variants: VariantResult[];
  recipient: DraftRecipient;
  channel: 'sms' | 'email' | 'both';
  tone: Tone;
  subject: string | null; // email-only
  /** When set, the user is replying — TO + VIA are locked to this context. */
  replyContext?: ReplyContext;
  /** Locked fields can't be re-picked from confirm. */
  locked: { recipient: boolean; channel: boolean };
}

let current: ComposeDraft | null = null;

/** Pre-fill applied to the NEXT setDraftFromCompose call. Used by reply flow. */
let pendingPrefill: {
  recipient: DraftRecipient;
  channel: 'sms' | 'email' | 'both';
  replyContext: ReplyContext;
  locked: { recipient: boolean; channel: boolean };
} | null = null;

/**
 * Fallback only. The real starting style is the wearer's saved
 * `default_tone` from /api/config (see prefs.ts), so a style chosen on the
 * phone dashboard or from the glasses Style menu is what a new message
 * actually starts in. Before v0.1.17 this constant WAS the policy, which is
 * why every message came out Casual no matter what the dashboard said.
 */
const FALLBACK_TONE: Tone = 'casual';

/** Stage a recipient + channel lock before pushing ComposePage (reply flow). */
export function stagePrefillForReply(prefill: NonNullable<typeof pendingPrefill>): void {
  pendingPrefill = prefill;
}

/**
 * Initialize the draft from a /api/compose response. Picks the best initial
 * tone (casual if available, otherwise the first non-erroring variant).
 */
export function setDraftFromCompose(result: ComposeResult): ComposeDraft | null {
  if ('error' in result.intent) {
    current = null;
    return null;
  }
  const intent = result.intent;
  const tone = pickInitialTone(result.variants, getPrefs().default_tone || FALLBACK_TONE);
  const channel: ComposeDraft['channel'] =
    intent.channel === 'ambiguous' ? 'sms' : intent.channel;
  current = {
    transcription: result.transcription,
    baseIntent: intent,
    variants: result.variants,
    recipient: pendingPrefill?.recipient ?? {
      id: intent.recipient_id,
      name: intent.recipient_name,
      phone: null,
      email: null,
    },
    channel: pendingPrefill?.channel ?? channel,
    tone,
    subject: intent.subject,
    replyContext: pendingPrefill?.replyContext,
    locked: pendingPrefill?.locked ?? { recipient: false, channel: false },
  };
  pendingPrefill = null; // one-shot — consumed
  return current;
}

export function getDraft(): ComposeDraft | null {
  return current;
}

export function setRecipient(r: DraftRecipient): void {
  if (!current) return;
  current.recipient = r;
  // If the new recipient only has one reachable channel, snap to it.
  if (!r.email && current.channel === 'email') current.channel = 'sms';
  if (!r.phone && current.channel === 'sms') current.channel = 'email';
}

export function setChannel(channel: ComposeDraft['channel']): void {
  if (!current) return;
  current.channel = channel;
}

export function setTone(tone: Tone): void {
  if (!current) return;
  current.tone = tone;
}

export function setSubject(subject: string | null): void {
  if (!current) return;
  current.subject = subject;
}

/**
 * Body text for the currently-selected tone (falls back to original /
 * transcription).
 *
 * The result is run through `sanitizeForGlasses` so the Confirm screen and
 * the outbound send agree byte-for-byte. Rewrites routinely come back with
 * curly apostrophes and em-dashes that the G2 font cannot draw (I-003); if
 * we sanitized only at render time the wearer would approve one string and
 * transmit a different one.
 */
export function getBodyText(d: ComposeDraft = current!): string {
  return sanitizeForGlasses(rawBodyText(d));
}

function rawBodyText(d: ComposeDraft): string {
  // Pick the active variant when it has usable text. A variant counts as
  // "empty" not just when the field is "" but also when it shrunk down to
  // whitespace — some rewrites surprise us with a stray newline only.
  const active = d.variants.find((x) => x.tone === d.tone);
  if (active && !active.error && active.text.trim().length > 0) return active.text;

  // Fall back to the original transcription variant, then the intent body,
  // then the raw transcription. Never return an empty string — the body
  // container would render as a blank box and look broken.
  const orig = d.variants.find((x) => x.tone === 'original' && x.text.trim().length > 0);
  if (orig) return orig.text;
  if (d.baseIntent.body.trim().length > 0) return d.baseIntent.body;
  if (d.transcription.trim().length > 0) return d.transcription;
  return '(no preview)';
}

/** Body text for a specific tone — used to preview a style before applying it. */
export function getBodyTextForTone(tone: Tone, d: ComposeDraft = current!): string {
  const v = d.variants.find((x) => x.tone === tone);
  if (v && !v.error && v.text.trim().length > 0) return sanitizeForGlasses(v.text);
  return getBodyText(d);
}

/** Variant for the currently-selected tone, or undefined if not cached. */
export function getCurrentVariant(d: ComposeDraft = current!): VariantResult | undefined {
  return d.variants.find((x) => x.tone === d.tone);
}

export function clearDraft(): void {
  current = null;
  pendingPrefill = null;
}

function pickInitialTone(variants: VariantResult[], preferred: Tone): Tone {
  const p = variants.find((v) => v.tone === preferred && !v.error && v.text);
  if (p) return p.tone;
  const any = variants.find((v) => !v.error && v.text);
  return any?.tone ?? 'original';
}
