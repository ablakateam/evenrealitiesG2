import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { apiGet, apiPost, apiDelete, ApiError } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardBody, Button, Badge, EmptyState } from '@/components/ui';

/**
 * Pair a VOX app install with this server.
 *
 * The app from the Even Hub store carries no server address and no secret —
 * that is what makes it safe to distribute publicly. This card closes the gap:
 * it mints a short-lived code and renders it as a link the app can read.
 *
 * The link is `https://<this server>/p/<CODE>`, and both halves matter. The
 * origin tells the app which server to talk to; the code is what it redeems
 * there. A bare code would be unusable — with nothing baked into the bundle,
 * the app would have no idea where to send it.
 *
 * What comes back is a per-install credential, not this account's shared
 * secret. Each paired device can be revoked on its own below.
 */

interface PairCode {
  code: string;
  url: string;
  server: string;
  expires_at: string;
  expires_in: number;
}

interface Device {
  id: number;
  name: string;
  created_at: string;
  last_seen_at: string | null;
}

export function PairGlasses() {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [code, setCode] = useState<PairCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minting, setMinting] = useState(false);

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiGet<{ devices: Device[]; current_device_id: number | null }>('/api/devices'),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  const mint = useCallback(async () => {
    setError(null);
    setCopied(false);
    setMinting(true);
    try {
      const res = await apiPost<PairCode>('/api/pair/code', {});
      setCode(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create a pairing code.');
    } finally {
      setMinting(false);
    }
  }, []);

  // Paint the QR after the canvas has mounted with the code — drawing inside
  // mint() would race the conditional render below.
  useEffect(() => {
    if (!code || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, code.url, {
      width: 190,
      margin: 1,
      color: { dark: '#39ff6a', light: '#0a0b0d' },
    }).catch(() => {
      /* Canvas failure is non-fatal — the link text below still works. */
    });
  }, [code]);

  // Tick so the code visibly goes stale, rather than failing opaquely on the
  // glasses after it has quietly expired.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = code ? Math.max(0, Math.round((new Date(code.expires_at).getTime() - now) / 1000)) : null;
  const expired = secondsLeft === 0;

  const copyLink = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  };

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle>Pair your glasses</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-ink-muted">
          Install VOX from the Even Hub store, open it on your phone, and paste this link into the
          pairing screen. The glasses receive their own credential — this account&apos;s shared
          secret never leaves the server.
        </p>

        {!code ? (
          <Button onClick={() => void mint()} disabled={minting}>
            {minting ? 'Creating…' : 'Create pairing link'}
          </Button>
        ) : (
          <div className="flex flex-col items-center">
            <div
              className="rounded-card border border-line bg-bg-inset p-3"
              // Dim rather than hide on expiry: the shape staying put makes it
              // obvious this is the same code gone stale, not a new screen.
              style={{ opacity: expired ? 0.3 : 1 }}
            >
              <canvas ref={canvasRef} />
            </div>

            <code className="mt-3 select-all break-all text-center font-mono text-xs text-ink">
              {code.url}
            </code>

            <p className="mt-2 text-center text-xs text-ink-faint">
              {expired ? (
                'This link has expired.'
              ) : (
                <>
                  Code <span className="font-mono text-ink">{code.code}</span> · expires in{' '}
                  {secondsLeft}s · single use
                </>
              )}
            </p>

            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void copyLink()} disabled={expired}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button size="sm" onClick={() => void mint()} disabled={minting}>
                {expired ? 'New link' : 'Refresh'}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        {/* Paired devices */}
        <div className="mt-6 border-t border-line pt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            Paired devices
          </div>
          {devices.data && devices.data.devices.length > 0 ? (
            <ul className="divide-y divide-line">
              {devices.data.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">
                      {d.name}
                      {d.id === devices.data.current_device_id && (
                        <span className="ml-2 align-middle"><Badge tone="ok">this device</Badge></span>
                      )}
                    </div>
                    <div className="text-xs text-ink-faint">
                      {d.last_seen_at ? `last seen ${relative(d.last_seen_at)}` : 'never used'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(d.id)}
                    disabled={revoke.isPending}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No paired devices yet — create a pairing link above.</EmptyState>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function relative(iso: string): string {
  // SQLite writes datetime('now') without a zone; it is UTC, so say so.
  const then = new Date(/[Z+]/.test(iso) ? iso : `${iso}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
