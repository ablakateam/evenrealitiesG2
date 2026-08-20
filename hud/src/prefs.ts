import { apiGet, hudApi, type Tone } from './api.js';

/**
 * User preferences, mirrored from the server.
 *
 * Until v0.1.17 the HUD never read /api/config at all: every preference the
 * dashboard exposed (default tone, recording limits, ...) was silently inert
 * on the glasses, which is why a style chosen on the phone had no effect on
 * what the glasses sent. The HUD now hydrates these once per launch and
 * writes back when the wearer changes a setting from the glasses, so the two
 * surfaces always agree.
 *
 * Everything degrades to DEFAULTS if the fetch fails — a preferences round
 * trip must never block the compose path.
 */

export interface HudPrefs {
  default_tone: Tone;
  default_channel: 'sms' | 'email' | 'smart';
  max_recording_seconds: number;
  silence_autostop_seconds: number;
  confirm_before_send: boolean;
}

export const DEFAULT_PREFS: HudPrefs = {
  default_tone: 'casual',
  default_channel: 'sms',
  max_recording_seconds: 60,
  silence_autostop_seconds: 6,
  confirm_before_send: true,
};

let cached: HudPrefs = { ...DEFAULT_PREFS };
let hydrated = false;

/** Last-known preferences. Always safe to call — falls back to defaults. */
export function getPrefs(): HudPrefs {
  return cached;
}

export function prefsHydrated(): boolean {
  return hydrated;
}

/** Fetch preferences from the server. Safe to call repeatedly. */
export async function hydratePrefs(): Promise<HudPrefs> {
  try {
    const res = await apiGet<{ preferences: Partial<HudPrefs> }>('/api/config');
    const p = res.preferences ?? {};
    cached = {
      default_tone: p.default_tone ?? DEFAULT_PREFS.default_tone,
      default_channel: p.default_channel ?? DEFAULT_PREFS.default_channel,
      // Clamp to the server's own validation range so a bad row can't wedge
      // the recorder into a 0-second or 10-minute capture.
      max_recording_seconds: clamp(p.max_recording_seconds, 10, 300, DEFAULT_PREFS.max_recording_seconds),
      silence_autostop_seconds: clamp(p.silence_autostop_seconds, 0, 30, DEFAULT_PREFS.silence_autostop_seconds),
      confirm_before_send: p.confirm_before_send ?? DEFAULT_PREFS.confirm_before_send,
    };
    hydrated = true;
  } catch (err) {
    console.warn('[prefs] hydrate failed, using defaults:', err);
  }
  return cached;
}

/**
 * Persist the wearer's default message style, chosen on the glasses.
 * Optimistically updates the cache so the UI reflects the pick instantly,
 * then writes through to the server (which the dashboard reads).
 */
export async function setDefaultTone(tone: Tone): Promise<void> {
  cached = { ...cached, default_tone: tone };
  await hudApi('/api/config', { method: 'PUT', body: { default_tone: tone } });
}

function clamp(v: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}
