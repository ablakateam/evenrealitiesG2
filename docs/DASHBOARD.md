# The dashboard

Also referred to in this project as "the CRM". They are the same thing —
there is no separate CRM system. It is the React SPA in `web/`, served at
the root of the same domain as the API.

---

## Is it required?

**Yes, at least once.** The glasses have no keyboard, so credentials,
contacts and templates cannot be entered on the device. The dashboard is
where the system is configured.

Day to day it is optional — once set up, the glasses work on their own.

It deploys with the server, on the same box, behind the same Nginx. There
is no separate host, database or credential.

---

## How the two systems relate

There is no dashboard-specific backend. The dashboard is a static bundle
that calls the **same** `/api/*` endpoints the glasses call, with the same
bearer secret.

```
   glasses ─┐
            ├─► /api/*  ──►  server  ──►  SQLite
 dashboard ─┘        same endpoints, same auth, same data
```

That is why a message style set on the glasses appears in the dashboard
instantly, and vice versa: both are reading and writing `preferences` via
`GET`/`PUT /api/config`. There is no synchronisation layer because there is
nothing to synchronise.

---

## Authentication

Two ways in.

### Passkey-free, from the phone companion

The companion already holds the shared secret, so nothing needs typing:

```
 companion  ──POST /api/auth/handoff──►  server mints single-use token
     │                                    · 180 s TTL
     │                                    · only sha256(token) stored
     │                                    · secret stored encrypted on the row
     ▼
 opens /connect?t=<token>&from=<companion-url>
     │
     ▼
 dashboard exchanges once → stores the secret → strips the token from history
```

The token is burned inside the same transaction as the read, so two racing
exchanges cannot both succeed. Because the return URL travels in `?from=`,
the dashboard renders a **Back to VOX** control — without it the companion
WebView is replaced with no browser chrome and no way back.

### Manual

Paste the shared secret on the welcome screen. It is held in `localStorage`
and sent as `Authorization: Bearer` on every request. Sign out clears it.

**Connect another device** on the Account page shows a QR containing a
handoff URL with a live countdown — not the permanent secret. Scanning it
from a laptop signs that browser in once. An earlier version encoded
`{server, secret}` directly, which meant a photograph of that screen was
unlimited access, forever, undetectably.

---

## What each page does

| Page | Purpose |
|---|---|
| **Overview** | Server health, today's counts, recent activity, setup prompt if incomplete |
| **Inbox** | Received SMS and email; open a thread, mark read |
| **Contacts** | CRUD, favourites, search, CSV import. Phone numbers normalised to E.164 |
| **Templates** | Reusable message bodies with ordering; 12 seeded on first run |
| **Activity** | Full history with channel/direction filters, roll-up stats, CSV export |
| **Integrations** | Per-provider credential cards with live test buttons; email account setup |
| **Preferences** | 23 settings across five groups, auto-saved |
| **Diagnostics** | Runs live checks against DB, Twilio, SMTP, IMAP and each model provider |
| **Account** | Connect-device QR, reveal/rotate the shared secret, sign out |
| **Setup wizard** (`/setup`) | Six steps: welcome → Twilio → email → AI → contacts → done |

### Contacts

The compose pipeline needs these: contact names are injected into the intent
prompt as grounding, so "text Alex" resolves to a real record rather than a
guess. A contact with only a phone can receive SMS; only an email, email;
both, either — and the review screen offers to switch.

CSV import takes `name,phone,email`.

### Templates

Stored and ordered, exposed via the API. Not yet surfaced on the glasses —
an honest gap rather than an undocumented feature.

### Integrations

Credentials entered here are encrypted with `MASTER_KEY` and stored in the
database, which takes precedence over environment variables. Each provider
card has a **Test** button that performs a real round trip, so a bad key is
caught at setup rather than mid-message.

### Preferences

Read by both surfaces. The ones that reach the glasses:

| Setting | Effect |
|---|---|
| `default_tone` | Style new messages start in; mirrored by the glasses Style menu |
| `max_recording_seconds` | Hard cap on a recording |
| `silence_autostop_seconds` | Silence before recording ends |
| `voice_language` | Pinned language for speech recognition |

`voice_language` defaults to `en`, not auto-detect. Left to choose,
`whisper-1` on marginal audio will confidently return another language —
English speech coming back as Japanese was a real reported bug. Set it to a
specific language, or to `auto` if you genuinely need multilingual and
accept that failure mode.

---

## Mobile

The dashboard is used primarily on a phone, because that is where the
companion's **Open dashboard** button leads. It is built mobile-first:

- Below `lg` the sidebar becomes a drawer behind a hamburger; the desktop
  rail returns at `lg`.
- Every interactive control clears a 44 px touch target on touch viewports.
- Form controls render at 16 px below `lg` — under that, iOS Safari zooms
  the viewport on focus and the user has to pinch back out on every field.
- Modals are bottom sheets on phones and centred dialogs from `sm` up. They
  track `visualViewport`, so the sheet lifts above the on-screen keyboard
  instead of sitting behind it, and the first field is focused on open.
- Gutters use `max(1rem, env(safe-area-inset-*))`, so the notch and the home
  indicator are respected without losing the designed margin.

Verified by measurement at 320 / 390 / 844 / 1440 px: no horizontal scroll,
no sub-44 px targets, no sub-16 px inputs.

---

## Legal pages

`/privacy/` and `/terms/` are plain static HTML in `web/public/`, outside the
SPA bundle deliberately — they must resolve without a passkey and without
JavaScript, since app-store reviewers and crawlers hit them cold.

The support address is not in the repository. Both pages carry a
`SUPPORT_EMAIL` placeholder that `web/deploy.sh` substitutes from
`VOX_SUPPORT_EMAIL` at deploy time.

---

## Building and deploying

```bash
cd web
npm ci
npm run dev        # :5173, set VITE_API_BASE to a deployed server
npm run build      # → dist/
bash deploy.sh     # build, substitute support email, rsync, reload nginx
```

In production `VITE_API_BASE` is empty: Nginx serves the bundle and proxies
`/api` on the same origin, so relative paths resolve.
