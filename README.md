# VOX

**Voice-first SMS and email for Even Realities G2 smart glasses.**

Tap the temple, speak a message, review exactly what is about to go out, and
send it — as an SMS through your Twilio number, or as an email through your
own mail account. Replies come back to the glasses. Everything runs on a
server you host yourself; there is no VOX-operated backend.

```
┌──────────────┐   BLE    ┌──────────────┐   HTTPS   ┌──────────────┐
│  G2 glasses  │◄────────►│  Even        │◄─────────►│  VOX server  │
│  576×288 HUD │          │  Realities   │           │  (your VPS)  │
│  1 touch pad │          │  phone app   │           │              │
└──────────────┘          └──────────────┘           └──────┬───────┘
                                                            │
                          ┌─────────────────────────────────┼───────────┐
                          │                    │            │           │
                     ┌────▼────┐        ┌──────▼─────┐ ┌────▼────┐ ┌────▼────┐
                     │ Twilio  │        │ SMTP/IMAP  │ │ Whisper │ │  LLM    │
                     │  SMS    │        │ your inbox │ │  STT    │ │ rewrite │
                     └─────────┘        └────────────┘ └─────────┘ └─────────┘
```

**Status:** working, in hardware testing. Single-tenant by design — one
person, one server. Multi-tenant groundwork exists (every table is keyed by
`user_id`) but authentication is a shared secret, not user accounts.

**License:** MIT. **Requires:** Node 20+, a small VPS, and your own Twilio /
email / model-provider credentials.

---

## Contents

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flows, why the design is shaped this way |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Clean VPS → running system, step by step |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable and preference |
| [docs/EVEN_REALITIES.md](docs/EVEN_REALITIES.md) | SDK usage, platform constraints, hard-won quirks |
| [docs/GLASSES_UX.md](docs/GLASSES_UX.md) | Every screen and interaction on the HUD |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | The web dashboard: contacts, templates, integrations, auth |
| [docs/API.md](docs/API.md) | Every HTTP endpoint |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, credential handling, known limitations |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptoms → diagnosis → fix |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development loop, conventions, testing |

Project journals — kept because they explain *why*, not just what:
[PROGRESS.md](PROGRESS.md) · [ISSUES.md](ISSUES.md) ·
[LESSONSLEARNED.md](LESSONSLEARNED.md) · [RFP.md](RFP.md) · [PHASES.md](PHASES.md)

---

## What VOX actually does

### On the glasses

The G2 has a 576×288 monochrome green display and a single touch surface on
the temple. The entire app is three gestures: **scroll** to move the
highlight, **tap** to activate it, **double tap** to go back — or, on the
home screen, to leave.

Home is a four-row menu:

```
              ( ( ● ) )                 ← breathing signal: awake and connected
┌────────────────────────────────────┐
│ Speak a message                    │  ← compose by voice
│ Inbox                 3 new        │  ← received SMS and email
│ Voice command                      │  ← say what you want instead of navigating
│ Style: Casual                      │  ← the voice new messages start in
└────────────────────────────────────┘
 SMS to Alex - 2m ago  ·  2x to exit
```

**Composing.** Pick *Speak a message* and the microphone opens with a live
oscilloscope trace so you can see it is hearing you. Tap to stop, or stop
talking — recording ends after a few seconds of silence. Audio streams to
your server, Whisper transcribes it, and an LLM works out who it is for,
whether it should be a text or an email, and what the message body is.

**Reviewing.** Nothing sends unattended. The review screen shows the
recipient, the channel, the real destination address, and the exact body:

```
        Alex Chen  ·  SMS  ·  +15555550142
 Hey, just a heads up, I'm running
 like 10 mins late. Sorry about that!
┌────────────────────────────────────┐
│ ──── SEND ────                     │
│ Style: Casual              >       │
└────────────────────────────────────┘
```

**Style.** Seven rewrites are generated in parallel while you read the first
one, so switching is instant and costs no extra round trip: *Casual,
Professional, Friendly, Formal, Sarcastic, Grammar* (your words, cleaned up)
and *Original* (untouched). Scrolling to the Style row opens a submenu; if
the recipient has both a phone number and an email address, the same submenu
offers to switch channel.

**Inbox and reply.** Received SMS (Twilio webhook) and email (IMAP IDLE)
appear in a HUD inbox, newest first, unread marked. Opening one and tapping
*reply* starts a message with the recipient and channel already locked, so
you only have to speak.

**Voice command.** Say "open inbox", "send Alex I'm running late", "save
415 555 0142 as Mom", or "cancel". A classifier decides which one you meant.
Compose, navigate, save-contact and cancel are handled on the glasses;
search and settings direct you to the dashboard.

### In the Even Realities phone app

VOX ships one bundle that renders two surfaces: the HUD on the glasses, and
a companion page in the phone app's WebView. The companion shows service
health, today's counts, the current message style (changeable there), quick
links, and recent activity. **Open dashboard** signs you into the full web
dashboard without typing anything, using a single-use token that expires in
three minutes; a **Back to VOX** control returns you.

### The dashboard

A React SPA served at the root of the same domain. Contacts, templates,
message history, integrations, diagnostics, preferences, and a six-step
setup wizard. Fully responsive — it is the primary surface on a phone.

Referred to elsewhere in this project as "the CRM": it is the same thing.
There is no separate CRM system.

---

## How it fits together

```
 voice ──► Even Realities app ──► POST /api/compose ──► Whisper STT
                                        │
                                        ├──► intent parse ─┐
                                        └──► 6 tone rewrites ├─ one Promise.all
                                                            │
             HUD review screen ◄── {transcription, intent, variants[7]}
                     │
                     └─ SEND ──► POST /api/sms   ──► Twilio
                                 POST /api/email ──► your SMTP
                                        │
                                        └──► history + outbox (SQLite)

 inbound SMS   ──► Twilio webhook  ─┐
 inbound email ──► IMAP IDLE worker ─┴──► inbox table ──► HUD inbox / SSE
```

Full detail, including why the pipeline is shaped this way, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Repository layout

```
hud/       Glasses app + phone companion. One Vite bundle, two render targets;
           main.ts detects the context. Packs to a .ehpk for the Even Hub.
server/    Node + Express + SQLite API. Compose pipeline, Twilio, SMTP/IMAP,
           auth, rate limiting. Deploys to a VPS with pm2 behind Nginx.
web/       React + Tailwind dashboard SPA. Static build served by Nginx.
docs/      Engineering documentation (table above).
.githooks/ Pre-commit guard that blocks credentials and PII.
```

There is no `frontend/` or `backend/`: the three deployable units are the
glasses app, the API, and the dashboard, and the directories are named after
them.

---

## Quick start

You need a VPS, a domain, a Twilio account, an email account with SMTP and
IMAP, and an OpenAI key (Whisper is required for speech).
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) is the complete version — this is
the shape of it.

```bash
git clone https://github.com/ablakateam/evenrealitiesG2.git vox
cd vox

# 1. Server — deploy.sh generates MASTER_KEY and BOOTSTRAP_SECRET on first
#    run and prints the bootstrap secret once. Save it.
cd server && npm ci && npm run build
cp .env.example .env          # local dev only; the VPS file is generated
bash deploy.sh                # rsync + npm ci on the VPS + pm2 reload

# 2. Dashboard
cd ../web && npm ci && bash deploy.sh

# 3. Open https://your-domain/ , paste the bootstrap secret, run /setup

# 4. Glasses app
cd ../hud && npm ci
cp .env.example .env          # fill VOX_DOMAIN, VITE_VOX_SERVER, VITE_VOX_SECRET
bash pack.sh                  # → hud/vox.ehpk
```

Upload `hud/vox.ehpk` at [hub.evenrealities.com](https://hub.evenrealities.com)
and **switch the build to the Beta track** — uploads default to Private, and
a Private build reports "test version expired" to invited testers with no
other explanation.

### Running locally

```bash
cd server && npm run dev                       # API on :3000
cd web    && npm run dev                       # dashboard on :5173
cd hud    && npm run dev                       # glasses bundle on :5173
npx @evenrealities/evenhub-simulator --automation-port 9898 http://localhost:5173
```

The simulator exposes an HTTP automation API — screenshot the glasses
display, send taps and scrolls, read the console. See
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## Security

- **No credential is ever committed.** A pre-commit hook blocks known secret
  and PII patterns; `.env` files are gitignored throughout.
- **Credentials are encrypted at rest** (AES-256-GCM) in the database. The
  shared secret is stored only as an Argon2id hash.
- **Your data goes glasses → your server → the services you configured.**
  Nothing routes through infrastructure belonging to the developer.
- **Known limitation:** the shared secret is inlined into the `.ehpk` at
  build time. Fine for a Private/Beta build only you can download; it must
  be replaced with a real pairing flow before any public Production release.

Full threat model and the current gaps: [docs/SECURITY.md](docs/SECURITY.md).
To report a vulnerability, see the contact in that document.

---

## Project state

Built in phases P0–P20. P0–P18 complete; P19 (hardware testing) is the live
loop; P20 is Even Hub submission. [PROGRESS.md](PROGRESS.md) is the ground
truth for what works today, and [ISSUES.md](ISSUES.md) tracks every known
defect, risk and open question with an ID.

Notable things that are honestly *not* done are listed in
[ISSUES.md](ISSUES.md) rather than omitted — including the embedded-secret
limitation above, an inbox unread count inflated by the first IMAP backfill,
and inbound SMS not yet publishing to the SSE stream.
