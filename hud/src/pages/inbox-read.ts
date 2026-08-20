import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { apiPost } from '../api.js';
import { stagePrefillForReply } from '../draft.js';
import { ComposePage } from './compose.js';
import type { InboxItem } from './inbox.js';

/**
 * Inbox read view — the full body of one message, rendered as list rows so
 * the firmware scrolls it natively. Tapping the reply row starts a reply
 * with TO + VIA locked to the sender.
 *
 * Marks the item read via /api/inbox/:id/read on mount (fire-and-forget).
 *
 * Shape: chrome + title text 2 + list 5 (see the note in inbox.ts — this
 * page carried the same pre-chrome {1, 2, 3} shape).
 */

const TITLE_ID = 2;
const LIST_ID = 5;

const TITLE_H = 26;
const LIST_Y = BODY_TOP + TITLE_H + 4;
const LIST_H = BODY_BOTTOM - LIST_Y;

const REPLY_LABEL = '── reply ──';
const MAX_BODY_ROWS = 17; // 20-item cap minus reply row + spacer headroom

export function makeInboxReadPage(item: InboxItem): Page {
  return {
    id: 'inbox-read',

    async mount(ctx: PageContext): Promise<void> {
      if (!item.read_at) {
        void apiPost(`/api/inbox/${item.id}/read`).catch(() => {});
      }

      const title = clip(`${item.channel.toUpperCase()}  ${item.from_address}`, 46);
      // Reply is the FIRST row, not a trailing one: it is the only action on
      // this page and the wearer should not have to scroll a long body to
      // find it.
      const rows = [REPLY_LABEL, ...bodyToLines(item)];

      await showPage(ctx.bridge, {
        texts: [
          {
            id: TITLE_ID,
            x: 0,
            y: BODY_TOP,
            w: 576,
            h: TITLE_H,
            border: 0,
            padding: 4,
            capture: false,
            content: center(title),
          },
        ],
        lists: [
          {
            id: LIST_ID,
            x: 0,
            y: LIST_Y,
            w: 576,
            h: LIST_H,
            border: 1,
            padding: 6,
            capture: true,
            items: rows,
          },
        ],
        chrome: { hint: 'tap reply  ·  scroll to read  ·  2x for home' },
      });
    },

    async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
      if (event.kind !== 'list-select') return;
      if (event.containerID !== LIST_ID) return;
      // Only the reply row acts; body rows are inert text.
      if (event.index !== 0) return;

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
  // Full address — works for both SMS (E.164) and email, and keeps the reply
  // Confirm title meaningful instead of just a local part.
  return item.from_address;
}

function bodyToLines(item: InboxItem): string[] {
  const out: string[] = [];
  if (item.channel === 'email' && item.subject) {
    out.push(clip(item.subject, 32));
    out.push('');
  }
  for (const line of softWrap(item.body, 32)) {
    out.push(line);
    if (out.length >= MAX_BODY_ROWS) break;
  }
  return out.length > 0 ? out : ['(empty message)'];
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
        if (line) out.push(line.trim());
        line = w.slice(0, width);
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
