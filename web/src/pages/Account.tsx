import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Card, CardBody, CardHeader, CardTitle, PageHeading, Button, Spinner, Modal, InlineNote } from '@/components/ui';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface AccountInfo {
  user_id: number;
  created_at: string;
  rotated_at: string | null;
}

export function Account() {
  const { secret, setSecret, clearSecret } = useAuth();
  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => apiGet<AccountInfo>('/api/account'),
  });

  const [showSecret, setShowSecret] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Connect QR.
   *
   * This used to encode `{server, secret}` — the PERMANENT shared secret, in
   * plaintext, on screen. Anyone who photographed it had unlimited Twilio and
   * LLM spend forever, with no way to detect or revoke it short of rotating.
   *
   * It now encodes a URL carrying a single-use handoff token that expires in
   * three minutes. Scanning opens /connect, which trades it for a session and
   * burns it. A stale photo of this screen is worthless.
   */
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const mintQr = useCallback(async () => {
    setQrError(null);
    try {
      const res = await apiPost<{ token: string; expires_in: number }>('/api/auth/handoff', {
        purpose: 'pairing',
      });
      const url = `${window.location.origin}/connect?t=${encodeURIComponent(res.token)}`;
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, url, {
          width: 180,
          margin: 1,
          color: { dark: '#39ff6a', light: '#0a0b0d' },
        });
      }
      setQrExpiresAt(Date.now() + res.expires_in * 1000);
    } catch (e) {
      setQrError(e instanceof ApiError ? e.message : 'Could not create a connect code.');
    }
  }, []);

  useEffect(() => {
    void mintQr();
  }, [mintQr]);

  // Countdown so the user can see the code go stale rather than scanning a
  // dead one and getting an opaque failure on the other device.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = qrExpiresAt ? Math.max(0, Math.round((qrExpiresAt - now) / 1000)) : null;

  return (
    <>
      <PageHeading title="Account" subtitle="Pairing, secret rotation, sign out" />

      {/* Pairing QR */}
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Connect another device</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col items-center">
          <div className="rounded-card border border-line bg-bg-inset p-3">
            <canvas ref={canvasRef} />
          </div>
          <p className="mt-3 text-center text-xs text-ink-faint">
            {qrError
              ? qrError
              : secondsLeft === null
                ? 'Preparing a connect code…'
                : secondsLeft > 0
                  ? `Scan from another device to sign in. Expires in ${secondsLeft}s — single use.`
                  : 'This code has expired.'}
          </p>
          <Button className="mt-3" onClick={() => void mintQr()}>
            {secondsLeft === 0 ? 'New code' : 'Refresh code'}
          </Button>
        </CardBody>
      </Card>

      {/* Shared secret */}
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Shared secret</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-line bg-bg-inset px-3 py-2 font-mono text-xs text-ink">
              {showSecret ? secret : '•'.repeat(28)}
            </code>
            <Button size="sm" variant="ghost" onClick={() => setShowSecret(!showSecret)}>
              {showSecret ? 'Hide' : 'Show'}
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(secret ?? '')}>
              Copy
            </Button>
            <Button size="sm" variant="danger" onClick={() => setRotateOpen(true)}>
              Regenerate
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Account info */}
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Info</CardTitle>
        </CardHeader>
        <CardBody>
          {account.isLoading && <Spinner />}
          {account.data && (
            <div className="space-y-1 text-sm text-ink-muted">
              <div>Created {new Date(account.data.created_at).toLocaleString()}</div>
              {account.data.rotated_at && (
                <div>Secret last rotated {new Date(account.data.rotated_at).toLocaleString()}</div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Button variant="ghost" onClick={clearSecret}>
        Sign out
      </Button>

      {rotateOpen && (
        <RotateModal
          onClose={() => setRotateOpen(false)}
          onRotated={(newSecret) => {
            setSecret(newSecret);
            setRotateOpen(false);
            void account.refetch();
          }}
        />
      )}
    </>
  );
}

function RotateModal({
  onClose,
  onRotated,
}: {
  onClose: () => void;
  onRotated: (secret: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function rotate() {
    setBusy(true);
    setErr('');
    try {
      const res = await apiPost<{ secret: string }>('/api/account/rotate-secret', {});
      onRotated(res.secret);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'rotation failed');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Regenerate shared secret">
      <p className="text-sm leading-relaxed text-ink-muted">
        This generates a new secret and immediately invalidates the old one. Any
        paired glasses will need to be re-paired with the new QR code. Your
        dashboard session updates automatically.
      </p>
      {err && (
        <div className="mt-3">
          <InlineNote tone="bad">{err}</InlineNote>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" className="flex-1" onClick={rotate} disabled={busy}>
          {busy ? 'Rotating…' : 'Regenerate'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
