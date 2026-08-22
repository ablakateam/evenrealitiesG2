import { useParams } from 'react-router-dom';

/**
 * What a person sees if they open a pairing link in a browser instead of
 * pasting it into the VOX app.
 *
 * The link is meant to be consumed by the app, not visited — but people scan
 * QR codes with the system camera, and the system camera opens a browser. A
 * 404 or a silent redirect to the dashboard would read as "the code is
 * broken" when it is perfectly valid, so this page says what to do with it and
 * shows the link ready to copy.
 *
 * It deliberately does NOT redeem the code. Redeeming here would burn it on a
 * device that cannot store the credential, and the code is single-use.
 */
export function PairLanding() {
  const { code } = useParams<{ code: string }>();
  const url = `${window.location.origin}/p/${code ?? ''}`;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-gutter py-12 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        Pairing link
      </div>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Open this in VOX</h1>
      <p className="mt-3 max-w-sm text-sm text-ink-muted">
        This link pairs your glasses with this server. Open the VOX app on your phone and paste it
        into the pairing screen — it will not do anything in a browser.
      </p>

      <code className="mt-6 max-w-full select-all break-all rounded-lg border border-line bg-bg-inset px-4 py-3 font-mono text-xs text-ink">
        {url}
      </code>

      <p className="mt-4 text-xs text-ink-faint">
        Codes are single use and expire quickly. If this one has gone stale, generate another from
        Account → Pair your glasses.
      </p>
    </div>
  );
}
