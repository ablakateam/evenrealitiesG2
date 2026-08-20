import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { updateText } from './render.js';

/**
 * The Idle signal — VOX's "I'm awake and listening" mark.
 *
 * Concentric rings breathing outward from a single point: a voice leaving a
 * source. It reads as sound radiating rather than as decoration, which is
 * the whole point — the previous version was a diamond of asterisks that
 * looked like drifting stars and said nothing about what VOX does.
 *
 *        ·  ( ( ( ● ) ) )  ·
 *
 * Constraints it has to live inside:
 *   - ONE line. Idle's body belongs to the action menu; the signal gets
 *     ~30 px and no more.
 *   - Every frame is the same character length and the ring stays centred on
 *     the dot, so `textContainerUpgrade` swaps content without the mark
 *     appearing to slide sideways.
 *   - Glyphs restricted to the verified-safe set: ASCII plus `●` and `·`,
 *     both confirmed rendering on the G2 font (`·` is already used in every
 *     chrome footer).
 */

const FRAME_MS = 420;
const CHAR_WIDTH = 100;

/** Ring pairs at each radius, innermost first. */
const RINGS = ['(', '(', '('];
const CORE = '●';

function centerLine(s: string): string {
  const pad = Math.max(0, Math.floor((CHAR_WIDTH - s.length) / 2));
  return ' '.repeat(pad) + s;
}

/**
 * Build one frame with `depth` rings drawn around the core.
 *
 * Undrawn rings are emitted as spaces rather than omitted, so every frame is
 * exactly the same width and the core never shifts.
 */
function ringFrame(depth: number): string {
  const left = RINGS.map((c, i) => (i >= RINGS.length - depth ? c : ' ')).join(' ');
  // Right-hand slots already run near -> far, so they must NOT be reversed:
  // doing so pinned the closing paren to the far edge and the rings came out
  // lopsided instead of concentric.
  const right = RINGS.map((_, i) => (i < depth ? ')' : ' ')).join(' ');
  return centerLine(`${left} ${CORE} ${right}`);
}

/** Breathe out to three rings, then back in. */
const FRAMES: string[] = [ringFrame(0), ringFrame(1), ringFrame(2), ringFrame(3), ringFrame(2), ringFrame(1)];

/** Height (px) the signal needs. One rendered line plus breathing room. */
export const SIGNAL_HEIGHT = 30;

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
    // Idempotent: a second start() without stop() would leave the first
    // interval running forever, writing to the same container at a different
    // phase (the Idle foreground-enter re-mount used to do exactly that).
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
