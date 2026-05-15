import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { apiPost } from '../api.js';
import { stagePrefillForReply } from '../draft.js';
import { ComposePage } from './compose.js';
import type { InboxItem } from './inbox.js';

/**
 * Inbox read view — shows the full body of one inbox item as list lines
 * (so it scrolls natively when the body is long). Tap → start a reply
 * with TO + VIA locked to the sender.
 *
 * Marks the item read via /api/inbox/:id/read on mount (fire-and-forget).
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

export function makeInboxReadPage(item: InboxItem): Page {
  return {
    id: 'inbox-read',

    async mount(ctx: PageContext): Promise<void> {
      // Mark as read in the background.
      if (!item.read_at) {
        void apiPost(`/api/inbox/${item.id}/read`).catch(() => {});
      }

      const title = clip(`${item.channel.toUpperCase()}  ${item.from_address}`, 56);
      const lines = bodyToLines(item);

      await showPage(ctx.bridge, {
        texts: [
          { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: title },
          {
            id: FOOTER_ID,
            x: 0,
            y: 236,
            w: 576,
            h: 48,
            capture: false,
            content: '[TAP] reply  [SCRL] read  [X2] back',
          },
        ],
        lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items: lines }],
      });
    },

    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      if (event.kind !== 'list-select') return;
      // Stage the reply prefill so when ComposePage's transcribe completes,
      // the new draft is built with TO + VIA already filled and locked.
      const isEmail = item.channel === 'email';
      stagePrefillForReply({
        recipient: {
          id: item.contact_id,
          name: senderName(item),
          phone: !isEmail ? item.from_address : null,
          email: isEmail ? item.from_address : null,
        },
        channel: item.channel,
        replyContext: {
          inbox_id: item.id,
          from_name: senderName(item),
          from_address: item.from_address,
          original_body: item.body,
          channel: item.channel,
        },
        locked: { recipient: true, channel: true },
      });
      await ctx.router.push(ComposePage);
    },
  };
}

function senderName(item: InboxItem): string {
  // Full address — works for both SMS (E.164 phone) and email. Keeps the
  // reply Confirm title meaningful instead of just the local part.
  return item.from_address;
}

function bodyToLines(item: InboxItem): string[] {
  // For email, show the subject as the first list item (visually distinct),
  // then the body. Each list item caps at 32 chars (P13 SDK quirk).
  const out: string[] = [];
  if (item.channel === 'email' && item.subject) {
    out.push(`Re: ${clip(item.subject, 28)}`);
    out.push('');
  }
  // Soft-wrap body at ~30 chars per line so the native list renders cleanly.
  for (const line of softWrap(item.body, 30)) {
    out.push(line);
    if (out.length >= 18) break;
  }
  return out;
}

function softWrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    if (para.length <= width) {
      out.push(para);
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width) {
        out.push(line.trim());
        line = w;
      } else {
        line = (line + ' ' + w).trim();
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}
