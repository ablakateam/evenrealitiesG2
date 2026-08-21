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

/* --- root shell + boot -------------------------------------------------- */

export function renderCompanion(root: HTMLElement): void {
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
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0;
  `;

  const { server, secret } = EMBEDDED_CONFIG;
  if (!server || !secret) {
    root.appendChild(unpairedScreen());
    return;
  }

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

  wrap.appendChild(headerBlock(server));
  wrap.appendChild(statusBlock());
  wrap.appendChild(todayBlock());
  wrap.appendChild(styleBlock(server, secret));
  wrap.appendChild(connectBlock(server, secret));
  wrap.appendChild(quickActionsBlock(server));
  wrap.appendChild(activityBlock());
  wrap.appendChild(footerBlock(server));

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
        font-size: 32px; font-weight: 700; letter-spacing: -0.5px;
        color: #E5E5E5;
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
        font-size: 11px; opacity: 0.4; margin-top: 8px;
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
  card.textContent = 'checking services…';
  return card;
}

function paintStatus(status: IdleStatus, integrations: IntegrationView[]): void {
  const card = document.getElementById('vox-status-card');
  if (!card) return;

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
      style: `font-weight: 600; font-size: 17px;`,
      text: state === 'ok' ? 'all services ready' : state === 'partial' ? 'partially connected' : 'needs setup',
    }),
  );
  top.appendChild(
    el('a', {
      href: `${EMBEDDED_CONFIG.server ?? window.location.origin}/integrations`,
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
        font-size: 14px; opacity: ${c.ok ? 1 : 0.5};
      `,
    });
    chip.appendChild(
      el('span', {
        style: `
          width: 8px; height: 8px; border-radius: 50%;
          background: ${c.ok ? '#39FF6A' : '#666'};
          display: inline-block;
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
      background: #262626;
      border: 1px solid ${warn ? '#5a3030' : '#333'};
      border-radius: 10px;
      padding: 14px 8px;
      text-align: center;
    `,
  });
  tile.appendChild(
    el('div', {
      style: `
        font-size: 26px; font-weight: 700;
        color: ${warn ? '#ff8c8c' : '#E5E5E5'};
        font-variant-numeric: tabular-nums;
      `,
      text: String(value),
    }),
  );
  tile.appendChild(
    el('div', {
      style: `font-size: 11px; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;`,
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
      background: #262626; border: 1px solid #333;
      border-radius: 10px; padding: 14px;
    `,
  });

  const current = el('div', {
    id: 'vox-style-current',
    style: `font-size: 15px; font-weight: 600; margin-bottom: 4px;`,
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
    padding: 7px 12px; border-radius: 999px; cursor: pointer;
    font: inherit; font-size: 13px; text-transform: capitalize;
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
    style: `background: #262626; border: 1px solid #333; border-radius: 10px; padding: 14px;`,
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Open dashboard';
  btn.style.cssText = `
    display: block; width: 100%; padding: 13px; border-radius: 9px;
    background: #39FF6A; color: #101010; border: 0;
    font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
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
    flex: 0 0 auto; padding: 7px 12px; border-radius: 7px; cursor: pointer;
    background: #1f1f1f; color: #E5E5E5; border: 1px solid #3a3a3a;
    font: inherit; font-size: 13px;
  `;
  let shown = false;
  toggle.addEventListener('click', () => {
    shown = !shown;
    value.textContent = shown ? secret : MASK;
    toggle.textContent = shown ? 'Hide' : 'Show';
  });
  revealRow.appendChild(value);
  revealRow.appendChild(toggle);
  card.appendChild(el('div', { style: `font-size: 11px; opacity: 0.4; margin-top: 14px;`, text: 'PASSKEY' }));
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
    background: #262626; border: 1px solid #333;
    border-radius: 10px; text-decoration: none;
    color: inherit;
  `;
  link.appendChild(
    el('div', {
      style: `font-size: 15px; font-weight: 600;`,
      text: label,
    }),
  );
  link.appendChild(
    el('div', {
      id: `${id}-badge`,
      style: `font-size: 12px; opacity: 0.5; margin-top: 4px;`,
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
      border: 1px solid #333;
      border-radius: 10px;
      background: #262626;
    `,
  });
  const head = el('div', {
    style: `display: flex; justify-content: space-between; align-items: baseline; font-size: 13px;`,
  });
  head.appendChild(el('span', { style: `font-weight: 600;`, text: `${direction} ${name}` }));
  head.appendChild(
    el('span', { style: `opacity: 0.55; font-size: 11px;`, text: `${channel} · ${ago}` }),
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
        style: `margin-top: 4px; font-size: 11px; opacity: 0.55; font-style: italic;`,
        text: item.status,
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
  link.style.cssText = `color: #39FF6A; text-decoration: none; font-weight: 500;`;
  link.textContent = stripProto(server);
  wrap.appendChild(link);
  wrap.appendChild(
    el('div', {
      style: `margin-top: 12px; font-size: 10px; opacity: 0.5;`,
      text: `VOX v${APP_VERSION} · SDK ${SDK_VERSION}`,
    }),
  );
  return wrap;
}

/* --- unpaired ----------------------------------------------------------- */

function unpairedScreen(): HTMLElement {
  const div = el('div', {
    style: `
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 32px; text-align: center;
    `,
  });
  div.appendChild(el('div', { style: `font-size: 40px; font-weight: 700;`, text: 'VOX' }));
  div.appendChild(
    el('p', {
      style: `margin-top: 12px; opacity: 0.7; max-width: 320px; font-size: 15px;`,
      text: 'Not paired yet. Finish setup on the VOX dashboard to connect this install.',
    }),
  );
  return div;
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
    loading: { bg: '#262626', border: '#333' },
    ok: { bg: '#1f2f1f', border: '#305a30' },
    partial: { bg: '#2f2b1f', border: '#5a4a30' },
    error: { bg: '#3a1f1f', border: '#5a3030' },
  };
  const { bg, border } = map[state];
  return `
    padding: 14px 16px;
    border: 1px solid ${border};
    border-radius: 12px;
    background: ${bg};
  `;
}

function sectionLabel(text: string): HTMLElement {
  return el('div', {
    style: `
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
      opacity: 0.5; margin-bottom: 10px; font-weight: 500;
    `,
    text,
  });
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
