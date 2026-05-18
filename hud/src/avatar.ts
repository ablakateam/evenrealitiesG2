import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { updateText } from './render.js';

/**
 * The fox — VOX's mascot, rendered as ASCII art in a single text container.
 *
 * Animation works by swapping the container's content via textContainerUpgrade
 * (flicker-free in-place patch). We keep frames intentionally minimal: a
 * 250ms blink every ~4 seconds. Anything faster than that wastes BLE
 * bandwidth and makes the G2 feel busy.
 *
 * The G2 font supports ASCII and a subset of box-drawing — we stick to plain
 * ASCII so the face renders identically on simulator and hardware. Future
 * emotions (listening, thinking, sent, error) can swap frame sets via
 * `setMood()` without changing the animator's lifecycle.
 */

export type FoxMood = 'calm' | 'listening' | 'thinking' | 'happy' | 'oops';

const FRAMES: Record<FoxMood, { open: string; blink: string }> = {
  calm: {
    open:  '\n   /\\___/\\\n  ( o   o )\n   \\  v  /\n    -----',
    blink: '\n   /\\___/\\\n  ( -   - )\n   \\  v  /\n    -----',
  },
  listening: {
    open:  '\n   /\\___/\\\n  ( O   O )\n   \\  o  /\n    -----',
    blink: '\n   /\\___/\\\n  ( O   O )\n   \\  o  /\n    -----',
  },
  thinking: {
    open:  '\n   /\\___/\\\n  ( -   - )\n   \\  ~  /\n    -----',
    blink: '\n   /\\___/\\\n  ( -   - )\n   \\  ~  /\n    -----',
  },
  happy: {
    open:  '\n   /\\___/\\\n  ( ^   ^ )\n   \\  v  /\n    -----',
    blink: '\n   /\\___/\\\n  ( ^   ^ )\n   \\  v  /\n    -----',
  },
  oops: {
    open:  '\n   /\\___/\\\n  ( x   x )\n   \\  o  /\n    -----',
    blink: '\n   /\\___/\\\n  ( x   x )\n   \\  o  /\n    -----',
  },
};

const BLINK_INTERVAL_MS = 4500;
const BLINK_HOLD_MS = 220;

export class FoxAvatar {
  private timer: ReturnType<typeof setInterval> | null = null;
  private mood: FoxMood = 'calm';
  private blinking = false;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly containerId: number,
  ) {}

  static frameFor(mood: FoxMood): string {
    return FRAMES[mood].open;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.mood === 'calm') void this.blinkOnce();
    }, BLINK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async setMood(mood: FoxMood): Promise<void> {
    this.mood = mood;
    await updateText(this.bridge, this.containerId, FRAMES[mood].open);
  }

  private async blinkOnce(): Promise<void> {
    if (this.blinking) return;
    this.blinking = true;
    try {
      await updateText(this.bridge, this.containerId, FRAMES[this.mood].blink);
      await new Promise((r) => setTimeout(r, BLINK_HOLD_MS));
      await updateText(this.bridge, this.containerId, FRAMES[this.mood].open);
    } finally {
      this.blinking = false;
    }
  }
}
