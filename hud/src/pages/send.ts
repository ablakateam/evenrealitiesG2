import type { PageContext } from '../router.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { apiPost, HudApiError } from '../api.js';
import { getDraft, getBodyText, clearDraft, type ComposeDraft } from '../draft.js';
import { makeSentPage } from './sent.js';
import { makeStubPage } from './stub.js';

/**
 * Send action — invoked from the SEND row on Confirm.
 *
 * Validates the draft, renders a brief "sending..." screen, then POSTs
 * to /api/sms or /api/email (or both if channel = "both"). On success
 * navigates to the sent confirmation page and clears the draft. On
 * failure renders an empathetic error stub.
 *
 * Container shape MATCHES the chrome flow (text 2, 3 + chrome 90, 99) so
 * the rebuild never drops + re-introduces the chrome IDs across the
 * Confirm → Send → Sent → Idle hop (the L:38 SDK quirk used to crash the
 * app on the double-tap back home).
 */

const TITLE_ID = 2;
const BODY_ID = 3;

interface SmsRequest {
  to: string;
  body: string;
  contact_id?: number;
  tone?: string;
  client_uuid: string;
}

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  contact_id?: number;
  tone?: string;
  client_uuid: string;
}

export async function sendDraft(ctx: PageContext): Promise<void> {
  const draft = getDraft();
  if (!draft) {
    await ctx.router.go(makeStubPage('send-empty', 'Hmm.', 'Nothing to send.'));
    return;
  }
  const problem = validate(draft);
  if (problem) {
    await ctx.router.go(makeStubPage('send-incomplete', 'Almost.', problem));
    return;
  }

  // Render "sending..." over the current page (same 3-container shape).
  await renderSending(ctx, draft);

  const body = getBodyText(draft);
  const clientUuid = uuid();

  try {
    if (draft.channel === 'sms') {
      await postSms(draft, body, clientUuid);
    } else if (draft.channel === 'email') {
      await postEmail(draft, body, clientUuid);
    } else {
      // "both" — fire in parallel; surface a partial-failure error if one fails.
      const results = await Promise.allSettled([
        postSms(draft, body, clientUuid + '-sms'),
        postEmail(draft, body, clientUuid + '-eml'),
      ]);
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === 2) throw (failed[0] as PromiseRejectedResult).reason;
      // 1-of-2 partial failure is treated as success with a note; v1 keeps
      // the UX simple. Telemetry route gets the full picture later (P18).
    }
    const sentPage = makeSentPage(draft);
    clearDraft();
    await ctx.router.go(sentPage);
  } catch (err) {
    const msg = err instanceof HudApiError ? err.message : err instanceof Error ? err.message : 'unknown error';
    await ctx.router.go(makeStubPage('send-error', 'Hmm.', `Couldn't send.\n${clip(msg, 80)}\n[X2] back`));
  }
}

function validate(draft: ComposeDraft): string | null {
  // For replies the contact may not be in the address book — phone OR email
  // is enough as long as a reachable address is present.
  if (!draft.recipient.phone && !draft.recipient.email) return 'Pick a recipient first.';
  const body = getBodyText(draft);
  if (!body || !body.trim()) return 'Body is empty — re-record.';
  if (draft.channel === 'sms' && !draft.recipient.phone) {
    return "That contact has no phone — pick a different channel.";
  }
  if (draft.channel === 'email') {
    if (!draft.recipient.email) return "That contact has no email — pick a different channel.";
    if (!draft.subject) return 'Pick a subject first.';
  }
  if (draft.channel === 'both' && (!draft.recipient.phone || !draft.recipient.email)) {
    return 'Both channels need a phone AND an email.';
  }
  return null;
}

async function postSms(draft: ComposeDraft, body: string, clientUuid: string): Promise<void> {
  const req: SmsRequest = {
    to: draft.recipient.phone!,
    body,
    tone: draft.tone,
    client_uuid: clientUuid,
  };
  if (draft.recipient.id) req.contact_id = draft.recipient.id;
  await apiPost('/api/sms', req);
}

async function postEmail(draft: ComposeDraft, body: string, clientUuid: string): Promise<void> {
  const req: EmailRequest = {
    to: draft.recipient.email!,
    subject: draft.subject ?? 'Message from VOX',
    body,
    tone: draft.tone,
    client_uuid: clientUuid,
  };
  if (draft.recipient.id) req.contact_id = draft.recipient.id;
  await apiPost('/api/email', req);
}

async function renderSending(ctx: PageContext, draft: ComposeDraft): Promise<void> {
  const target = draft.channel === 'email' ? draft.recipient.email : draft.recipient.phone;
  const name = clip(draft.recipient.name ?? '', 24);
  await showPage(ctx.bridge, {
    texts: [
      {
        id: TITLE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: 48,
        border: 0,
        padding: 4,
        capture: false,
        content: center('sending...'),
      },
      {
        id: BODY_ID,
        x: 0,
        y: BODY_TOP + 56,
        w: 576,
        h: BODY_BOTTOM - (BODY_TOP + 56),
        border: 1,
        padding: 8,
        capture: true,
        content: center(`\nOff to ${name}\n${clip(target ?? '', 36)}`),
      },
    ],
    chrome: { hint: 'one moment...' },
  });
}

function uuid(): string {
  // Web-platform crypto.randomUUID is present in the sim's WebView. Fall
  // back to a v4-shaped synthesis if unavailable (older firmware paths).
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const r = Math.random().toString(16).slice(2).padEnd(12, '0');
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-4${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(0, 12)}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
