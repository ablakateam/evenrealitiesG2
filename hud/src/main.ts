import { initBridge, normalizeEvent } from './bridge.js';
import { Router } from './router.js';
import { IdlePage } from './pages/idle.js';
import { VoiceCuePage } from './pages/voice-cue.js';
import {
  bootstrapPairingFromUrl,
  bootstrapPairingFromEmbedded,
  hasSeenVoiceCue,
  getPairing,
} from './kvs.js';
import { hudApi } from './api.js';
import { renderCompanion } from './companion/index.js';
import { hydratePrefs } from './prefs.js';
import { APP_VERSION } from './version.js';

/**
 * VOX runs one WebView that drives TWO independent surfaces:
 *
 *   - the phone screen      → whatever HTML lives in `#app`
 *   - the glasses display   → whatever `bridge.rebuildPageContainer()` paints
 *
 * So we always render the companion UI into `#app` (replaces the static
 * "Companion app is running" placeholder shipped in index.html) AND we
 * always boot the HUD in parallel. If glasses aren't connected, the bridge
 * calls are no-ops; the phone screen still shows the companion. If the
 * user opens VOX from the glasses launcher (phone WebView hidden), the
 * companion HTML is invisible but still cheap to render. Both surfaces
 * coexist.
 */

async function sendTelemetry(payload: { message: string; stack: string | null; page: string | null }): Promise<void> {
  try {
    await hudApi('/api/telemetry/error', {
      method: 'POST',
      body: { ...payload, app_version: APP_VERSION },
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
  // 1. Render the phone-companion UI immediately. This replaces the static
  //    "Companion app is running" placeholder in index.html so the phone
  //    user sees real content (status, activity, etc.). On glasses-only
  //    launches the HTML is invisible — cheap to render either way.
  const root = document.getElementById('app');
  if (root) {
    try {
      renderCompanion(root);
    } catch (err) {
      console.warn('[vox-hub] companion render failed:', err);
    }
  }

  // 2. Try to bring up the glasses bridge. In a plain browser (no host SDK)
  //    this throws; that's fine — the companion is the only surface.
  let bridge;
  try {
    bridge = await initBridge();
  } catch (err) {
    console.warn('[vox-hub] no bridge — companion-only mode:', err);
    return;
  }

  // Sideload bootstrap — `evenhub qr -u "<url>?server=...&secret=..."`
  await bootstrapPairingFromUrl();

  // Single-tenant Private/Beta bake-in — `hud/.env` VITE_VOX_SERVER + VITE_VOX_SECRET
  // are inlined at build time. If KVS is still empty, lift them in so the HUD
  // boots paired on a fresh install. No-op if KVS already has a pairing.
  await bootstrapPairingFromEmbedded();

  const router = new Router(bridge);

  // --- Global event subscriber --------------------------------------------
  // The double-tap exit gate MUST fire regardless of which page is mounted
  // or which envelope the event arrived in. We intercept it here and only
  // delegate everything else to the router.
  const unsubscribe = bridge.onEvenHubEvent((rawEvent) => {
    const event = normalizeEvent(rawEvent);
    if (!event) return;

    if (event.kind === 'double-tap') {
      // Single-rule back: anywhere → Idle; on Idle → exit the app.
      // We chose this over a per-step back stack because each flow page
      // (Voice → Confirm → Send → Sent) has its own side-effects on
      // re-mount (mic re-opens, drafts re-load), so stepping back through
      // them felt buggier than just bouncing home. Even Hub submission
      // requires the root double-tap to exit; that's still honored.
      if (router.currentId === 'idle') {
        void bridge.shutDownPageContainer(1);
      } else {
        void router.go(IdlePage);
      }
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

  // Pull preferences before the first paint so the Idle "Style:" row and the
  // starting tone of a new message reflect what the dashboard has saved,
  // rather than flashing a default and correcting itself a moment later.
  if (paired) await hydratePrefs();

  await router.go(paired && !seenCue ? VoiceCuePage : IdlePage);
}

main().catch((err) => {
  console.error('[vox-hud] fatal during boot:', err);
});
