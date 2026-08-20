/**
 * Microphone capture buffer + live level meter.
 *
 * The G2 mic streams PCM 16 kHz mono signed-16-bit-LE via `audioEvent.audioPcm`
 * (Uint8Array chunks). We accumulate the chunks for the eventual POST to
 * /api/compose, and compute a per-chunk RMS amplitude that the compose page
 * renders as a block-character meter so the wearer sees the mic is live.
 */

/**
 * Live voice trace — a thin oscilloscope, not a bar chart.
 *
 * The old meter drew 16 slots of `▁▂▃▄▅▆▇█`. Full-height block glyphs on a
 * green 576x288 display read as a chunky bar chart — "Minecraft", in the
 * words of the hardware test — rather than as a voice.
 *
 * A single line cannot fix that on its own: the ink-height difference
 * between `_` and `^` is a few pixels on a 26 px line, so a one-row ramp
 * still reads as a dashed rule. So the trace is plotted across SEVERAL rows
 * instead, one lightweight mark per column at the height matching that
 * moment's amplitude. Real vertical travel, but the ink is still just a
 * dash — thin and fluid, nothing like a block.
 *
 *          -  --
 *      --    -  -   --
 *    --  ....  -  --
 *   .          --
 */
const METER_SLOTS = 28;

/** Rows the trace is drawn across. More rows = more visible amplitude. */
export const TRACE_ROWS = 4;

/** The mark plotted at each column's amplitude height. */
const MARK = '-';
/** Drawn on the centre line where a column has no signal, so the trace never breaks. */
const REST = '.';

/**
 * Exponential smoothing applied to each new level.
 *
 * Raw per-chunk RMS is jumpy enough that the trace strobes between extremes.
 * Easing toward the new value makes it flow like a waveform instead of
 * flickering like a VU meter.
 */
const SMOOTHING = 0.45;

export class AudioRecorder {
  private chunks: Uint8Array[] = [];
  private levels: number[] = []; // rolling 0..8 amplitude levels (smoothed)
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
    const raw = rmsLevel(pcm);
    const prev = this.levels.length > 0 ? this.levels[this.levels.length - 1]! : 0;
    const level = prev + (raw - prev) * SMOOTHING;
    this.levels.push(level);
    if (this.levels.length > METER_SLOTS) this.levels.shift();
    if (raw > 1) this.lastVoiceAt = Date.now();
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

  /**
   * Render the rolling amplitude as a multi-row oscilloscope trace.
   *
   * Always exactly TRACE_ROWS lines of METER_SLOTS characters, left-padded
   * with rest, so the block never changes shape mid-recording — a size
   * change would make the whole figure jump on each in-place update.
   */
  meter(): string {
    const levels = [...this.levels];
    // Pad on the LEFT so the newest sample sits at the right edge and the
    // trace appears to flow forward as you speak.
    while (levels.length < METER_SLOTS) levels.unshift(0);

    // Row 0 is the top of the trace, row TRACE_ROWS-1 the bottom.
    const grid: string[][] = Array.from({ length: TRACE_ROWS }, () =>
      Array.from({ length: METER_SLOTS }, () => ' '),
    );

    levels.forEach((level, col) => {
      const clamped = Math.max(0, Math.min(8, level));
      if (clamped < 0.35) {
        // No real signal: hold the centre line so the trace stays continuous
        // instead of dropping out into blank space.
        grid[TRACE_ROWS - 1]![col] = REST;
        return;
      }
      // Louder -> higher up the grid.
      const row = TRACE_ROWS - 1 - Math.round((clamped / 8) * (TRACE_ROWS - 1));
      grid[Math.max(0, Math.min(TRACE_ROWS - 1, row))]![col] = MARK;
    });

    return grid.map((row) => row.join('')).join('\n');
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

/** RMS amplitude of a 16-bit-LE PCM chunk, mapped to a 0..8 meter level (fractional). */
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
  // Perceptual, not linear. Speech RMS runs ~0.03–0.3, so the old `rms * 28`
  // mapping parked ordinary talking on level 1 and the trace sat flat on the
  // baseline looking like a dotted rule. A square-root curve spreads that
  // same range across the meter: 0.03 -> ~2, 0.1 -> ~4, 0.3 -> ~8.
  return Math.min(8, Math.sqrt(rms) * 14);
}

/** mm:ss for the recording timer. */
export function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
