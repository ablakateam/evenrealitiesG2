/**
 * Fuzzy contact match.
 *
 * The compose pipeline already passes the contact list to Claude inside the
 * intent prompt. This module is the *fallback* resolver for after-the-fact
 * cases: when the HUD shows recipient name → "Alex" with confidence ●○○ and
 * needs candidate IDs to surface in the recipient-picker.
 */

export interface ContactLite {
  id: number;
  name: string;
  phone_e164: string | null;
  email: string | null;
  favorite: number;
}

export interface MatchResult {
  exact: ContactLite[];
  partial: ContactLite[];
  /** Top-N candidates ordered by score, regardless of strength. */
  ranked: { contact: ContactLite; score: number }[];
}

/** Normalize a name fragment for matching. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a contact's name against the query.
 * Higher = better. Roughly:
 *   exact full name           = 100
 *   exact first name          = 90 + favorite bump
 *   query is prefix of name   = 70 (longer overlap → higher)
 *   token overlap             = 30–60
 */
function score(contact: ContactLite, query: string): number {
  const q = normalize(query);
  const n = normalize(contact.name);
  if (!q || !n) return 0;
  const qTokens = q.split(' ');
  const nTokens = n.split(' ');
  let s = 0;

  if (n === q) s = 100;
  else if (nTokens[0] === q) s = 90;
  else if (n.startsWith(q)) s = 70 + Math.min(20, q.length);
  else if (qTokens.length > 0 && nTokens.some((nt) => qTokens.some((qt) => nt === qt))) s = 60;
  else if (qTokens.some((qt) => nTokens[0]?.startsWith(qt))) s = 50;
  else if (n.includes(q)) s = 40;

  if (s > 0) s += contact.favorite ? 5 : 0;
  return s;
}

export function matchByName(contacts: ContactLite[], query: string, limit = 5): MatchResult {
  const scored: { contact: ContactLite; score: number }[] = [];
  for (const c of contacts) {
    const sc = score(c, query);
    if (sc > 0) scored.push({ contact: c, score: sc });
  }
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.slice(0, limit);
  return {
    exact: ranked.filter((r) => r.score >= 90).map((r) => r.contact),
    partial: ranked.filter((r) => r.score < 90 && r.score >= 50).map((r) => r.contact),
    ranked,
  };
}

/** Match a phone number directly (E.164 expected). */
export function matchByPhone(contacts: ContactLite[], e164: string): ContactLite | null {
  return contacts.find((c) => c.phone_e164 === e164) ?? null;
}

/** Match an email address (case-insensitive). */
export function matchByEmail(contacts: ContactLite[], email: string): ContactLite | null {
  const norm = email.toLowerCase().trim();
  return contacts.find((c) => c.email?.toLowerCase() === norm) ?? null;
}
