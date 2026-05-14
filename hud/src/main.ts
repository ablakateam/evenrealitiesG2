import { initBridge, normalizeEvent } from './bridge.js';
import { Router } from './router.js';
import { IdlePage } from './pages/idle.js';
import { bootstrapPairingFromUrl } from './kvs.js';

/**
 * VOX HUD entry point.
 *
 * Boot sequence:
 *   1. wait for the Even App bridge
 *   2. lift any pairing params from the launch URL into KVS (sideload path)
 *   3. wire the global event subscriber — the ROOT DOUBLE-TAP EXIT GATE
 *      is enforced here, before the router sees the event, so the user can
 *      always leave the app (Even Hub submission requirement)
 *   4. mount the Idle page
 */
async function main(): Promise<void> {
  const bridge = await initBridge();

  // Sideload bootstrap — `evenhub qr -u "<url>?server=...&secret=..."`
  await bootstrapPairingFromUrl();

  const router = new Router(bridge);

  // --- Global event subscriber --------------------------------------------
  // The double-tap exit gate MUST fire regardless of which page is mounted
  // or which envelope the event arrived in. We intercept it here and only
  // delegate everything else to the router.
  const unsubscribe = bridge.onEvenHubEvent((rawEvent) => {
    const event = normalizeEvent(rawEvent);
    if (!event) return;

    if (event.kind === 'double-tap') {
      // exitMode 1 = pop the foreground layer + let the user confirm exit
      void bridge.shutDownPageContainer(1);
      return;
    }

    if (event.kind === 'system-exit' || event.kind === 'abnormal-exit') {
      unsubscribe();
      return;
    }

    router.dispatch(event);
  });

  // --- Mount the root page ------------------------------------------------
  await router.go(IdlePage);
}

main().catch((err) => {
  console.error('[vox-hud] fatal during boot:', err);
});
