import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Spinner, InlineNote } from '@/components/ui';
import { captureReturnTo } from '@/lib/returnTo';

/**
 * /connect?t=<handoff> — passkey-free sign-in.
 *
 * Reached by tapping "Open dashboard" in the phone companion, or by scanning
 * the Account page QR from another device. The token is exchanged exactly
 * once for the shared secret, which is then stored the same way a typed
 * passkey would be.
 *
 * The token is stripped from the URL immediately on success so it never
 * lands in browser history, a bookmark, or a screenshot — even though it is
 * already burned server-side by then.
 */
export function Connect() {
  const [params] = useSearchParams();
  const { setSecret } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Stash the companion's address before we navigate away from /connect.
    captureReturnTo();
    const token = params.get('t');
    if (!token) {
      setError('This link is missing its code.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/handoff/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.secret) {
          throw new Error(data?.message ?? 'This link has expired.');
        }
        if (cancelled) return;
        setSecret(data.secret);
        // replace: true so the token is not left in history.
        navigate('/', { replace: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not connect.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, setSecret, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      {!error ? (
        <>
          <Spinner />
          <p className="text-sm text-fg-muted">Connecting VOX…</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Couldn&apos;t connect</h1>
          <InlineNote tone="bad">{error}</InlineNote>
          <p className="max-w-xs text-sm text-fg-muted">
            Connect links are single-use and expire after a few minutes. Open VOX on your phone and
            tap Open dashboard again for a fresh one.
          </p>
          <button
            className="mt-2 text-sm underline"
            onClick={() => navigate('/welcome', { replace: true })}
          >
            Enter passkey instead
          </button>
        </>
      )}
    </div>
  );
}
