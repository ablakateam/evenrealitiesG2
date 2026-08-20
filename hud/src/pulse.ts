import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { updateText } from './render.js';

/**
 * Breathing pulse — the "VOX is awake" signal on Idle.
 *
 * Solid filled diamond that swells and contracts in a 6-frame loop (3
 * growing, 3 shrinking). Uses ASCII '*' (printable on every G2 font build
 * we've seen) rather than unicode blocks, which occasionally fail to render.
 *
 * The trick to a flicker-free breath is keeping every frame the SAME number
 * of lines: each frame is padded to a fixed line count, so
 * `textContainerUpgrade` swaps content in place without re-flowing the
 * container.
 *
 * Two sizes:
 *   - 'full'    5 lines — the standalone centerpiece (unused since Idle
 *               became a menu, kept because it is the nicer visual and the
 *               Sent screen may want it back).
 *   - 'compact' 3 lines — sits above the Idle action menu. Idle's job is now
 *               to get the wearer to a feature in one tap, so the menu owns
 *               the vertical budget and the pulse keeps just enough presence
 *               to read as "alive".
 */

const FRAME_MS = 500;
const CHAR_WIDTH = 100;

export type PulseSize = 'full' | 'compact';

/**
 * Rendered height (px) each size needs.
 *
 * The G2 draws a text line at roughly 26 px, so a container must be at least
 * lines * 26 or the trailing lines are clipped rather than scrolled. The
 * compact pulse is deliberately ONE line: on the Idle hub the menu is the
 * point, and a single breathing bar carries the "VOX is awake" signal
 * without taking a row away from the list.
 */
export const PULSE_HEIGHT: Record<PulseSize, number> = { full: 160, compact: 30 };

function centerLine(s: string): string {
  const pad = Math.max(0, Math.floor((CHAR_WIDTH - s.length) / 2));
  return ' '.repeat(pad) + s;
}

/** Build one frame with a diamond of the given peak width. */
function diamondFrame(peak: number, size: PulseSize): string {
  // peak must be odd so the diamond is symmetric (1, 3, 5, 7, 9, 11, ...).
  const rows: number[] =
    size === 'full' ? [peak - 4, peak - 2, peak, peak - 2, peak - 4] : [peak];
  const lines = rows.map((w) => centerLine('*'.repeat(Math.max(1, w))));
  return lines.join('\n');
}

const PEAKS = [5, 7, 9, 11, 9, 7];

const FRAMES: Record<PulseSize, string[]> = {
  full: PEAKS.map((p) => diamondFrame(p, 'full')),
  compact: PEAKS.map((p) => diamondFrame(p, 'compact')),
};

export class Pulse {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly containerId: number,
    private readonly size: PulseSize = 'compact',
  ) {}

  static initialFrame(size: PulseSize = 'compact'): string {
    return FRAMES[size][0]!;
  }

  start(): void {
    // Idempotent: a second start() without stop() would otherwise leave the
    // first interval running forever, writing to the same container at a
    // different phase (the Idle foreground-enter re-mount used to do exactly
    // this and the diamond visibly stuttered).
    if (this.timer) return;
    this.frameIndex = 0;
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES[this.size].length;
      void updateText(this.bridge, this.containerId, FRAMES[this.size][this.frameIndex]!);
    }, FRAME_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
