import { getDb } from './db.js';
import { transcribe } from './audio/stt.js';
import { createProvider } from './llm/factory.js';
import { LlmError, type ProviderName } from './llm/provider.js';
import {
  ALL_TONES,
  REWRITE_TONES,
  buildIntentSystemPrompt,
  buildRewriteSystemPrompt,
  type Channel,
  type Tone,
} from './prompts.js';
import { log } from './log.js';

export interface IntentResult {
  channel: 'sms' | 'email' | 'both' | 'ambiguous';
  recipient_id: number | null;
  recipient_name: string | null;
  body: string;
  subject: string | null;
  language: string;
  confidence: { recipient: 1 | 2 | 3; channel: 1 | 2 | 3; body: 1 | 2 | 3 };
  candidates: number[];
}

export interface VariantResult {
  tone: Tone;
  text: string;
  latency_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
}

export interface ComposeResult {
  transcription: string;
  stt_latency_ms: number;
  language?: string;
  intent: IntentResult | { error: string };
  variants: VariantResult[];
  total_latency_ms: number;
}

interface UserPreferences {
  default_channel: 'sms' | 'email' | 'smart';
  rewrite_provider: ProviderName;
  rewrite_model: string;
  voice_language: string;
}

interface ContactRow {
  id: number;
  name: string;
  phone_e164: string | null;
  email: string | null;
}

function loadPrefs(userId: number): UserPreferences {
  const db = getDb();
  const row = db.prepare('SELECT default_channel, rewrite_provider, rewrite_model, voice_language FROM preferences WHERE user_id = ?').get(userId) as UserPreferences | undefined;
  if (!row) throw new Error(`preferences row missing for user_id=${userId}`);
  return row;
}

function loadContacts(userId: number): ContactRow[] {
  const db = getDb();
  return db
    .prepare('SELECT id, name, phone_e164, email FROM contacts WHERE user_id = ? ORDER BY name COLLATE NOCASE LIMIT 500')
    .all(userId) as ContactRow[];
}

function parseIntentJson(raw: string): IntentResult {
  // Strip code-fences if the model wraps JSON in markdown
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return {
    channel: parsed.channel ?? 'ambiguous',
    recipient_id: typeof parsed.recipient_id === 'number' ? parsed.recipient_id : null,
    recipient_name: typeof parsed.recipient_name === 'string' ? parsed.recipient_name : null,
    body: typeof parsed.body === 'string' ? parsed.body : '',
    subject: typeof parsed.subject === 'string' ? parsed.subject : null,
    language: typeof parsed.language === 'string' ? parsed.language : 'en',
    confidence: {
      recipient: (parsed.confidence?.recipient as 1 | 2 | 3) ?? 1,
      channel: (parsed.confidence?.channel as 1 | 2 | 3) ?? 1,
      body: (parsed.confidence?.body as 1 | 2 | 3) ?? 1,
    },
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
  };
}

export interface ComposeOptions {
  userId: number;
  /** Either raw PCM (isRawPcm=true) or a finished transcription string (skipStt=true). */
  audio?: Buffer;
  isRawPcm?: boolean;
  /** Skip STT and use this transcription directly. Used by /api/parse and tests. */
  transcriptionOverride?: string;
  /** Override the user's saved preferences for one call (used in dashboard test). */
  providerOverride?: ProviderName;
  modelOverride?: string;
  /** Force-include a specific channel context for rewrites; defaults to intent.channel. */
  channelOverride?: Channel;
}

/**
 * The compose pipeline.
 *
 *   audio → Whisper STT  →  ┌── intent parse           ┐
 *                           ├── rewrite Casual         │
 *                           ├── rewrite Professional   │
 *                           ├── rewrite Friendly       │  Promise.all
 *                           ├── rewrite Formal         │  (single batch)
 *                           ├── rewrite Sarcastic     │
 *                           └── rewrite Grammar-fix    ┘
 *                                                              ↓
 *                                       { transcription, intent, variants[7] }
 *
 * All seven variants land in the response so the HUD's tone picker shows
 * every option pre-cached.
 */
export async function compose(opts: ComposeOptions): Promise<ComposeResult> {
  const t0 = Date.now();
  const prefs = loadPrefs(opts.userId);
  const contacts = loadContacts(opts.userId);

  // 1. STT
  let transcription: string;
  let sttLatency = 0;
  let language: string | undefined;
  if (opts.transcriptionOverride !== undefined) {
    transcription = opts.transcriptionOverride;
  } else {
    if (!opts.audio) throw new Error('audio buffer required when transcriptionOverride is not set');
    const sttRes = await transcribe(opts.userId, {
      audio: opts.audio,
      isRawPcm: opts.isRawPcm ?? true,
      language: prefs.voice_language === 'auto' ? undefined : prefs.voice_language,
      prompt: contacts.map((c) => c.name).join(', '), // bias Whisper toward known names
    });
    transcription = sttRes.text;
    sttLatency = sttRes.latency_ms;
    language = sttRes.language;
  }

  if (!transcription.trim()) {
    return {
      transcription: '',
      stt_latency_ms: sttLatency,
      language,
      intent: { error: 'empty_transcription' },
      variants: [],
      total_latency_ms: Date.now() - t0,
    };
  }

  // 2. Determine provider + model
  const provider = createProvider((opts.providerOverride ?? prefs.rewrite_provider) as ProviderName, opts.userId);
  const model = opts.modelOverride ?? prefs.rewrite_model;

  // 3. Decide the channel context for rewrites. Need a synchronous best-guess
  //    before intent finishes. Use the user's default; intent parse will
  //    inform the HUD's final routing.
  const defaultChannel: Channel =
    opts.channelOverride ??
    (prefs.default_channel === 'email' ? 'email' : 'sms');

  // 4. Parallel intent + 6 rewrites + identity 'original'
  const intentPromise = provider
    .complete({
      systemPrompt: buildIntentSystemPrompt({ contacts, defaultChannel: prefs.default_channel === 'email' ? 'email' : 'sms' }),
      userMessage: transcription,
      model,
      maxTokens: 600,
      temperature: 0.1,
      cacheSystemPrompt: false, // contacts list changes; not worth caching
    })
    .then((r) => parseIntentJson(r.text))
    .catch((err: unknown) => {
      log.warn({ err }, 'intent parse failed');
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg } as const;
    });

  const variantPromises: Promise<VariantResult>[] = REWRITE_TONES.map(async (tone) => {
    const tStart = Date.now();
    try {
      const r = await provider.complete({
        systemPrompt: buildRewriteSystemPrompt({ tone, channel: defaultChannel, language }),
        userMessage: transcription,
        model,
        maxTokens: 400,
        temperature: tone === 'grammar' ? 0.1 : 0.7,
        cacheSystemPrompt: true, // identical across calls within a session
      });
      return {
        tone,
        text: r.text.trim(),
        latency_ms: r.latency_ms,
        tokens_in: r.tokens_in,
        tokens_out: r.tokens_out,
      };
    } catch (err) {
      const message =
        err instanceof LlmError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      log.warn({ err, tone }, 'rewrite variant failed');
      return {
        tone,
        text: '',
        latency_ms: Date.now() - tStart,
        error: message,
      };
    }
  });

  const [intent, ...variants] = await Promise.all([intentPromise, ...variantPromises]);

  // 5. Append 'original' identity variant so the HUD picker has all 7 entries
  variants.push({ tone: 'original', text: transcription.trim(), latency_ms: 0 });
  // sort so the variants come back in a stable order matching ALL_TONES
  const ordered = ALL_TONES.map((t) => variants.find((v) => v.tone === t)).filter(
    (v): v is VariantResult => Boolean(v),
  );

  return {
    transcription,
    stt_latency_ms: sttLatency,
    language,
    intent,
    variants: ordered,
    total_latency_ms: Date.now() - t0,
  };
}
