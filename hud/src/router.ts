import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { NormalizedEvent } from './bridge.js';

/**
 * In-memory page router / state machine.
 *
 * Pages implement `mount` (build their containers) and optionally `onEvent`
 * (react to taps/scroll/etc). The router owns the current page, the back
 * stack, and dispatches normalized events.
 *
 * The root double-tap -> `shutDownPageContainer(1)` submission gate is NOT
 * handled here — it's intercepted in main.ts before the router sees the
 * event, so it always fires no matter what page is mounted.
 */
export interface PageContext {
  bridge: EvenAppBridge;
  router: Router;
}

export interface Page {
  readonly id: string;
  /** Build the page's containers. Called on entry. */
  mount(ctx: PageContext): Promise<void>;
  /** React to a normalized input/lifecycle event. Optional. */
  onEvent?(event: NormalizedEvent, ctx: PageContext): void | Promise<void>;
  /** Cleanup (cancel timers, release mic, etc). Optional. */
  unmount?(): void | Promise<void>;
  /**
   * Milliseconds of input suppression after this page mounts. Defaults to
   * SETTLE_MS. A page that legitimately wants instant input (none today)
   * can set 0.
   */
  readonly settleMs?: number;
}

/**
 * Input settle window.
 *
 * The temple touch that LAUNCHES VOX (from the glasses menu, or the phone
 * app handing focus to the glasses) is delivered to whatever page mounts
 * first. Before this guard, that stray tap landed on Idle's capture surface
 * and immediately pushed Compose — the app appeared to "flash the main
 * screen then jump into the message screen" with no user input.
 *
 * We drop user-INPUT events (tap / list-select / scroll) for a short window
 * after every mount. Lifecycle events (foreground, exit) and mic audio are
 * never suppressed: dropping those would leak the microphone or defeat the
 * exit gate.
 */
const SETTLE_MS = 700;

function isSuppressibleInput(event: NormalizedEvent): boolean {
  return (
    event.kind === 'tap' ||
    event.kind === 'list-select' ||
    event.kind === 'scroll-up' ||
    event.kind === 'scroll-down'
  );
}

export class Router {
  private current: Page | null = null;
  private stack: Page[] = [];
  /** Timestamp (ms) before which input events are ignored. */
  private inputReadyAt = 0;

  constructor(private readonly bridge: EvenAppBridge) {}

  private ctx(): PageContext {
    return { bridge: this.bridge, router: this };
  }

  get currentId(): string | null {
    return this.current?.id ?? null;
  }

  /** True when there's somewhere to go back to. */
  get canGoBack(): boolean {
    return this.stack.length > 0;
  }

  /** Open the settle window for the page that just mounted. */
  private armSettle(page: Page): void {
    this.inputReadyAt = Date.now() + (page.settleMs ?? SETTLE_MS);
  }

  /** Replace the current page (no back entry). Used for top-level navigation. */
  async go(page: Page): Promise<void> {
    await this.current?.unmount?.();
    this.stack = [];
    this.current = page;
    this.armSettle(page);
    await page.mount(this.ctx());
  }

  /** Push a page, keeping the current one on the back stack. */
  async push(page: Page): Promise<void> {
    if (this.current) this.stack.push(this.current);
    await this.current?.unmount?.();
    this.current = page;
    this.armSettle(page);
    await page.mount(this.ctx());
  }

  /** Pop back to the previous page. Returns false if the stack was empty. */
  async back(): Promise<boolean> {
    const prev = this.stack.pop();
    if (!prev) return false;
    await this.current?.unmount?.();
    this.current = prev;
    this.armSettle(prev);
    await prev.mount(this.ctx());
    return true;
  }

  /**
   * Re-mount the current page in place (no stack change) — used by
   * foreground-enter refreshes. Runs unmount() first so pages that own
   * timers don't leak a second one.
   */
  async remount(): Promise<void> {
    const page = this.current;
    if (!page) return;
    await page.unmount?.();
    this.armSettle(page);
    await page.mount(this.ctx());
  }

  /** Dispatch a normalized event to the current page. */
  dispatch(event: NormalizedEvent): void {
    if (isSuppressibleInput(event) && Date.now() < this.inputReadyAt) {
      console.log(`[router] settling — dropped ${event.kind} on '${this.currentId}'`);
      return;
    }
    void this.current?.onEvent?.(event, this.ctx());
  }
}
