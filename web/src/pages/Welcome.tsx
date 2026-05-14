import { useState } from 'react';
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

  async function connect() {
    const secret = value.trim();
    if (!secret) return;
    setStatus('checking');
    setErrorMsg('');
    try {
      // Validate by hitting an auth-gated endpoint with the candidate secret.
      const res = await fetch(`${(import.meta.env.VITE_API_BASE as string) ?? ''}/api/config`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? 'auth_failed', body.message ?? 'Secret rejected');
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

          <label className="mb-1.5 block text-xs font-medium text-ink-muted">Pairing secret</label>
          <Input
            type="password"
            placeholder="paste your VOX secret"
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
            {status === 'checking' ? 'Connecting…' : 'Connect →'}
          </Button>

          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            The secret was printed once when the VOX server was deployed. A guided
            setup wizard replaces this in a later release.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
