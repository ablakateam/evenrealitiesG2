import type { ComposeResult, IntentResult, VariantResult, Tone } from './api.js';

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

export interface ComposeDraft {
  transcription: string;
  baseIntent: IntentResult;
  variants: VariantResult[];
  recipient: DraftRecipient;
  channel: 'sms' | 'email' | 'both';
  tone: Tone;
  subject: string | null; // email-only
}

let current: ComposeDraft | null = null;

const DEFAULT_TONE: Tone = 'casual';

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
  const tone = pickInitialTone(result.variants, DEFAULT_TONE);
  const channel: ComposeDraft['channel'] =
    intent.channel === 'ambiguous' ? 'sms' : intent.channel;
  current = {
    transcription: result.transcription,
    baseIntent: intent,
    variants: result.variants,
    recipient: {
      id: intent.recipient_id,
      name: intent.recipient_name,
      phone: null,
      email: null,
    },
    channel,
    tone,
    subject: intent.subject,
  };
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

/** Body text for the currently-selected tone (falls back to original / transcription). */
export function getBodyText(d: ComposeDraft = current!): string {
  const v = d.variants.find((x) => x.tone === d.tone && !x.error && x.text);
  if (v) return v.text;
  const orig = d.variants.find((x) => x.tone === 'original' && x.text);
  if (orig) return orig.text;
  return d.baseIntent.body || d.transcription;
}

/** Variant for the currently-selected tone, or undefined if not cached. */
export function getCurrentVariant(d: ComposeDraft = current!): VariantResult | undefined {
  return d.variants.find((x) => x.tone === d.tone);
}

export function clearDraft(): void {
  current = null;
}

function pickInitialTone(variants: VariantResult[], preferred: Tone): Tone {
  const p = variants.find((v) => v.tone === preferred && !v.error && v.text);
  if (p) return p.tone;
  const any = variants.find((v) => !v.error && v.text);
  return any?.tone ?? 'original';
}
