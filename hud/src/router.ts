import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { NormalizedEvent } from './bridge.js';

/**
 * In-memory page router / state machine.
 *
 * Pages implement `mount` (build their containers) and optionally `onEvent`
 * (react to taps/scroll/etc). The router owns the current page, the back
 * stack, and dispatches normalized events.
 *
 * The root double-tap → `shutDownPageContainer(1)` submission gate is NOT
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
}

export class Router {
  private current: Page | null = null;
  private stack: Page[] = [];

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

  /** Replace the current page (no back entry). Used for top-level navigation. */
  async go(page: Page): Promise<void> {
    await this.current?.unmount?.();
    this.stack = [];
    this.current = page;
    await page.mount(this.ctx());
  }

  /** Push a page, keeping the current one on the back stack. */
  async push(page: Page): Promise<void> {
    if (this.current) this.stack.push(this.current);
    await this.current?.unmount?.();
    this.current = page;
    await page.mount(this.ctx());
  }

  /** Pop back to the previous page. Returns false if the stack was empty. */
  async back(): Promise<boolean> {
    const prev = this.stack.pop();
    if (!prev) return false;
    await this.current?.unmount?.();
    this.current = prev;
    await prev.mount(this.ctx());
    return true;
  }

  /** Dispatch a normalized event to the current page. */
  dispatch(event: NormalizedEvent): void {
    void this.current?.onEvent?.(event, this.ctx());
  }
}
