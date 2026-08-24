import { setPairing, getPairing, type Pairing } from './kvs.js';
import { EMBEDDED_CONFIG } from './embedded-config.js';

/**
 * Client half of the device-pairing exchange.
 *
 * A public VOX build ships with no server address and no secret, so the first
 * thing it needs is a way to learn both. The pairing link carries them
 * together:
 *
 *     https://vox.example.com/p/AB12CD34
 *     └────────origin────────┘   └─code─┘
 *
 * The origin is which server to talk to; the code is what to redeem there.
 * One string, so there is one thing to scan, paste, or read aloud — and no
 * central directory is needed to turn a bare code into a hostname.
 */

export interface ParsedPairingLink {
  server: string;
  code: string;
}

/** Codes are Crockford base32 (no I, L, O, U) — see server/src/routes/pair.ts. */
const CODE_PATTERN = /^[0-9A-Z]{8}$/;

/**
 * Resolve a pairing input to the server and code to use.
 *
 * A build can only ever reach ONE origin: the Even Realities App blocks any
 * request to a domain `app.json` does not whitelist, and wildcards are not
 * supported. So the server is never taken from user input — it comes from the
 * build, and anything typed is checked against it.
 *
 * That makes the code alone sufficient, which is also better to type. A full
 * link still works, because a QR naturally carries one.
 *
 * Note the deliberate absence of any `https://${...}` template. Such a string
 * survives minification as `https://${t}`, which store review flags as a URL
 * not covered by the whitelist — a fair reading, since nothing static can tell
 * where it points.
 */
export function parsePairingLink(raw: string): ParsedPairingLink | null {
  const input = raw.trim();
  if (!input) return null;

  const origin = EMBEDDED_CONFIG.allowedOrigin;
  if (!origin) return null;

  // Just the code — the common case now that the server is fixed.
  const bare = normalizeCode(input);
  if (CODE_PATTERN.test(bare)) return { server: origin, code: bare };

  // Otherwise a link. Resolving against `origin` as the base means a
  // scheme-less or path-only paste still parses, with no scheme literal here.
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return null;
  }

  // Reject a link pointing somewhere this build cannot reach, rather than
  // letting it fail later as an opaque network error.
  if (url.origin !== origin) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;

  const code = normalizeCode(last);
  if (!CODE_PATTERN.test(code)) return null;

  return { server: origin, code };
}

/** True when the input looks like a link to some OTHER server, so the caller
 *  can say why it was refused instead of showing a generic format hint. */
export function isForeignOrigin(raw: string): boolean {
  const origin = EMBEDDED_CONFIG.allowedOrigin;
  if (!origin) return false;
  const input = raw.trim();
  if (!/^[a-z]+:\/\//i.test(input)) return false;
  try {
    return new URL(input).origin !== origin;
  } catch {
    return false;
  }
}

/**
 * Mirror of the server's normalizer. Upper-cases, drops separators, and maps
 * the Crockford confusables so a code read off a screen by eye still matches.
 */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export class PairingError extends Error {}

/**
 * Redeem a code and persist the credential it returns.
 *
 * The secret arrives exactly once — if the KVS write fails the code is already
 * burned, so we write before reporting success and surface a write failure as
 * an error rather than leaving the app believing it is paired.
 */
export async function claimPairing(
  server: string,
  code: string,
  deviceName = 'VOX glasses',
): Promise<Pairing> {
  let res: Response;
  try {
    res = await fetch(`${server}/api/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_name: deviceName }),
    });
  } catch {
    throw new PairingError(
      `Could not reach ${stripScheme(server)}. Check the address and that your VOX server is running.`,
    );
  }

  if (!res.ok) {
    let message = `Pairing failed (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error body — the status-code message above is what we have.
    }
    throw new PairingError(message);
  }

  const body = (await res.json()) as { secret?: string; server?: string };
  if (!body.secret) throw new PairingError('The server did not return a credential. Try a fresh code.');

  // Prefer the server's own idea of its public origin — behind a proxy it may
  // differ from what was typed, and the app must use the canonical one.
  const pairing: Pairing = { server: body.server ?? server, secret: body.secret };

  try {
    await setPairing(pairing);
  } catch {
    throw new PairingError(
      'Paired with the server, but this device could not save the credential. ' +
        'Generate a fresh code and try again.',
    );
  }

  // Read it back rather than trusting the write. The failure is not always an
  // exception: without the host SDK bridge the write is a silent no-op, which
  // would report success and drop the user back on the pairing screen with no
  // explanation and a code already burned. Observed exactly that in a browser.
  const stored = await getPairing();
  if (!stored || stored.secret !== pairing.secret) {
    throw new PairingError(
      'Paired with the server, but the credential did not persist on this device. ' +
        'Generate a fresh code and try again.',
    );
  }

  return stored;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
