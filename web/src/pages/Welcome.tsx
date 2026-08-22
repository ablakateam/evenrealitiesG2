import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardBody, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

/**
 * First-launch screen. Until the P9 onboarding wizard issues a real
 * per-device secret, the user pastes the BOOTSTRAP_SECRET printed during
 * server deploy. We validate it against /api/config before storing.
 */
export function Welcome() {
  const { setSecret } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  /**
   * Which credential to ask for.
   *
   * The shared secret is 32 random characters and lives in the dashboard —
   * which is the thing you need it to open. So if a password has been set, ask
   * for that; the secret stays available as the fallback that always works.
   */
  const [mode, setMode] = useState<'password' | 'secret'>('secret');
  const [passwordAvailable, setPasswordAvailable] = useState(false);

  const base = (import.meta.env.VITE_API_BASE as string) ?? '';

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${base}/api/auth/login`);
        if (!res.ok) return;
        const body = (await res.json()) as { password_set: boolean };
        setPasswordAvailable(body.password_set);
        if (body.password_set) setMode('password');
      } catch {
        // Server unreachable or an older build without the endpoint — the
        // secret field still works, so say nothing and leave it as-is.
      }
    })();
  }, [base]);

  async function connect() {
    const entered = value.trim();
    if (!entered) return;
    setStatus('checking');
    setErrorMsg('');
    try {
      let secret = entered;

      if (mode === 'password') {
        // Trade the password for the shared secret; everything downstream is
        // unchanged, so this is a new door rather than a new access model.
        const res = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: entered }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new ApiError(res.status, body.error ?? 'auth_failed', body.message ?? 'Sign-in failed');
        }
        secret = body.secret as string;
      } else {
        // Validate by hitting an auth-gated endpoint with the candidate secret.
        const res = await fetch(`${base}/api/config`, {
          headers: { Authorization: `Bearer ${entered}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(res.status, body.error ?? 'auth_failed', body.message ?? 'Secret rejected');
        }
      }

      setSecret(secret);
      navigate('/', { replace: true });
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof ApiError ? err.message : 'Could not reach the VOX server. Try again?');
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardBody className="pt-7">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-ink">VOX</span>
            <span className="rounded bg-phos/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-phos">
              G2
            </span>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-ink-muted">
            Send SMS and email from your Even Realities G2, hands-free. Voice in, glance out.
          </p>

          <label className="mb-1.5 block text-xs font-medium text-ink-muted">
            {mode === 'password' ? 'Password' : 'VOX secret'}
          </label>
          <Input
            type="password"
            autoComplete={mode === 'password' ? 'current-password' : 'off'}
            placeholder={mode === 'password' ? 'your dashboard password' : 'paste your VOX secret'}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (status === 'error') setStatus('idle');
            }}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            autoFocus
          />
          {status === 'error' && <p className="mt-2 text-xs text-danger">{errorMsg}</p>}

          <Button
            variant="primary"
            className="mt-4 w-full"
            disabled={!value.trim() || status === 'checking'}
            onClick={connect}
          >
            {status === 'checking' ? 'Signing in…' : 'Sign in →'}
          </Button>

          <button
            type="button"
            className="mt-4 w-full text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
            onClick={() => {
              setMode(mode === 'password' ? 'secret' : 'password');
              setValue('');
              setStatus('idle');
            }}
          >
            {mode === 'password' ? 'Use the VOX secret instead' : 'Use a password instead'}
          </button>

          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            {mode === 'password'
              ? 'Set under Account → Dashboard password. Forgotten it? Sign in with the VOX secret and set a new one.'
              : passwordAvailable
                ? 'The secret was printed once when the VOX server was deployed. A password is quicker.'
                : 'The secret was printed once when the VOX server was deployed. Set a password under Account so you do not need it again.'}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
