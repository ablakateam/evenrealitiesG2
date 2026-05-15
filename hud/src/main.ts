import { initBridge, normalizeEvent } from './bridge.js';
import { Router } from './router.js';
import { IdlePage } from './pages/idle.js';
import { VoiceCuePage } from './pages/voice-cue.js';
import { bootstrapPairingFromUrl, hasSeenVoiceCue, getPairing } from './kvs.js';
import { hudApi } from './api.js';

async function sendTelemetry(payload: { message: string; stack: string | null; page: string | null }): Promise<void> {
  try {
    await hudApi('/api/telemetry/error', {
      method: 'POST',
      body: { ...payload, app_version: '0.1.0' },
    });
  } catch {
    // Best-effort: don't surface a telemetry failure to the user.
  }
}

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

    // FOREGROUND_EXIT: another app took focus or user backgrounded VOX.
    // Globally close the mic so we never drain battery in the background.
    // Pages that own per-page state still see the event via router.dispatch.
    if (event.kind === 'foreground-exit') {
      void bridge.audioControl(false).catch(() => {});
    }

    router.dispatch(event);
  });

  // Global error → telemetry. The /api/telemetry/error route is best-effort:
  // we send what we have, swallow any failure, never block the user.
  window.addEventListener('error', (e) => {
    void sendTelemetry({
      message: e.message,
      stack: e.error instanceof Error ? (e.error.stack ?? null) : null,
      page: router.currentId,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason : null;
    void sendTelemetry({
      message: reason?.message ?? String(e.reason),
      stack: (reason?.stack ?? null) as string | null,
      page: router.currentId,
    });
  });

  // --- Mount the root page ------------------------------------------------
  // First-run users see the voice cue card once before landing on Idle.
  // We only show it once paired — there's no point teaching voice when
  // the HUD can't talk to the server yet.
  const paired = (await getPairing()) !== null;
  const seenCue = await hasSeenVoiceCue();
  await router.go(paired && !seenCue ? VoiceCuePage : IdlePage);
}

main().catch((err) => {
  console.error('[vox-hud] fatal during boot:', err);
});
