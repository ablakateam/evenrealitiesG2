import { getBridge } from './bridge.js';

/**
 * Key-value store wrapper around bridge.setLocalStorage / getLocalStorage.
 *
 * Why this exists: the WebView's own `localStorage` is wiped when the app
 * restarts on the glasses — the SDK's KVS is the only thing that persists.
 * Anything that must survive a restart (the pairing secret, the server URL,
 * one-time flags) goes through here.
 *
 * Values are strings on the wire; `getJson` / `setJson` add a typed JSON
 * layer on top.
 */

const KEYS = {
  server: 'vox.server',
  secret: 'vox.secret',
  seenVoiceCue: 'vox.seen_voice_cue',
} as const;

export async function kvGet(key: string): Promise<string | null> {
  try {
    const v = await getBridge().getLocalStorage(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  await getBridge().setLocalStorage(key, value);
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson<T>(key: string, value: T): Promise<void> {
  await kvSet(key, JSON.stringify(value));
}

/* --- Pairing (server URL + shared secret) -------------------------------- */

export interface Pairing {
  server: string;
  secret: string;
}

/** Read the stored pairing, or null if the HUD hasn't been paired yet. */
export async function getPairing(): Promise<Pairing | null> {
  const [server, secret] = await Promise.all([kvGet(KEYS.server), kvGet(KEYS.secret)]);
  if (!server || !secret) return null;
  return { server, secret };
}

/** Persist a pairing (server origin + shared secret). */
export async function setPairing(pairing: Pairing): Promise<void> {
  await kvSet(KEYS.server, pairing.server);
  await kvSet(KEYS.secret, pairing.secret);
}

/**
 * Bootstrap pairing from the launch URL's query string, if present.
 * During sideload (`evenhub qr -u "<url>?server=...&secret=..."`) the params
 * ride in on the URL; we lift them into KVS on first launch so subsequent
 * cold starts work without them. Returns the pairing if found.
 */
export async function bootstrapPairingFromUrl(): Promise<Pairing | null> {
  try {
    const params = new URLSearchParams(window.location.search);
    const server = params.get('server');
    const secret = params.get('secret');
    if (server && secret) {
      const pairing = { server, secret };
      await setPairing(pairing);
      return pairing;
    }
  } catch {
    // window.location may be unavailable in some host contexts — non-fatal
  }
  return null;
}

/* --- One-time flags ------------------------------------------------------ */

export async function hasSeenVoiceCue(): Promise<boolean> {
  return (await kvGet(KEYS.seenVoiceCue)) === '1';
}
export async function markVoiceCueSeen(): Promise<void> {
  await kvSet(KEYS.seenVoiceCue, '1');
}
