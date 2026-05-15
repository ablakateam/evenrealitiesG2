import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { apiGet, HudApiError } from '../api.js';
import { setRecipient } from '../draft.js';

/**
 * Recipient picker — pop-up over Confirm. Fetches /api/contacts and shows
 * names as native list rows. On select, updates the draft and pops back.
 *
 * Layout matches the rest of the app: title text c1, list c2 (capture),
 * footer text c3.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

interface ContactRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

interface ContactsResponse {
  items: Array<{
    id: number;
    name: string;
    phone_e164: string | null;
    email: string | null;
  }>;
  total: number;
}

let rows: ContactRow[] = [];

export const RecipientPickerPage: Page = {
  id: 'pick-to',

  async mount(ctx: PageContext): Promise<void> {
    rows = [];
    let errorLine: string | null = null;
    try {
      const data = await apiGet<ContactsResponse>('/api/contacts?limit=50');
      rows = data.items.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone_e164,
        email: c.email,
      }));
    } catch (err) {
      errorLine =
        err instanceof HudApiError ? `Couldn't fetch contacts: ${err.code}` : 'Network error.';
    }

    const items =
      rows.length > 0
        ? rows.map(formatRow)
        : [errorLine ?? 'No contacts yet.', '', 'Add some on the phone dashboard.'];

    await showPage(ctx.bridge, {
      texts: [
        { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: `TO  -  ${rows.length} contacts` },
        { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: '[SCRL] move  [TAP] pick  [X2] back' },
      ],
      lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items }],
    });
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind !== 'list-select') return;
    const picked = rows[event.index];
    if (!picked) return;
    setRecipient({
      id: picked.id,
      name: picked.name,
      phone: picked.phone,
      email: picked.email,
    });
    await ctx.router.back();
  },
};

function formatRow(c: ContactRow): string {
  const hint = c.phone && c.email ? 'PH+EM' : c.phone ? 'PH' : c.email ? 'EM' : '--';
  // Name capped to keep total ≤32 chars: name(22) + 1 space + hint(5) = 28
  const name = c.name.length > 22 ? c.name.slice(0, 21) + '~' : c.name;
  return `${name.padEnd(22)} ${hint}`;
}
