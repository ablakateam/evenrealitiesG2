/**
 * Tone prompt library + intent-parse template for the VOX compose pipeline.
 *
 * Each tone produces a rewrite of the user's transcribed body, preserving
 * meaning while shifting register. All 7 fire in parallel from /api/compose
 * during the "Transcribing…" HUD state so the confirm screen shows every
 * variant pre-cached and tone cycling is instant.
 *
 * Channel awareness: SMS rewrites stay ≤160 chars; emails get optional
 * greeting/signoff. Language awareness: rewrites stay in the user's
 * spoken language (Whisper detects + we pass through explicitly).
 */
export type Tone = 'casual' | 'professional' | 'friendly' | 'formal' | 'sarcastic' | 'grammar' | 'original';
export type Channel = 'sms' | 'email';

export type RewriteTone = Exclude<Tone, 'original'>;

export const ALL_TONES: Tone[] = ['casual', 'professional', 'friendly', 'formal', 'sarcastic', 'grammar', 'original'];

/** Tones that actually call the LLM. 'original' is identity (just returns the input). */
export const REWRITE_TONES: RewriteTone[] = ['casual', 'professional', 'friendly', 'formal', 'sarcastic', 'grammar'];

const TONE_INSTRUCTIONS: Record<Exclude<Tone, 'original'>, string> = {
  casual:
    'Rewrite this message in a casual, conversational tone. Use contractions, informal phrasing, and short sentences. Keep the meaning identical. Length similar to the original. Return only the rewritten message — no quotes, no preamble.',
  professional:
    'Rewrite this message in a professional business tone. Clear, concise, polite. Avoid slang and unnecessary contractions. Keep the meaning identical. Length similar to the original. Return only the rewritten message — no quotes, no preamble.',
  friendly:
    "Rewrite this message with a warm, friendly tone. Add small natural pleasantries — but don't overdo it. Keep it sincere. Keep the meaning identical. Return only the rewritten message — no quotes, no preamble.",
  formal:
    'Rewrite this message in a formal register. Full sentences, proper salutation when context warrants, no abbreviations or contractions. Keep the meaning identical. Return only the rewritten message — no quotes, no preamble.',
  sarcastic:
    'Rewrite this message with light, witty sarcasm. Stay tasteful — playful, not mean. Maintain the underlying message. Return only the rewritten message — no quotes, no preamble.',
  grammar:
    'Correct only grammar, spelling, and punctuation. Do not change tone, register, word choice, or meaning. Return the cleaned text only — no explanation, no quotes.',
};

export interface RewritePromptOptions {
  tone: Exclude<Tone, 'original'>;
  channel: Channel;
  language?: string;
}

/**
 * Build the system prompt for a single tone rewrite call.
 * Channel + language modifiers are appended.
 */
export function buildRewriteSystemPrompt(opts: RewritePromptOptions): string {
  const parts: string[] = [TONE_INSTRUCTIONS[opts.tone]];

  if (opts.channel === 'sms') {
    parts.push('Format: SMS. Keep the output under 160 characters when possible.');
  } else {
    parts.push(
      "Format: email body. Add a brief greeting (e.g. \"Hi <name>,\") and a sign-off only when the original is long enough to warrant them; otherwise keep it tight. Don't fabricate a subject — just rewrite the body.",
    );
  }

  if (opts.language && opts.language !== 'en') {
    parts.push(`Output language: ${opts.language}. Keep the rewrite in that language; do not translate.`);
  }

  return parts.join('\n\n');
}

/**
 * System prompt for intent parsing. Takes the raw Whisper transcription and
 * the user's contacts list; returns structured JSON describing the message.
 *
 * The contacts list is interpolated as JSON for fuzzy-match grounding.
 */
export interface IntentPromptOptions {
  contacts: { id: number; name: string; phone?: string | null; email?: string | null }[];
  defaultChannel: Channel;
}

export function buildIntentSystemPrompt(opts: IntentPromptOptions): string {
  return [
    'You parse a spoken voice command into a structured message intent.',
    '',
    'Strip the meta-instruction prefix (phrases like "send a text to Alex saying …" or "email Sarah about …") and place only the actual message in `body`. Do NOT include the meta-prefix in the body.',
    '',
    'Output STRICT JSON with these keys:',
    '  channel        — "sms" | "email" | "both" | "ambiguous"',
    '  recipient_id   — numeric contact id, or null if no clear match',
    '  recipient_name — the recipient name as the user spoke it (helps with fallback resolution)',
    '  body           — the actual message content with the meta-prefix removed',
    '  subject        — short subject line (email only); null otherwise; null if not stated',
    '  language       — ISO-639-1 of the body language',
    '  confidence     — { recipient: 1|2|3, channel: 1|2|3, body: 1|2|3 } (3=sure, 2=likely, 1=guess)',
    '  candidates     — array of contact ids when the recipient is ambiguous; empty if recipient_id is set',
    '',
    'Rules:',
    `- If channel is not explicitly stated, default to "${opts.defaultChannel}" and set channel confidence to 1.`,
    '- Match the spoken name against the contacts list (case-insensitive, fuzzy on first names).',
    '- If the user said "text" → channel:"sms". If they said "email" → channel:"email". If they said "send to both" → "both".',
    '- Return STRICT JSON, no markdown, no commentary.',
    '',
    'Contacts:',
    JSON.stringify(opts.contacts, null, 0),
  ].join('\n');
}

/**
 * System prompt for an email-only subject auto-suggestion.
 * Used by the HUD subject-prompt page when intent.subject is null.
 */
export function buildSubjectSystemPrompt(): string {
  return [
    'You suggest a brief subject line (3–6 words) for an email body.',
    'Return only the subject line text — no quotes, no markdown, no commentary.',
    'Match the tone of the body. If the body is casual, the subject is casual too.',
  ].join('\n');
}
