import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { env } from '../env.js';
import { wrapPcmAsWav } from './wav.js';
import { LlmError } from '../llm/provider.js';

export interface SttResult {
  text: string;
  language?: string;
  duration_seconds?: number;
  latency_ms: number;
}

export interface SttOptions {
  /** Raw audio: either PCM 16kHz mono (will be WAV-wrapped) or an already-encoded file. */
  audio: Buffer;
  /** Set to true if `audio` is raw 16kHz mono 16-bit LE PCM (default for HUD streams). */
  isRawPcm: boolean;
  /** Optional ISO-639-1 hint to bias Whisper toward a specific language. */
  language?: string;
  /** Optional prompt to bias domain vocabulary (e.g. contact names). */
  prompt?: string;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  if (!env.OPENAI_KEY) {
    throw new LlmError('openai', 'whisper-1', 'missing_credentials', 'OPENAI_KEY env var is not set');
  }
  client = new OpenAI({ apiKey: env.OPENAI_KEY });
  return client;
}

/**
 * Transcribe audio via OpenAI Whisper (batch).
 *
 * The HUD sends raw 16kHz mono PCM accumulated from the G2 microphone events.
 * We WAV-wrap it server-side and submit to OpenAI's `audio.transcriptions`
 * endpoint with `whisper-1`.
 */
export async function transcribe(opts: SttOptions): Promise<SttResult> {
  const t0 = Date.now();
  const wavBuffer = opts.isRawPcm ? wrapPcmAsWav(opts.audio) : opts.audio;
  const file = await toFile(wavBuffer, opts.isRawPcm ? 'audio.wav' : 'audio.bin');
  try {
    const resp = await getClient().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      language: opts.language,
      prompt: opts.prompt,
    });
    // verbose_json shape: { text, language, duration, segments[] }
    const r = resp as unknown as { text: string; language?: string; duration?: number };
    return {
      text: r.text,
      language: r.language,
      duration_seconds: r.duration,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new LlmError(
        'openai',
        'whisper-1',
        err.status === 401 ? 'unauthorized' : err.status === 429 ? 'rate_limited' : 'stt_api_error',
        err.message,
        err.status,
      );
    }
    if (err instanceof Error) throw new LlmError('openai', 'whisper-1', 'unknown', err.message);
    throw new LlmError('openai', 'whisper-1', 'unknown', String(err));
  }
}
