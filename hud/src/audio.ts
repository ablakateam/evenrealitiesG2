/**
 * Microphone capture buffer + live level meter.
 *
 * The G2 mic streams PCM 16 kHz mono signed-16-bit-LE via `audioEvent.audioPcm`
 * (Uint8Array chunks). We accumulate the chunks for the eventual POST to
 * /api/compose, and compute a per-chunk RMS amplitude that the compose page
 * renders as a block-character meter so the wearer sees the mic is live.
 */

const METER_SLOTS = 16;
const BLOCKS = ' ▁▂▃▄▅▆▇█'; // index 0..8

export class AudioRecorder {
  private chunks: Uint8Array[] = [];
  private levels: number[] = []; // rolling 0..8 amplitude levels
  private startedAt = 0;
  private lastVoiceAt = 0;

  /** Begin a fresh recording. */
  start(): void {
    this.chunks = [];
    this.levels = [];
    this.startedAt = Date.now();
    this.lastVoiceAt = Date.now();
  }

  /** Feed one PCM chunk from an audioEvent. */
  addChunk(pcm: Uint8Array): void {
    this.chunks.push(pcm);
    const level = rmsLevel(pcm);
    this.levels.push(level);
    if (this.levels.length > METER_SLOTS) this.levels.shift();
    if (level > 1) this.lastVoiceAt = Date.now();
  }

  /** Seconds since recording started. */
  get elapsedSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  /** Seconds since the last above-noise-floor chunk (for silence auto-stop). */
  get silenceSeconds(): number {
    return (Date.now() - this.lastVoiceAt) / 1000;
  }

  /** No audio captured at all (headless simulator, or mic permission denied). */
  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  get byteLength(): number {
    return this.chunks.reduce((n, c) => n + c.byteLength, 0);
  }

  /** Render the rolling amplitude as a block-char meter, right-aligned. */
  meter(): string {
    // When no audio frames have arrived yet (sim with no mic, or the first
    // 100ms on real hardware) show a flat baseline so the screen reads as
    // "ready and listening" — the BLOCKS levels grow upward from this floor
    // once audio arrives. The G2 font renders ASCII dashes reliably; the
    // block-glyph baseline (▁) didn't on the sim build we tested.
    if (this.levels.length === 0) {
      return '-'.repeat(METER_SLOTS);
    }
    const bars = this.levels.map((l) => BLOCKS[Math.max(0, Math.min(8, l))] ?? ' ').join('');
    return bars.padStart(METER_SLOTS, ' ');
  }

  /** Concatenate every chunk into one PCM buffer for upload. */
  toBuffer(): Uint8Array {
    const out = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
}

/** RMS amplitude of a 16-bit-LE PCM chunk, mapped to a 0..8 meter level. */
function rmsLevel(pcm: Uint8Array): number {
  const n = Math.floor(pcm.byteLength / 2);
  if (n === 0) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / n);
  // Speech RMS is typically ~0.03–0.3; scale so normal speech lands mid-meter.
  return Math.round(Math.min(8, rms * 28));
}

/** mm:ss for the recording timer. */
export function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
