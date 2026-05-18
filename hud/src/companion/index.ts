/**
 * Phone WebView companion UI.
 *
 * Loaded when the Even Hub host opens VOX on the phone instead of the
 * glasses (detected in main.ts by the absence of an evenAppBridge after
 * a short timeout). Pure DOM + fetch — no framework, no router; this is
 * a lightweight read-mostly status surface, not a second product.
 *
 * v1 surfaces:
 *   - top banner: server reachable, today's send count, last sent
 *   - recent activity feed: last 10 outbound + inbound items, tappable
 *   - footer: link out to the VOX server domain for heavy config
 *
 * Auth: the same VITE_VOX_SECRET inlined into the .ehpk by pack.sh.
 * Network: HTTPS fetch directly to the VOX server (whitelisted via
 * app.json so the WebView's CORS sandbox lets the call through).
 */

import { EMBEDDED_CONFIG } from '../embedded-config.js';

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

export function renderCompanion(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = `
    height: 100%;
    background: #232323;
    color: #E5E5E5;
    font: 15px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    overflow-y: auto;
    padding: 0;
    -webkit-overflow-scrolling: touch;
  `;

  const { server, secret } = EMBEDDED_CONFIG;
  if (!server || !secret) {
    root.appendChild(unpairedScreen());
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = `padding: 16px; max-width: 480px; margin: 0 auto;`;
  root.appendChild(wrap);

  const titleBar = el('div', { style: `
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px;
  ` });
  titleBar.appendChild(el('h1', { style: `
    margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.3px;
  `, text: 'VOX' }));
  titleBar.appendChild(el('span', { style: `
    font-size: 12px; opacity: 0.6;
  `, text: 'phone companion' }));
  wrap.appendChild(titleBar);

  const banner = el('div', { id: 'vox-banner', style: bannerStyle('loading') });
  banner.textContent = 'loading...';
  wrap.appendChild(banner);

  const activitySection = el('div', { style: `margin-top: 20px;` });
  activitySection.appendChild(el('div', { style: `
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px;
    opacity: 0.55; margin-bottom: 8px;
  `, text: 'recent activity' }));
  const activityList = el('div', { id: 'vox-activity' });
  activitySection.appendChild(activityList);
  wrap.appendChild(activitySection);

  const footer = el('div', { style: `
    margin-top: 24px; padding-top: 16px;
    border-top: 1px solid #3a3a3a;
    font-size: 13px; opacity: 0.7; text-align: center;
  ` });
  footer.appendChild(el('div', { text: 'For full settings, contacts, and integrations:' }));
  footer.appendChild(el('div', { style: 'margin-top: 4px;',
    text: server.replace(/^https?:\/\//, '') }));
  wrap.appendChild(footer);

  void hydrate(server, secret);
}

async function hydrate(server: string, secret: string): Promise<void> {
  const banner = document.getElementById('vox-banner');
  const activity = document.getElementById('vox-activity');
  if (!banner || !activity) return;

  const auth = { Authorization: `Bearer ${secret}` };
  let status: IdleStatus | null = null;
  let history: HistoryItem[] = [];
  let lastSent: HistoryItem | null = null;

  try {
    const [s, h] = await Promise.all([
      fetch(`${server}/api/idle-suggestions`, { headers: auth }).then((r) => r.json()),
      fetch(`${server}/api/history?limit=10`, { headers: auth }).then((r) => r.json()),
    ]);
    status = s.status;
    history = h.items ?? [];
    lastSent = history.find((it) => it.direction === 'out' && it.status === 'sent') ?? null;
  } catch (err) {
    banner.style.cssText = bannerStyle('error');
    banner.textContent = `couldn't reach server (${err instanceof Error ? err.message : 'network'})`;
    return;
  }

  // --- Banner ---------------------------------------------------------
  banner.style.cssText = bannerStyle('ok');
  banner.innerHTML = '';
  const row1 = el('div', { style: `display: flex; justify-content: space-between; align-items: center;` });
  const ok = status?.twilio && status?.email;
  row1.appendChild(el('span', { style: `font-weight: 600; font-size: 16px;`,
    text: ok ? 'connected' : 'partial' }));
  row1.appendChild(el('span', { style: `font-size: 13px; opacity: 0.75;`,
    text: `${status?.today_sent ?? 0} sent · ${status?.today_failed ?? 0} failed · ${status?.unread ?? 0} unread today` }));
  banner.appendChild(row1);
  if (lastSent) {
    const ago = formatAgo(Date.now() - new Date(lastSent.created_at).getTime());
    const method = lastSent.channel === 'sms' ? 'SMS' : 'Email';
    banner.appendChild(el('div', { style: `margin-top: 6px; font-size: 13px; opacity: 0.7;`,
      text: `last: ${method} to ${lastSent.contact_name ?? 'unknown'} — ${ago}` }));
  }

  // --- Activity feed --------------------------------------------------
  activity.innerHTML = '';
  if (history.length === 0) {
    activity.appendChild(el('div', { style: `padding: 16px; opacity: 0.6; text-align: center;`,
      text: 'no activity yet — send your first message from the glasses.' }));
    return;
  }
  for (const item of history) {
    activity.appendChild(activityRow(item));
  }
}

function activityRow(item: HistoryItem): HTMLElement {
  const direction = item.direction === 'out' ? '→' : '←';
  const channel = item.channel === 'sms' ? 'SMS' : 'EMAIL';
  const name = item.contact_name ?? '(unknown)';
  const body = item.body.length > 80 ? item.body.slice(0, 79) + '…' : item.body;
  const ago = formatAgo(Date.now() - new Date(item.created_at).getTime());
  const status = item.status;

  const row = el('div', { style: `
    padding: 10px 12px;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    margin-bottom: 8px;
    background: #2a2a2a;
  ` });

  const head = el('div', { style: `
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 13px;
  ` });
  head.appendChild(el('span', { style: `font-weight: 600;`,
    text: `${direction} ${name}` }));
  head.appendChild(el('span', { style: `opacity: 0.55; font-size: 11px;`,
    text: `${channel} · ${ago}` }));
  row.appendChild(head);

  row.appendChild(el('div', { style: `
    margin-top: 6px; font-size: 14px; opacity: 0.88; word-wrap: break-word;
  `, text: body }));

  if (status !== 'sent' && status !== 'received') {
    row.appendChild(el('div', { style: `
      margin-top: 4px; font-size: 11px; opacity: 0.55; font-style: italic;
    `, text: status }));
  }
  return row;
}

function unpairedScreen(): HTMLElement {
  const div = el('div', { style: `
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 32px; text-align: center;
  ` });
  div.appendChild(el('h1', { style: `margin: 0; font-size: 24px;`, text: 'VOX' }));
  div.appendChild(el('p', { style: `margin-top: 16px; opacity: 0.7; max-width: 320px;`,
    text: 'Not paired yet — finish setup on the VOX dashboard to connect this install to your server.' }));
  return div;
}

/* --- tiny DOM helper -------------------------------------------------- */

function el(
  tag: string,
  opts: { style?: string; text?: string; id?: string } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.style) node.style.cssText = opts.style;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.id) node.id = opts.id;
  return node;
}

function bannerStyle(state: 'loading' | 'ok' | 'error'): string {
  const bg = state === 'error' ? '#3a1f1f' : state === 'ok' ? '#1f2f1f' : '#2a2a2a';
  const border = state === 'error' ? '#5a3030' : state === 'ok' ? '#305a30' : '#3a3a3a';
  return `
    padding: 12px 14px;
    border: 1px solid ${border};
    border-radius: 10px;
    background: ${bg};
  `;
}

function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
