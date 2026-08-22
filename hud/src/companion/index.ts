/**
 * Phone WebView companion — the "home page" you see when you tap VOX
 * from the Even Realities phone app.
 *
 * Design goal: this is the first thing the user sees on the phone side.
 * It should read as a REAL app home — identity + service health at a
 * glance, today's counts, quick actions that deep-link to the dashboard,
 * and a live activity feed. Not a status ticker.
 *
 * Pure vanilla DOM + fetch — no framework, no router. Keeps the bundle
 * small (~40 KB) since this is what loads inside the WebView every time
 * the phone user opens VOX.
 *
 * Deep links jump to the full dashboard at <server>/<section> where the
 * SPA (web/) picks up.
 */

import { EMBEDDED_CONFIG } from '../embedded-config.js';
import { getPairing, type Pairing } from '../kvs.js';
import { parsePairingLink, claimPairing, PairingError } from '../pairing.js';

/** Origin of the paired server. Set once renderCompanion resolves a pairing;
 *  the paint* helpers read it to build dashboard links without taking it as
 *  a parameter each. */
let pairedServer = '';
import { APP_VERSION, SDK_VERSION } from '../version.js';


type HistoryItem = {
  id: number;
  channel: 'sms' | 'email';
  direction: 'out' | 'in';
  body: string;
  contact_name: string | null;
  created_at: string;
  status: string;
};

type IdleStatus = {
  twilio: boolean;
  email: boolean;
  today_sent: number;
  today_failed: number;
  unread: number;
};

type IntegrationView = {
  provider: 'twilio' | 'openai' | 'anthropic' | 'openrouter' | 'ollama-cloud';
  status: 'configured' | 'unconfigured' | 'error';
  configured: boolean;
  metadata: Record<string, unknown>;
};

type Tone = 'casual' | 'professional' | 'friendly' | 'formal' | 'sarcastic' | 'grammar' | 'original';

const TONES: Tone[] = [
  'casual',
  'professional',
  'friendly',
  'formal',
  'sarcastic',
  'grammar',
  'original',
];


/* --- design system ------------------------------------------------------ */

const PHOS = '#39ff6a';
/* Google Fonts is NOT reachable from the packed app — app.json's network
   whitelist contains only the VOX server, and adding font hosts would mean a
   manifest change and another review. The system mono stack resolves to
   SF Mono on iOS, which is a better technical face than anything we would
   have loaded anyway, and costs nothing. */
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

/**
 * Styles that inline cssText cannot express: keyframes and pseudo-elements.
 * Injected once per render, matching the dashboard's visual language so the
 * two surfaces read as one product.
 */
function injectStyles(): void {
  if (document.getElementById('vox-style')) return;
  const el = document.createElement('style');
  el.id = 'vox-style';
  el.textContent = `
    @property --trace-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
    @keyframes vox-trace   { to { --trace-angle: 360deg; } }
    @keyframes vox-rise    { from { opacity:0; transform:translateY(6px);} to {opacity:1;transform:none;} }
    @keyframes vox-breathe { 0%,100%{opacity:1} 50%{opacity:.55} }

    /* The signature: a phosphor light travelling a live surface's outline,
       the same gesture the glasses use for a live voice trace. */
    .vox-trace { position: relative; isolation: isolate; }
    .vox-trace::before {
      content:''; position:absolute; inset:-1px; border-radius:inherit; padding:1px;
      background: conic-gradient(from var(--trace-angle), transparent 0deg,
        transparent 275deg, rgba(57,255,106,.5) 330deg, ${PHOS} 352deg,
        rgba(57,255,106,.5) 358deg, transparent 360deg);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      mask-composite: exclude;
      animation: vox-trace 4s linear infinite;
      pointer-events:none;
    }

    /* Corner ticks — instrument framing, echoing the G2's container borders. */
    .vox-bracket { position: relative; }
    .vox-bracket::before, .vox-bracket::after {
      content:''; position:absolute; width:9px; height:9px;
      border-color: rgba(57,255,106,.45); border-style: solid; pointer-events:none;
    }
    .vox-bracket::before { top:-1px; left:-1px;  border-width:1px 0 0 1px; border-top-left-radius:3px; }
    .vox-bracket::after  { bottom:-1px; right:-1px; border-width:0 1px 1px 0; border-bottom-right-radius:3px; }

    .vox-rise { animation: vox-rise .38s cubic-bezier(.22,.8,.3,1) both; }
    .vox-live { animation: vox-breathe 2.4s ease-in-out infinite; }

    @media (prefers-reduced-motion: reduce) {
      .vox-trace::before, .vox-rise, .vox-live { animation: none !important; }
    }
  `;
  document.head.appendChild(el);
}

/** Small uppercase label, used above every section. */
function eyebrowStyle(): string {
  return `font-family:${MONO}; font-size:10px; letter-spacing:.18em;
          text-transform:uppercase; color:#5f646b;`;
}

/* --- root shell + boot -------------------------------------------------- */

export async function renderCompanion(root: HTMLElement): Promise<void> {
  injectStyles();
  root.innerHTML = '';
  // Set `display` explicitly. index.html styles #app as a centred flexbox
  // for the static placeholder, and that rule lives in a stylesheet, so
  // assigning cssText here does NOT clear it — the app root would otherwise
  // inherit a layout mode meant for a single centred line of text, leaving
  // the wrapper as a row flex item with the default `min-width: auto`.
  // Verified rendering clean at a true 390 px width either way; this is
  // belt-and-braces so a longer activity row can't find the edge case.
  root.style.cssText = `
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 100%;
    background: #1a1a1a;
    color: #E5E5E5;
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    /* CRT lineage, at the threshold of visibility. Stronger than this and it
       reads as a costume rather than an instrument. */
    background-image: repeating-linear-gradient(
      to bottom, rgba(57,255,106,.015) 0 1px, transparent 1px 3px);
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0;
  `;

  // Resolve the credential from KVS first — a paired install always wins over
  // whatever the bundle was built with. A public build has no embedded config
  // at all, so this is the only source.
  const pairing = await resolvePairing();
  if (!pairing) {
    root.appendChild(pairingScreen(() => renderCompanion(root)));
    return;
  }
  const { server, secret } = pairing;
  pairedServer = server;

  const wrap = el('div', {
    style: `
      padding: 20px 16px 40px;
      width: 100%;
      max-width: 520px;
      margin: 0 auto;
      box-sizing: border-box;
    `,
  });
  root.appendChild(wrap);

  const blocks = [
    headerBlock(server),
    statusBlock(),
    todayBlock(),
    styleBlock(server, secret),
    connectBlock(server, secret),
    quickActionsBlock(server),
    activityBlock(),
    footerBlock(server),
  ];
  blocks.forEach((b, i) => {
    // Assemble rather than snap in. Cheap, and it makes the surface feel
    // like it is powering up instead of repainting.
    b.classList.add('vox-rise');
    b.style.animationDelay = `${i * 45}ms`;
    wrap.appendChild(b);
  });

  void hydrate(server, secret);

  // Poll every 15s while visible; force-refresh on tab return so a message
  // sent from the glasses lands in the activity feed within moments of the
  // user checking the phone.
  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void hydrate(server, secret);
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void hydrate(server, secret);
  });
  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
}

/* --- data fetch --------------------------------------------------------- */

async function hydrate(server: string, secret: string): Promise<void> {
  const auth = { Authorization: `Bearer ${secret}` };
  const fetchOpts: RequestInit = { headers: auth, cache: 'no-store' };
  const bust = Date.now();

  try {
    const [statusRes, historyRes, integrationsRes, configRes] = await Promise.all([
      fetch(`${server}/api/idle-suggestions?_=${bust}`, fetchOpts).then((r) => r.json()),
      fetch(`${server}/api/history?limit=10&_=${bust}`, fetchOpts).then((r) => r.json()),
      fetch(`${server}/api/integrations?_=${bust}`, fetchOpts)
        .then((r) => r.json())
        .catch(() => ({ integrations: [] })),
      fetch(`${server}/api/config?_=${bust}`, fetchOpts)
        .then((r) => r.json())
        .catch(() => ({ preferences: {} })),
    ]);
    const status: IdleStatus = statusRes.status ?? {
      twilio: false,
      email: false,
      today_sent: 0,
      today_failed: 0,
      unread: 0,
    };
    const history: HistoryItem[] = historyRes.items ?? [];
    const integrations: IntegrationView[] = integrationsRes.integrations ?? [];
    const lastSent = history.find((it) => it.direction === 'out') ?? null;
    const todayReceived = history.filter(
      (it) => it.direction === 'in' && sameDay(it.created_at),
    ).length;

    paintHeader(status, integrations);
    paintStatus(status, integrations);
    paintToday(status, lastSent, todayReceived);
    paintStyle((configRes?.preferences?.default_tone as Tone) ?? 'casual');
    paintQuickActions(status);
    paintActivity(history);
  } catch (err) {
    const banner = document.getElementById('vox-status-card');
    if (banner) {
      banner.style.cssText = cardStyle('error');
      banner.innerHTML = '';
      banner.appendChild(
        el('div', {
          style: `font-weight: 600;`,
          text: 'Server unreachable',
        }),
      );
      banner.appendChild(
        el('div', {
          style: `font-size: 13px; opacity: 0.75; margin-top: 4px;`,
          text: err instanceof Error ? err.message : 'network error',
        }),
      );
    }
  }
}

/* --- header block ------------------------------------------------------- */

function headerBlock(_server: string): HTMLElement {
  const wrap = el('header', {
    style: `text-align: center; margin-bottom: 24px; padding-top: 8px;`,
  });
  wrap.appendChild(
    el('div', {
      style: `
        font-family: ${MONO}; font-size: 30px; font-weight: 700;
        letter-spacing: .28em; text-indent: .28em; color: #E5E5E5;
      `,
      text: 'VOX',
    }),
  );
  wrap.appendChild(
    el('div', {
      style: `
        font-size: 13px; opacity: 0.55; margin-top: 4px;
      `,
      text: 'voice-to-message for your G2',
    }),
  );
  wrap.appendChild(
    el('div', {
      id: 'vox-header-meta',
      style: `
        font-family: ${MONO}; font-size: 10px; letter-spacing: .12em;
        text-transform: uppercase; opacity: 0.42; margin-top: 10px;
        font-variant-numeric: tabular-nums;
      `,
      text: `v${APP_VERSION} · loading…`,
    }),
  );
  return wrap;
}

function paintHeader(_status: IdleStatus, integrations: IntegrationView[]): void {
  const meta = document.getElementById('vox-header-meta');
  if (!meta) return;
  const connected = integrations.filter((i) => i.configured && i.status !== 'error').length;
  meta.textContent = `v${APP_VERSION} · SDK ${SDK_VERSION} · ${connected} service${connected === 1 ? '' : 's'} connected`;
}

/* --- status card -------------------------------------------------------- */

function statusBlock(): HTMLElement {
  const card = el('section', { id: 'vox-status-card', style: cardStyle('loading') });
  // The status card is the one genuinely live surface, so it is the one
  // that carries the trace. If everything traces, nothing reads as live.
  card.className = 'vox-bracket vox-trace vox-rise';
  card.textContent = 'checking services…';
  return card;
}

function paintStatus(status: IdleStatus, integrations: IntegrationView[]): void {
  const card = document.getElementById('vox-status-card');
  if (!card) return;
  card.className = 'vox-bracket vox-trace';

  // Services worth surfacing on the home card. LLM providers are collapsed
  // into a single "AI" indicator (green if any one is configured + ok).
  const twilio = pickIntegration(integrations, 'twilio');
  const llmProviders = ['anthropic', 'openai', 'openrouter', 'ollama-cloud'] as const;
  const aiReady = llmProviders.some((p) => {
    const i = pickIntegration(integrations, p);
    return i?.configured && i.status !== 'error';
  });

  const checks: Array<{ label: string; ok: boolean }> = [
    { label: 'Twilio', ok: Boolean(twilio?.configured && status.twilio) },
    { label: 'Email', ok: Boolean(status.email) },
    { label: 'AI', ok: aiReady },
  ];
  const allOk = checks.every((c) => c.ok);
  const anyOk = checks.some((c) => c.ok);
  const state: CardState = allOk ? 'ok' : anyOk ? 'partial' : 'error';

  card.style.cssText = cardStyle(state);
  card.innerHTML = '';

  const top = el('div', {
    style: `display: flex; justify-content: space-between; align-items: baseline;`,
  });
  top.appendChild(
    el('div', {
      style: `font-family:${MONO}; font-weight: 600; font-size: 14px; letter-spacing:.04em;`,
      text: state === 'ok' ? 'all services ready' : state === 'partial' ? 'partially connected' : 'needs setup',
    }),
  );
  top.appendChild(
    el('a', {
      href: `${pairedServer}/integrations`,
      style: `font-size: 12px; opacity: 0.6; color: inherit; text-decoration: none;`,
      text: 'manage →',
    }),
  );
  card.appendChild(top);

  const row = el('div', {
    style: `display: flex; gap: 14px; margin-top: 10px; flex-wrap: wrap;`,
  });
  for (const c of checks) {
    const chip = el('div', {
      style: `
        display: inline-flex; align-items: center; gap: 6px;
        font-family: ${MONO}; font-size: 12px; letter-spacing: .1em;
        text-transform: uppercase; opacity: ${c.ok ? 1 : 0.45};
      `,
    });
    chip.appendChild(
      el('span', {
        style: `
          width: 7px; height: 7px; border-radius: 50%;
          background: ${c.ok ? PHOS : '#555'};
          display: inline-block;
          ${c.ok ? `box-shadow: 0 0 7px ${PHOS};` : ''}
        `,
      }),
    );
    chip.appendChild(el('span', { text: c.label }));
    row.appendChild(chip);
  }
  card.appendChild(row);
}

/* --- today block -------------------------------------------------------- */

function todayBlock(): HTMLElement {
  const wrap = el('section', { style: `margin-top: 22px;` });
  wrap.appendChild(sectionLabel('today'));
  const grid = el('div', {
    id: 'vox-today-grid',
    style: `
      display: grid; grid-template-columns: 1fr 1fr 1fr;
      gap: 8px; margin-bottom: 10px;
    `,
  });
  wrap.appendChild(grid);
  const line = el('div', {
    id: 'vox-today-last',
    style: `font-size: 13px; opacity: 0.75; margin-top: 4px;`,
    text: '',
  });
  wrap.appendChild(line);
  return wrap;
}

function paintToday(
  status: IdleStatus,
  lastSent: HistoryItem | null,
  received: number,
): void {
  const grid = document.getElementById('vox-today-grid');
  if (grid) {
    grid.innerHTML = '';
    grid.appendChild(statTile(status.today_sent, 'sent'));
    grid.appendChild(statTile(received, 'received'));
    grid.appendChild(statTile(status.today_failed, 'failed', status.today_failed > 0));
  }
  const line = document.getElementById('vox-today-last');
  if (line) {
    line.innerHTML = '';
    if (lastSent) {
      const method = lastSent.channel === 'sms' ? 'SMS' : 'Email';
      const ago = formatAgo(Date.now() - new Date(lastSent.created_at).getTime());
      line.textContent = `→ last: ${method} to ${lastSent.contact_name ?? 'unknown'} · ${ago}`;
    }
  }
}

function statTile(value: number, label: string, warn = false): HTMLElement {
  const tile = el('div', { 
    style: `
      position: relative;
      background: #151719;
      border: 1px solid ${warn ? '#3d2126' : '#2a2d31'};
      border-radius: 10px;
      padding: 14px 8px;
      text-align: center;
    `,
  });
  tile.appendChild(
    el('div', {
      style: `
        font-family: ${MONO}; font-size: 24px; font-weight: 700;
        letter-spacing: -.02em; line-height: 1;
        color: ${warn ? '#ff8c8c' : '#E5E5E5'};
        font-variant-numeric: tabular-nums;
      `,
      text: String(value),
    }),
  );
  tile.appendChild(
    el('div', {
      style: eyebrowStyle() + 'margin-top:8px;',
      text: label,
    }),
  );
  return tile;
}

/* --- message style ------------------------------------------------------ */

/**
 * Message style picker.
 *
 * This is the same `default_tone` preference the glasses Style menu writes
 * and that a new message starts in. Surfacing it here — rather than only
 * three taps deep in the dashboard SPA — is what makes "which style am I
 * sending in?" answerable from whichever surface the user happens to have
 * open, which is what the hardware feedback asked for.
 */
function styleBlock(server: string, secret: string): HTMLElement {
  const wrap = el('section', { style: `margin-top: 22px;` });
  wrap.appendChild(sectionLabel('message style'));

  const card = el('div', {
    id: 'vox-style-card',
    style: `
      position: relative;
      background: #151719; border: 1px solid #2a2d31;
      border-radius: 10px; padding: 14px;
    `,
  });
  card.className = 'vox-bracket';

  const current = el('div', {
    id: 'vox-style-current',
    style: `font-family:${MONO}; font-size:15px; font-weight:700;
            letter-spacing:.1em; text-transform:uppercase; margin-bottom:6px;`,
    text: 'loading…',
  });
  card.appendChild(current);
  card.appendChild(
    el('div', {
      style: `font-size: 12px; opacity: 0.55; margin-bottom: 12px;`,
      text: 'used on the glasses for every new message',
    }),
  );

  const row = el('div', {
    id: 'vox-style-chips',
    style: `display: flex; flex-wrap: wrap; gap: 6px;`,
  });
  for (const tone of TONES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.tone = tone;
    chip.textContent = tone;
    chip.style.cssText = chipStyle(false);
    chip.addEventListener('click', () => {
      void applyStyle(server, secret, tone);
    });
    row.appendChild(chip);
  }
  card.appendChild(row);
  wrap.appendChild(card);
  return wrap;
}

function chipStyle(active: boolean): string {
  return `
    padding: 8px 12px; border-radius: 999px; cursor: pointer;
    font-family: ${MONO}; font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; min-height: 34px;
    background: ${active ? '#39FF6A' : '#1f1f1f'};
    color: ${active ? '#101010' : '#E5E5E5'};
    border: 1px solid ${active ? '#39FF6A' : '#3a3a3a'};
    font-weight: ${active ? '600' : '400'};
  `;
}

function paintStyle(tone: Tone): void {
  const current = document.getElementById('vox-style-current');
  if (current) current.textContent = tone.charAt(0).toUpperCase() + tone.slice(1);
  const chips = document.getElementById('vox-style-chips');
  if (!chips) return;
  for (const node of Array.from(chips.children)) {
    const btn = node as HTMLButtonElement;
    btn.style.cssText = chipStyle(btn.dataset.tone === tone);
  }
}

async function applyStyle(server: string, secret: string, tone: Tone): Promise<void> {
  // Optimistic paint so the tap feels instant; hydrate() re-asserts the
  // server's value on the next poll if the write lost a race.
  paintStyle(tone);
  try {
    await fetch(`${server}/api/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ default_tone: tone }),
    });
  } catch (err) {
    console.warn('[companion] style save failed:', err);
    const current = document.getElementById('vox-style-current');
    if (current) current.textContent = "couldn't save — check connection";
  }
}

/* --- connect + passkey -------------------------------------------------- */

/**
 * Connecting the dashboard without typing anything.
 *
 * The companion already holds the shared secret, so making the user copy a
 * 32-character passkey into the dashboard was busywork we imposed on
 * ourselves. Tapping Open dashboard mints a single-use handoff token
 * (3-minute TTL, burned on first use) and follows a /connect link with it.
 * The permanent passkey never travels in a URL.
 *
 * The passkey is still revealable right here — for a device that can't
 * follow the link, or when you just need to see it — but it is masked by
 * default so the screen is safe to hold up or screenshot.
 */
function connectBlock(server: string, secret: string): HTMLElement {
  const wrap = el('section', { style: `margin-top: 22px;` });
  wrap.appendChild(sectionLabel('dashboard'));

  const card = el('div', {
    style: `position:relative; background:#151719; border:1px solid #2a2d31;
            border-radius:10px; padding:14px;`,
  });
  card.className = 'vox-bracket';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Open dashboard';
  btn.style.cssText = `
    display: block; width: 100%; padding: 14px; border-radius: 9px;
    background: ${PHOS}; color: #0a0b0d; border: 0; min-height: 44px;
    font-family: ${MONO}; font-size: 13px; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase; cursor: pointer;
  `;
  const status = el('div', {
    style: `font-size: 12px; opacity: 0.55; margin-top: 8px; text-align: center;`,
    text: 'signs you in automatically — no passkey to type',
  });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    void (async () => {
      try {
        const res = await fetch(`${server}/api/auth/handoff`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ purpose: 'dashboard' }),
        });
        const data = (await res.json()) as { token?: string };
        if (!res.ok || !data.token) throw new Error('could not create a connect code');
        // Carry a return address. Opening the dashboard REPLACES this WebView
        // — the Even Realities app draws no browser chrome around it, so
        // without this the user lands somewhere with no way back to VOX.
        const back = encodeURIComponent(window.location.href);
        window.location.href =
          `${server}/connect?t=${encodeURIComponent(data.token)}&from=${back}`;
      } catch (err) {
        // Falling back to the plain dashboard URL still works — it just asks
        // for the passkey, which is exactly the old behaviour.
        console.warn('[companion] handoff failed, opening dashboard directly:', err);
        status.textContent = "couldn't auto-connect — opening sign-in";
        window.location.href = `${server}/?from=${encodeURIComponent(window.location.href)}`;
      }
    })();
  });

  card.appendChild(btn);
  card.appendChild(status);

  // --- reveal ---
  const revealRow = el('div', {
    style: `
      margin-top: 14px; padding-top: 12px; border-top: 1px solid #333;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
    `,
  });
  const value = el('code', {
    id: 'vox-passkey',
    style: `
      font-size: 13px; letter-spacing: 1px; opacity: 0.75;
      overflow-wrap: anywhere; min-width: 0; flex: 1 1 auto;
      font-family: ui-monospace, Menlo, monospace;
    `,
    text: MASK,
  });
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Show';
  toggle.style.cssText = `
    flex: 0 0 auto; padding: 9px 12px; border-radius: 7px; cursor: pointer;
    background: #1f2225; color: #E5E5E5; border: 1px solid #2a2d31;
    font-family: ${MONO}; font-size: 11px; letter-spacing: .12em;
    text-transform: uppercase; min-height: 38px;
  `;
  let shown = false;
  toggle.addEventListener('click', () => {
    shown = !shown;
    value.textContent = shown ? secret : MASK;
    toggle.textContent = shown ? 'Hide' : 'Show';
  });
  revealRow.appendChild(value);
  revealRow.appendChild(toggle);
  card.appendChild(el('div', { style: eyebrowStyle() + 'margin-top:14px;', text: 'passkey' }));
  card.appendChild(revealRow);

  wrap.appendChild(card);
  return wrap;
}

/** Fixed-width mask — shorter than the real key so it never wraps. */
const MASK = '••••••••••••••••••••';

/* --- quick actions ------------------------------------------------------ */

function quickActionsBlock(server: string): HTMLElement {
  const wrap = el('section', { style: `margin-top: 22px;` });
  wrap.appendChild(sectionLabel('quick actions'));
  const grid = el('div', {
    id: 'vox-actions-grid',
    style: `
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 8px;
    `,
  });
  wrap.appendChild(grid);
  // Painted lazily so we can annotate inbox with unread count once we have it.
  grid.appendChild(actionCard(`${server}/inbox`, 'Inbox', 'vox-action-inbox'));
  grid.appendChild(actionCard(`${server}/contacts`, 'Contacts', 'vox-action-contacts'));
  grid.appendChild(actionCard(`${server}/activity`, 'Activity', 'vox-action-activity'));
  grid.appendChild(actionCard(`${server}/preferences`, 'Preferences', 'vox-action-prefs'));
  return wrap;
}

function paintQuickActions(status: IdleStatus): void {
  const inbox = document.getElementById('vox-action-inbox-badge');
  if (inbox) {
    inbox.textContent = status.unread > 0 ? `${status.unread} unread` : 'no new';
    inbox.style.color = status.unread > 0 ? '#39FF6A' : '';
    inbox.style.opacity = status.unread > 0 ? '1' : '0.5';
  }
}

function actionCard(href: string, label: string, id: string): HTMLElement {
  const link = document.createElement('a');
  link.href = href;
  link.style.cssText = `
    display: block; padding: 14px;
    background: #151719; border: 1px solid #2a2d31;
    border-radius: 10px; text-decoration: none;
    color: inherit;
  `;
  link.appendChild(
    el('div', {
      style: `font-family:${MONO}; font-size:13px; font-weight:600; letter-spacing:.06em;`,
      text: label,
    }),
  );
  link.appendChild(
    el('div', {
      id: `${id}-badge`,
      style: eyebrowStyle() + 'margin-top:6px;',
      text: 'open →',
    }),
  );
  return link;
}

/* --- activity feed ------------------------------------------------------ */

function activityBlock(): HTMLElement {
  const wrap = el('section', { style: `margin-top: 24px;` });
  wrap.appendChild(sectionLabel('recent activity'));
  const feed = el('div', { id: 'vox-activity', style: `display: flex; flex-direction: column; gap: 8px;` });
  wrap.appendChild(feed);
  return wrap;
}

function paintActivity(history: HistoryItem[]): void {
  const feed = document.getElementById('vox-activity');
  if (!feed) return;
  feed.innerHTML = '';
  if (history.length === 0) {
    feed.appendChild(
      el('div', {
        style: `
          padding: 24px 16px; opacity: 0.5; text-align: center;
          background: #262626; border: 1px dashed #333; border-radius: 10px;
        `,
        text: 'no messages yet — send your first from the glasses',
      }),
    );
    return;
  }
  for (const item of history) feed.appendChild(activityRow(item));
}

function activityRow(item: HistoryItem): HTMLElement {
  const direction = item.direction === 'out' ? '→' : '←';
  const channel = item.channel === 'sms' ? 'SMS' : 'EMAIL';
  const name = item.contact_name ?? '(unknown)';
  const body = item.body.length > 90 ? item.body.slice(0, 89) + '…' : item.body;
  const ago = formatAgo(Date.now() - new Date(item.created_at).getTime());

  const row = el('div', {
    style: `
      padding: 12px 14px;
      border: 1px solid #2a2d31;
      border-radius: 10px;
      background: #151719;
    `,
  });
  const head = el('div', {
    style: `display: flex; justify-content: space-between; align-items: baseline; font-size: 13px;`,
  });
  head.appendChild(
    el('span', {
      style: `font-family:${MONO}; font-size:12px; font-weight:600;`,
      text: `${direction} ${name}`,
    }),
  );
  head.appendChild(
    el('span', {
      style: `font-family:${MONO}; font-size:10px; letter-spacing:.1em;
              text-transform:uppercase; opacity:.5;`,
      text: `${channel} · ${ago}`,
    }),
  );
  row.appendChild(head);
  row.appendChild(
    el('div', {
      style: `margin-top: 6px; font-size: 14px; opacity: 0.88; overflow-wrap: anywhere;`,
      text: body,
    }),
  );
  if (item.status !== 'sent' && item.status !== 'received' && item.status !== 'delivered') {
    row.appendChild(
      el('div', {
        style: `margin-top:4px; font-family:${MONO}; font-size:10px;
                letter-spacing:.12em; opacity:.55;`,
        text: item.status.toUpperCase(),
      }),
    );
  }
  return row;
}

/* --- footer ------------------------------------------------------------- */

function footerBlock(server: string): HTMLElement {
  const wrap = el('footer', {
    style: `
      margin-top: 32px; padding-top: 20px; border-top: 1px solid #333;
      text-align: center; font-size: 12px; opacity: 0.5;
    `,
  });
  wrap.appendChild(
    el('div', {
      style: `margin-bottom: 6px;`,
      text: 'Manage contacts, templates, integrations',
    }),
  );
  const link = document.createElement('a');
  link.href = server;
  link.style.cssText = `color:${PHOS}; text-decoration:none; font-family:${MONO};
                        font-size:12px; letter-spacing:.06em;`;
  link.textContent = stripProto(server);
  wrap.appendChild(link);
  wrap.appendChild(
    el('div', {
      style: eyebrowStyle() + 'margin-top:12px;',
      text: `VOX v${APP_VERSION} · SDK ${SDK_VERSION}`,
    }),
  );
  return wrap;
}

/* --- unpaired ----------------------------------------------------------- */

/**
 * Resolve the credential this install should use.
 *
 * KVS first: a pairing the user completed always wins. EMBEDDED_CONFIG is the
 * fallback for development builds that still bake values in via hud/.env —
 * the public .ehpk is built with those unset, so this returns null there and
 * the pairing screen takes over.
 */
async function resolvePairing(): Promise<Pairing | null> {
  const stored = await getPairing();
  if (stored) return stored;
  const { server, secret } = EMBEDDED_CONFIG;
  if (server && secret) return { server, secret };
  return null;
}

/**
 * First-run pairing screen.
 *
 * This is the phone surface, so it is the only place in VOX with a keyboard —
 * the glasses have click, scroll and long-press and nothing else. Everything
 * pairing needs to accept typed input therefore lives here, and the HUD shows
 * a "pair on your phone" card instead.
 */
function pairingScreen(onPaired: () => void): HTMLElement {
  const wrap = el('div', {
    style: `
      min-height: 100vh; display: flex; flex-direction: column;
      justify-content: center; padding: 32px 20px; box-sizing: border-box;
      max-width: 520px; margin: 0 auto; width: 100%;
    `,
  });

  wrap.appendChild(
    el('div', {
      style: `font-family:${MONO}; font-size: 11px; letter-spacing:.18em;
              text-transform: uppercase; opacity:.55;`,
      text: 'Setup',
    }),
  );
  wrap.appendChild(
    el('div', { style: `font-size: 34px; font-weight: 700; margin-top: 6px;`, text: 'Connect VOX' }),
  );
  wrap.appendChild(
    el('p', {
      style: `margin-top: 10px; opacity:.7; font-size: 15px; line-height: 1.5;`,
      text:
        'VOX runs on a server you host, so nothing you send passes through anyone ' +
        "else's infrastructure. Open your VOX dashboard, generate a pairing link, " +
        'and paste it here.',
    }),
  );

  const input = document.createElement('input');
  input.type = 'url';
  input.inputMode = 'url';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'https://your-server/p/ABCD-1234';
  input.style.cssText = `
    margin-top: 22px; width: 100%; box-sizing: border-box;
    padding: 14px 14px; border-radius: 10px;
    border: 1px solid rgba(57,255,106,.35); background: rgba(0,0,0,.35);
    color: inherit; font-family:${MONO}; font-size: 16px;
  `;
  wrap.appendChild(input);

  const status = el('div', {
    style: `margin-top: 12px; min-height: 20px; font-size: 14px; line-height:1.4;`,
  });
  wrap.appendChild(status);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Pair this device';
  button.style.cssText = `
    margin-top: 8px; width: 100%; padding: 15px; border-radius: 10px;
    border: 1px solid rgba(57,255,106,.5); background: rgba(57,255,106,.12);
    color: inherit; font-family:${MONO}; font-size: 15px; font-weight: 600;
    letter-spacing: .04em; cursor: pointer; min-height: 48px;
  `;
  wrap.appendChild(button);

  wrap.appendChild(
    el('p', {
      style: `margin-top: 20px; opacity:.5; font-size: 13px; line-height:1.5;`,
      text:
        "Don't have a server yet? The README at github.com/ablakateam/evenrealitiesG2 " +
        'walks through deploying one.',
    }),
  );

  const setStatus = (text: string, tone: 'error' | 'busy' | 'ok'): void => {
    status.textContent = text;
    status.style.color =
      tone === 'error' ? '#ff8a8a' : tone === 'ok' ? 'rgba(57,255,106,.95)' : 'inherit';
    status.style.opacity = tone === 'busy' ? '.7' : '1';
  };

  const submit = async (): Promise<void> => {
    const parsed = parsePairingLink(input.value);
    if (!parsed) {
      setStatus('That does not look like a pairing link. It ends in /p/ and an 8-character code.', 'error');
      return;
    }
    button.disabled = true;
    setStatus(`Connecting to ${parsed.server.replace(/^https?:\/\//, '')}…`, 'busy');
    try {
      await claimPairing(parsed.server, parsed.code);
      setStatus('Paired. Loading your dashboard…', 'ok');
      onPaired();
    } catch (err) {
      setStatus(
        err instanceof PairingError ? err.message : 'Pairing failed. Generate a fresh code and try again.',
        'error',
      );
      button.disabled = false;
    }
  };

  button.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void submit();
  });

  return wrap;
}

/* --- tiny helpers ------------------------------------------------------- */

function pickIntegration(
  list: IntegrationView[],
  provider: IntegrationView['provider'],
): IntegrationView | undefined {
  return list.find((i) => i.provider === provider);
}

function sameDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

type CardState = 'loading' | 'ok' | 'partial' | 'error';

function cardStyle(state: CardState): string {
  const map: Record<CardState, { bg: string; border: string }> = {
    loading: { bg: '#151719', border: '#2a2d31' },
    ok: { bg: '#111a13', border: '#1f3a24' },
    partial: { bg: '#1a1710', border: '#3a3320' },
    error: { bg: '#1c1113', border: '#3d2126' },
  };
  const { bg, border } = map[state];
  return `
    position: relative;
    padding: 14px 16px;
    border: 1px solid ${border};
    border-radius: 12px;
    background: ${bg};
  `;
}

function sectionLabel(text: string): HTMLElement {
  const wrap = el('div', {
    style: `display:flex; align-items:center; gap:8px; margin-bottom:10px;`,
  });
  wrap.appendChild(el('span', { style: `display:inline-block; width:14px; height:1px; background:${PHOS}; opacity:.55;` }));
  wrap.appendChild(el('span', { style: eyebrowStyle(), text }));
  return wrap;
}

function el(
  tag: string,
  opts: { style?: string; text?: string; id?: string; href?: string } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.style) node.style.cssText = opts.style;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.id) node.id = opts.id;
  if (opts.href && tag === 'a') (node as HTMLAnchorElement).href = opts.href;
  return node;
}

function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
