import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { log } from '../log.js';
import { wrapPcmAsWav } from './wav.js';
import { LlmError } from '../llm/provider.js';
import { getIntegrationCreds, type ApiKeyCreds } from '../integrations.js';

export interface SttResult {
  text: string;
  language?: string;
  duration_seconds?: number;
  latency_ms: number;
  /** RMS amplitude 0..1 of the submitted audio — diagnostic for silent capture. */
  rms?: number;
}

/** Raised when the captured audio is too quiet to be speech. */
export class SilentAudioError extends Error {
  constructor(public readonly rms: number, public readonly seconds: number) {
    super('the microphone captured (near) silence');
    this.name = 'SilentAudioError';
  }
}

/**
 * Below this RMS the buffer is effectively silence.
 *
 * This guard exists because whisper-1 does not fail on silence — it
 * HALLUCINATES, confidently, and very often in another language. A wearer
 * speaking English who gets Japanese back is the classic signature. Paying
 * for that call and then showing the wearer a fabricated message is strictly
 * worse than telling them the mic heard nothing.
 */
const SILENCE_RMS_FLOOR = 0.005;

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

/** Build a Whisper client from the user's OpenAI credentials (DB-first, env fallback). */
function getClient(userId: number): OpenAI {
  const creds = getIntegrationCreds(userId, 'openai') as ApiKeyCreds | null;
  if (!creds || !creds.api_key) {
    throw new LlmError('openai', 'whisper-1', 'missing_credentials', 'OpenAI credentials are not configured (needed for Whisper STT)');
  }
  return new OpenAI({ apiKey: creds.api_key });
}

/**
 * Transcribe audio via OpenAI Whisper (batch).
 *
 * The HUD sends raw 16kHz mono PCM accumulated from the G2 microphone events.
 * We WAV-wrap it server-side and submit to OpenAI's `audio.transcriptions`
 * endpoint with `whisper-1`. The OpenAI key resolves DB-first per user.
 */
export async function transcribe(userId: number, opts: SttOptions): Promise<SttResult> {
  const t0 = Date.now();

  // Measure BEFORE spending an API call. For raw PCM we can compute real
  // amplitude; for an encoded file we can't cheaply, so we skip the guard.
  const stats = opts.isRawPcm ? pcmStats(opts.audio) : null;
  if (stats) {
    log.info(
      { userId, rms: +stats.rms.toFixed(4), peak: stats.peak, seconds: +stats.seconds.toFixed(2), bytes: opts.audio.length },
      'stt: incoming audio stats',
    );
    if (stats.rms < SILENCE_RMS_FLOOR) {
      log.warn({ userId, rms: stats.rms, seconds: stats.seconds }, 'stt: refusing to transcribe silence');
      throw new SilentAudioError(stats.rms, stats.seconds);
    }
  }

  const wavBuffer = opts.isRawPcm ? wrapPcmAsWav(opts.audio) : opts.audio;
  const file = await toFile(wavBuffer, opts.isRawPcm ? 'audio.wav' : 'audio.bin');
  try {
    const resp = await getClient(userId).audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      language: opts.language,
      prompt: opts.prompt,
    });
    // verbose_json shape: { text, language, duration, segments[] }
    const r = resp as unknown as { text: string; language?: string; duration?: number };
    // Log what Whisper actually decided. When a wearer reports "it came back
    // in the wrong language", this line is the difference between guessing
    // and knowing whether detection or the audio itself was at fault.
    log.info(
      {
        userId,
        requested_language: opts.language ?? 'auto',
        detected_language: r.language,
        duration: r.duration,
        rms: stats ? +stats.rms.toFixed(4) : undefined,
        chars: r.text?.length ?? 0,
      },
      'stt: transcription complete',
    );
    return {
      text: r.text,
      language: r.language,
      duration_seconds: r.duration,
      latency_ms: Date.now() - t0,
      rms: stats?.rms,
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

/** RMS / peak / duration of a 16-bit LE mono PCM buffer. */
export function pcmStats(pcm: Buffer, sampleRate = 16000): { rms: number; peak: number; seconds: number } {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return { rms: 0, peak: 0, seconds: 0 };
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sumSquares += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return {
    rms: Math.sqrt(sumSquares / samples),
    peak: +peak.toFixed(3),
    seconds: samples / sampleRate,
  };
}
