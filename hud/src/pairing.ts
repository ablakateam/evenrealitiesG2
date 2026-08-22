import { setPairing, getPairing, type Pairing } from './kvs.js';

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
 * Accept anything a person could plausibly hand us: the full link, a link
 * without a scheme, or a bare `host CODE` pair. Returns null when the input
 * cannot be read as both a server and a code — the caller shows the format
 * hint rather than guessing.
 */
export function parsePairingLink(raw: string): ParsedPairingLink | null {
  const input = raw.trim();
  if (!input) return null;

  // Bare `example.com ABCD-1234` / `example.com/ABCD1234` — no scheme.
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  // The code is the last non-empty path segment. Accepting any segment (not
  // just `/p/`) means a link copied with extra path prefix still works.
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;

  const code = normalizeCode(last);
  if (!CODE_PATTERN.test(code)) return null;

  return { server: url.origin, code };
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
