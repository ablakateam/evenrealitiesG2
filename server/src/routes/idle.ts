import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { credsSource } from '../integrations.js';
import { getEmailAccount } from '../mail/account.js';

export const idleRouter = Router();

/**
 * Smart Idle suggestion ranking.
 *
 * The HUD's root screen anticipates intent instead of being a passive
 * launcher. We rank a short list of suggestions the wearer is most likely
 * to want right now, plus a status block so the HUD can render its title-bar
 * badges + Today line from a single round-trip (cold-start budget <500ms).
 *
 * Ranking signals (in priority order):
 *   1. Reply waiting   — unread inbox items, newest first
 *   2. Quiet streak    — contacts messaged before but not in >2 days
 *   3. Compose         — always present as the catch-all
 */

export type IdleAction =
  | { kind: 'compose' }
  | { kind: 'compose-to'; contact_id: number; name: string }
  | { kind: 'reply'; inbox_id: number };

export interface IdleSuggestion {
  id: string;
  label: string;
  action: IdleAction;
}

interface InboxRow {
  id: number;
  from_address: string;
  contact_id: number | null;
  received_at: string;
  contact_name: string | null;
}

interface ContactRow {
  id: number;
  name: string;
  last_sent_at: string;
}

idleRouter.get('/api/idle-suggestions', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const db = getDb();
  const suggestions: IdleSuggestion[] = [];

  // 1. Reply waiting — unread inbox, newest first (cap 4)
  const unread = db
    .prepare(
      `SELECT i.id, i.from_address, i.contact_id, i.received_at, c.name AS contact_name
       FROM inbox i LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.user_id = ? AND i.read_at IS NULL
       ORDER BY i.received_at DESC LIMIT 4`,
    )
    .all(userId) as InboxRow[];
  for (const m of unread) {
    const who = m.contact_name ?? m.from_address;
    suggestions.push({
      id: `reply-${m.id}`,
      label: `Reply to ${who}  (${relTime(m.received_at)})`,
      action: { kind: 'reply', inbox_id: m.id },
    });
  }

  // 2. Quiet streak — contacts messaged before but not in >2 days (cap 3)
  const quiet = db
    .prepare(
      `SELECT id, name, last_sent_at
       FROM contacts
       WHERE user_id = ? AND last_sent_at IS NOT NULL
         AND last_sent_at < datetime('now', '-2 days')
       ORDER BY last_sent_at ASC LIMIT 3`,
    )
    .all(userId) as ContactRow[];
  for (const c of quiet) {
    suggestions.push({
      id: `quiet-${c.id}`,
      label: `${c.name} — quiet ${daysSince(c.last_sent_at)}d`,
      action: { kind: 'compose-to', contact_id: c.id, name: c.name },
    });
  }

  // 3. Compose — always the catch-all at the bottom
  suggestions.push({ id: 'compose', label: 'Compose (voice)', action: { kind: 'compose' } });

  // --- Status block (one round-trip powers the HUD title bar + Today line) --
  const todayStats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN direction='out' AND status NOT IN ('failed','undelivered') THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction='out' AND status IN ('failed','undelivered') THEN 1 ELSE 0 END) AS failed
       FROM history WHERE user_id = ? AND date(created_at) = date('now')`,
    )
    .get(userId) as { sent: number | null; failed: number | null };
  const unreadCount = (db
    .prepare('SELECT COUNT(*) AS c FROM inbox WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { c: number }).c;

  res.json({
    suggestions,
    status: {
      twilio: credsSource(userId, 'twilio') !== 'none',
      email: getEmailAccount(userId) !== null,
      today_sent: todayStats.sent ?? 0,
      today_failed: todayStats.failed ?? 0,
      unread: unreadCount,
    },
  });
});

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso + (iso.includes('T') ? '' : 'Z')).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function daysSince(iso: string): number {
  const diff = Date.now() - new Date(iso + (iso.includes('T') ? '' : 'Z')).getTime();
  return Math.max(1, Math.floor(diff / 86_400_000));
}
