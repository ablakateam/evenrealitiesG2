import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { updateText } from './render.js';

/**
 * Bold breathing pulse — the animated centerpiece on Idle.
 *
 * Solid filled diamond that swells and contracts in a 6-frame loop
 * (3 growing, 3 shrinking) so the wearer sees "VOX is ready, listening"
 * at a glance. 5 lines tall, ~21 chars at peak — fills the upper third
 * of the screen with real visual weight. Uses ASCII '*' (printable on
 * every G2 font build we've seen) rather than unicode blocks which
 * occasionally fail to render in the simulator font.
 *
 * The trick to a flicker-free breath is keeping every frame the same
 * number of lines: each frame is 5 lines tall, padded with spaces, so
 * `textContainerUpgrade` swaps content in place without re-flowing the
 * container.
 */

const FRAME_MS = 500;
const CHAR_WIDTH = 100;

function centerLine(s: string): string {
  const pad = Math.max(0, Math.floor((CHAR_WIDTH - s.length) / 2));
  return ' '.repeat(pad) + s;
}

/** Build one 5-line frame with a diamond of the given peak width. */
function diamondFrame(peak: number): string {
  // peak must be odd so the diamond is symmetric (1, 3, 5, 7, 9, 11, ...).
  // 5-line shape: widths peak-4, peak-2, peak, peak-2, peak-4 (floor at 1).
  const rows: number[] = [peak - 4, peak - 2, peak, peak - 2, peak - 4];
  const lines = rows.map((w) => centerLine('*'.repeat(Math.max(1, w))));
  return lines.join('\n');
}

const FRAMES: string[] = [
  diamondFrame(5),  // small  — widths 1, 3, 5, 3, 1
  diamondFrame(7),  // medium — widths 3, 5, 7, 5, 3
  diamondFrame(9),  // large  — widths 5, 7, 9, 7, 5
  diamondFrame(11), // peak   — widths 7, 9, 11, 9, 7
  diamondFrame(9),  // shrink back
  diamondFrame(7),
];

export class Pulse {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly containerId: number,
  ) {}

  static initialFrame(): string {
    return FRAMES[0]!;
  }

  start(): void {
    if (this.timer) return;
    this.frameIndex = 0;
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      void updateText(this.bridge, this.containerId, FRAMES[this.frameIndex]!);
    }, FRAME_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
