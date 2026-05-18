import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { updateText } from './render.js';

/**
 * A calm breathing pulse — the animated centerpiece on Idle.
 *
 * We swap a single text container's content between five frames at ~600ms
 * each, so one full cycle is ~3 s. Pure ASCII so it renders identically on
 * the simulator and on real G2 hardware (the G2 font's support for
 * Unicode bullet glyphs is uncertain — see L:38 in LESSONSLEARNED).
 *
 * Designed to feel like a slow breath, not a heartbeat — VOX should read
 * calm and patient on the wrist, not anxious. The animation never moves
 * laterally (no jitter to draw the eye), only widens and contracts.
 *
 * Future work: replace with an ImageContainerProperty-backed bitmap when
 * we design a real mascot. The animator's lifecycle (`start` / `stop`) is
 * stable so the swap will be one-file.
 */

const FRAME_MS = 600;

// Each frame is centered within a ~56-char-wide container (measured on
// sim — G2 font renders at ~9.7px/char, so 576px container with padding
// holds ~56 chars). Computed once at module load so we don't pay an
// arithmetic cost per swap.
const CHAR_WIDTH = 100;
function centerOne(s: string): string {
  const pad = Math.max(0, Math.floor((CHAR_WIDTH - s.length) / 2));
  return ' '.repeat(pad) + s;
}

const FRAMES: string[] = [
  '\n\n' + centerOne('.'),
  '\n\n' + centerOne('( )'),
  '\n\n' + centerOne('(   )'),
  '\n\n' + centerOne('( )'),
  '\n\n' + centerOne('.'),
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
