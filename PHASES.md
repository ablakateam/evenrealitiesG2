# VOX — Implementation Phases

**Conventions**
- Phases are sequential; later phases depend on earlier ones unless noted
- Each phase has **Deliverables · Tasks · Exit criteria · Estimated time · Depends on**
- "Exit criteria" must all pass before advancing to the next phase
- Update `PROGRESS.md` as each phase completes
- Total estimate: ~100h of focused work across ~20 phases

---

## P0 — Documentation & Setup    [~2h]

**Deliverables**
- `RFP.md`, `PHASES.md`, `PROGRESS.md`, `ISSUES.md`, `LESSONSLEARNED.md`
- `.gitignore` (excludes `.claude/`, `node_modules`, `.env`)
- Initial commit + push to `<your-org>/<your-repo>`
- Pre-flight checks: Node v20+, CLI installed, `evenhub login`

**Tasks**
1. Init git working tree in `<project-root>/`
2. Add origin, fetch main, sync local
3. Write all 5 documentation files
4. Add `.gitignore`
5. `git add` + commit + push
6. Verify `node -v` ≥ 20
7. `npm i -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator`
8. `evenhub login` (interactive — user runs)

**Exit criteria**
- ✓ 5 docs visible on GitHub
- ✓ Node version verified
- ✓ Even Realities CLI tools installed
- ✓ `evenhub login` successful

**Depends on:** —

---

## P1 — Infrastructure    [~3h]

**Deliverables**
- Vultr VPS (Ubuntu 22.04, smallest plan ~$6/mo)
- Domain pointed to VPS IP via DNS A record
- Node 20 installed on VPS
- Nginx reverse proxy + Let's Encrypt TLS
- pm2 globally installed
- SSH key-based auth from local machine

**Tasks**
1. Spin up Vultr instance (Ubuntu 22.04, NYC or closest region)
2. Configure DNS (A record `api.vox.<your-domain>` → VPS IP)
3. SSH setup (key-based, disable password auth)
4. `apt update && apt upgrade`
5. Install Node 20 (NodeSource repo)
6. Install Nginx + Certbot
7. `certbot --nginx -d api.vox.<your-domain>`
8. Install pm2 globally
9. Deploy a hello-world Express server to verify path

**Exit criteria**
- ✓ `curl https://api.vox.<your-domain>/health` returns 200
- ✓ TLS cert valid
- ✓ pm2 keeps process alive across reboot (`pm2 startup`)

**Depends on:** P0 (need repo to deploy from)

**User-blocked tasks:** purchasing Vultr instance + domain; both require user accounts.

---

## P2 — Server core    [~6h]

**Deliverables**
- `server/` directory scaffold
- Express + TypeScript + better-sqlite3
- Shared-secret auth middleware (argon2)
- libsodium secretbox crypto helper
- DB schema: `users`, `email_accounts`, `contacts`, `templates`, `preferences`, `history`, `inbox`, `outbox`, `client_errors`
- Routes: `/api/health`, `/api/config` (GET/PUT)
- pm2 ecosystem config + deploy script

**Tasks**
1. `npm init` in `server/`, install deps
2. `tsconfig.json` strict mode
3. Express app + middleware (cors, json, auth, rate-limit)
4. Crypto wrapper (libsodium)
5. SQLite schema + migration runner
6. Auth middleware (Bearer secret → argon2 verify)
7. `/api/health` returns server status
8. `/api/config` CRUD with auth
9. pm2 `ecosystem.config.js`
10. `deploy.sh` (rsync + pm2 reload)
11. Integration tests (vitest) for auth + config

**Exit criteria**
- ✓ Integration tests pass
- ✓ Auth blocks unauthenticated calls (401)
- ✓ Auth allows correct-secret calls (200)
- ✓ Deploy script works (deploys to Vultr, pm2 reloads, health returns 200)

**Depends on:** P1

---

## P3 — LLM provider abstraction    [~4h]

**Deliverables**
- `server/src/llm/provider.ts` interface
- 4 implementations: anthropic, openai, openrouter, ollama-cloud
- Model catalog with speed glyphs
- `/api/llm/test` endpoint (POST `{provider, model}` → returns sample completion + latency)
- Prompt-caching aware Anthropic implementation

**Tasks**
1. Define `LlmProvider` interface
2. Implement each provider (anthropic = native SDK; others = OpenAI-compatible)
3. Factory function reads user prefs, picks provider+model
4. Model catalog (`server/src/llm/models.ts`)
5. `/api/llm/test` route
6. Test against all 4 providers with same prompt

**Exit criteria**
- ✓ Identical prompt returns valid completion across all 4 providers
- ✓ Latency reported for each provider
- ✓ Switching providers via `/api/config` PUT works

**Depends on:** P2

---

## P4 — STT + intent + rewrites    [~5h]

**Deliverables**
- `/api/stt` route (Whisper)
- `/api/compose` route (batched STT + intent + 7 rewrites)
- `/api/parse` route (intent only, for non-voice flows)
- `/api/rewrite` route (single tone re-run)
- `server/src/prompts.ts` with all 7 tone prompts + intent-parse template

**Tasks**
1. Multer middleware for PCM upload (WAV header wrap)
2. OpenAI Whisper client
3. Prompts: Casual, Professional, Friendly, Formal, Sarcastic, Grammar-fix, Original (skip), + intent-parse
4. Channel-aware length bias (SMS ≤160 chars, email allows greeting/signoff)
5. Parallel-fire 7 rewrites + 1 intent parse via `Promise.all`
6. `/api/compose` returns `{intent, variants}` in one response
7. Multi-language: detect from Whisper, pass to all prompts

**Exit criteria**
- ✓ Recorded WAV input returns full structured response in <4s (Anthropic Haiku)
- ✓ All 7 tones return coherent text
- ✓ SMS variants stay ≤160 chars
- ✓ Spanish input returns Spanish rewrites

**Depends on:** P2, P3

---

## P5 — Twilio (SMS) integration    [~3h]

**Deliverables**
- `/api/sms` outbound route
- `/webhooks/twilio/inbound` route with signature verification
- Unguessable random subpath per user
- Outbox table writes + retry logic
- Twilio status callback handler

**Tasks**
1. `twilio` SDK client
2. Outbound: `messages.create({from, to, body})` with idempotency-key
3. Inbound webhook: validate `X-Twilio-Signature`
4. Resolve `from_address` → contact_id; insert into `inbox`
5. Push SSE event for new inbox item
6. Status callback (`/webhooks/twilio/status`) updates outbox row

**Exit criteria**
- ✓ Send a real SMS to phone, confirm delivery callback fires
- ✓ Send an SMS *to* Twilio number, confirm inbound webhook → inbox row
- ✓ Tampered webhook (bad signature) returns 403

**Depends on:** P2

---

## P6 — Email (IMAP + SMTP)    [~7h]

**Deliverables**
- `/api/email` outbound (SMTP via nodemailer)
- `/oauth/google` + callback (Gmail scopes)
- `/oauth/microsoft` + callback (Outlook scopes)
- `server/src/mail/imap-idle.ts` worker
- `server/src/mail/imap-manager.ts` (spawns workers on boot)
- `/api/inbox`, `/api/inbox/:id/read`, `/api/inbox/stream` (SSE)

**Tasks**
1. nodemailer setup with OAuth2 + password modes
2. Gmail OAuth flow (googleapis)
3. Outlook OAuth flow (@azure/msal-node)
4. XOAUTH2 helper for IMAP auth
5. `imapflow` IDLE worker — open INBOX, FETCH new UIDs since last seen
6. `mailparser` integration — strip emoji, sanitize, extract plain text
7. Token refresh on `AUTHENTICATIONFAILED`
8. SSE stream for new inbox items
9. IMAP manager keeps one worker per user; respawns on disconnect with exponential backoff

**Exit criteria**
- ✓ Real Gmail OAuth completes, mailbox connects
- ✓ Test send via SMTP appears in user's real Sent folder
- ✓ Real incoming email triggers IMAP IDLE → inbox row → SSE push within 5s
- ✓ Disconnect (simulated) auto-recovers
- ✓ Expired access token auto-refreshes

**Depends on:** P2

---

## P7 — Contacts + Templates + History    [~3h]

**Deliverables**
- `/api/contacts` CRUD
- `/api/contacts/csv` upload
- `/oauth/google/contacts` + sync via People API
- `/api/templates` CRUD
- `/api/history` GET/POST
- `/api/voice-command` route (classifier for non-compose voice)

**Tasks**
1. Contact schema (id, name, phone, email, default_channel, last_used_channel, last_sent_at, usual_tone, tags)
2. Fuzzy match resolver (Fuse.js or simple Levenshtein)
3. CSV parser
4. Google People API sync (paginate, upsert by email/phone)
5. Templates schema + CRUD
6. History schema + log on every send
7. Voice-command classifier: Claude prompt that returns `{class, ...args}`

**Exit criteria**
- ✓ Add/edit/delete contact via API
- ✓ CSV upload parses correctly
- ✓ Google sync imports ≥1 contact
- ✓ History log writes on /api/sms + /api/email
- ✓ Voice-command classifier returns valid intent class for sample utterances

**Depends on:** P2, P3

---

## P8 — Phone dashboard scaffold    [~6h]

**Deliverables**
- `web/` directory with Vite + React + TypeScript
- Tailwind + shadcn/ui installed
- Dark theme matching Even Hub
- Sidebar nav (9 sections)
- First-launch welcome screen
- Router (react-router-dom)
- TanStack Query setup

**Tasks**
1. `npm create vite@latest` with React-TS template
2. Tailwind + shadcn/ui setup
3. Theme tokens (G2-phosphor green accent)
4. Sidebar component with lucide-react icons
5. Layout shell
6. Auth guard (redirects to onboarding if no shared secret)
7. TanStack Query provider + auth interceptor
8. First-launch welcome card

**Exit criteria**
- ✓ Dashboard renders on phone-sized viewport
- ✓ Sidebar navigation works
- ✓ Auth guard redirects correctly
- ✓ Dark theme + green accent visible

**Depends on:** P2

---

## P9 — Onboarding wizard    [~6h]

**Deliverables**
- 6-step wizard component
- Step 1: Welcome
- Step 2: Twilio (with test send)
- Step 3: Email (OAuth buttons or custom expand)
- Step 4: AI providers (OpenAI + Anthropic, both tested)
- Step 5: Contacts (Google OAuth / CSV / manual / skip)
- Step 6: Done + pairing QR

**Tasks**
1. Wizard shell with progress indicator
2. Per-step form (react-hook-form + zod validation)
3. OAuth flows (Google, Microsoft) — open popup, listen for callback
4. Test buttons that fire real API calls
5. Pairing QR (encodes the shared secret + server URL)
6. KVS write of shared secret on completion

**Exit criteria**
- ✓ Fresh user can go from blank → fully configured in <5 min
- ✓ Each step's test button passes for valid credentials
- ✓ OAuth callbacks complete and surface success
- ✓ Pairing QR is scannable by Even Realities phone app

**Depends on:** P5, P6, P7, P8

---

## P10 — Dashboard surfaces    [~10h]

**Deliverables**
- Overview page (status + today + quick actions + recent)
- Integrations page (5 cards: Twilio, Email, OpenAI, Anthropic, Google)
- OpenRouter + Ollama Cloud cards (optional)
- Contacts page (list, search, add modal, detail view)
- Templates page (CRUD, drag-to-reorder)
- Inbox page (list + thread view)
- Activity page (history with cost meter, CSV export)
- Preferences page (sectioned: Voice & AI · Voice input · Notifications · Smart features · Cost guardrails)
- Diagnostics page (run-all-tests button + per-check status)
- Account page (secret rotation, pairing QR, sign out)

**Tasks**
1. Each surface as a route
2. TanStack Query mutations for CRUD
3. Optimistic updates where appropriate
4. Charts/sparklines for activity (recharts or hand-rolled)
5. Toasts for confirmations
6. Forms with zod validation
7. Drag-and-drop for templates (dnd-kit)

**Exit criteria**
- ✓ Every surface functional
- ✓ Real-time data updates (TanStack Query invalidation)
- ✓ Diagnostics test run completes in <10s
- ✓ Mobile-responsive on a phone-sized viewport

**Depends on:** P5, P6, P7, P9

---

## P11 — HUD scaffold    [~4h]

**Deliverables**
- `hud/` directory with Vite + TypeScript (separate entry from dashboard)
- `waitForEvenAppBridge()` bootstrap
- Page router (in-memory state machine)
- Root double-tap → `shutDownPageContainer(1)` (submission gate)
- `app.json` with edition, permissions, network whitelist
- Successful `evenhub pack` produces a `.ehpk`

**Tasks**
1. Vite second-entry config (`hud.html`)
2. SDK bootstrap in `hud/src/main.ts`
3. Page state machine (current page, transitions)
4. Bridge event subscriber
5. KVS helper (wraps setLocalStorage/getLocalStorage)
6. API client (auth header from KVS)
7. `app.json` + manifest
8. Test render on `evenhub-simulator`

**Exit criteria**
- ✓ `evenhub-simulator` shows a basic page
- ✓ Tap triggers a `CLICK_EVENT` callback
- ✓ Root double-tap exits via `shutDownPageContainer(1)`
- ✓ `.ehpk` builds without errors

**Depends on:** P2

---

## P12 — HUD Smart Idle    [~5h]

**Deliverables**
- Smart Idle page with title bar, status badges, suggestion list, Today stats, footer
- Suggestion ranking from `/api/idle-suggestions`
- Status badges (NET / TWL / MAIL / BAT) live-updated
- List container with native scroll + selection
- Tap to enter each suggestion's flow

**Tasks**
1. Page renderer
2. `/api/idle-suggestions` server route (ranks by reply-waiting, time-of-day, quiet streak, repeat templates)
3. Pine/NC-style title bar with baked title `┌─[ VOX ]──── ... ─┐`
4. List container with scroll-event handling
5. Routing on tap (to compose, reply, quick-send, etc.)

**Exit criteria**
- ✓ Top-3 suggestions render correctly
- ✓ Tap on a suggestion opens the right page
- ✓ Status badges reflect real connection state
- ✓ Smart Idle loads in <500ms cold-start

**Depends on:** P7, P11

---

## P13 — HUD voice compose pipeline    [~7h]

**Deliverables**
- Compose page (listening state with live level meter)
- Transcribing state (rotating friendly copy)
- `/api/compose` integration (parallel STT + intent + 7 rewrites)
- Confirm page (atom-card layout, Pine-style)
- SMS + Email variant layouts
- Subject prompt page (email when subject missing)
- Confidence dots (●●● / ●●○ / ●○○)

**Tasks**
1. Mic capture via `bridge.audioControl(true)` + audio event accumulator
2. RMS amplitude meter (compute per-100ms frame, map to 9-step blocks)
3. Tap-to-stop → POST PCM to `/api/compose`
4. Confirm page renderer
5. SMS vs Email layout branching
6. Subject prompt when intent.subject is empty + email channel
7. Atom-card cursor logic (scroll moves cursor between fields)

**Exit criteria**
- ✓ Voice → confirm screen renders correctly with all atoms + confidence dots
- ✓ Level meter responds to real voice amplitude
- ✓ Spanish input shows Spanish rewrite + language indicator
- ✓ Email confirm shows SUBJECT row + multi-line body

**Depends on:** P4, P11

---

## P14 — HUD tone picker + send    [~4h]

**Deliverables**
- Tone picker page (list + live preview)
- All 7 variants pre-cached from `/api/compose` response
- Send action (POST to `/api/sms` or `/api/email`)
- Sent page (SMS / Email distinct variants)
- Smart Pause auto-send (countdown when conditions met)

**Tasks**
1. Tone picker page renderer
2. Preview updates via `textContainerUpgrade` on list scroll
3. Send flow (route to /api/sms or /api/email based on channel)
4. Sent page (different glyph/copy for SMS vs Email)
5. Smart Pause logic: body<60 + recent recipient + all ●●● → 2s countdown
6. KVS tone-memory: update `usual_tone` on contact when user overrides

**Exit criteria**
- ✓ Full voice→sent flow on simulator
- ✓ Tone cycling shows instant preview (cached)
- ✓ Smart Pause counts down correctly
- ✓ Real send fires (test on hardware in P19)

**Depends on:** P5, P6, P13

---

## P15 — HUD inbox + reply    [~5h]

**Deliverables**
- Banner notification (title bar overlay)
- Inbox list page
- Read view page
- Reply compose page (TO locked, context shown)
- SSE subscription
- Mark-read endpoint integration

**Tasks**
1. SSE client (EventSource with reconnect)
2. Banner overlay on any page when new inbox item arrives
3. Inbox list with scroll + selection
4. Read view with full body (sanitized)
5. Reply compose (TO + VIA locked, "Replying to:" context)
6. Mark read on view

**Exit criteria**
- ✓ Incoming SMS triggers banner in <5s
- ✓ Tap banner → read view → tap reply → voice → send → confirmation
- ✓ Mark-read syncs across multi-device (SSE broadcast)

**Depends on:** P5, P6, P11, P12

---

## P16 — Voice-anywhere    [~6h]

**Deliverables**
- `/api/voice-command` classifier
- Per-class handlers: Navigate, Reply, Correct, Save-contact, Search, Settings, Confirm/Cancel
- Long-press temple gesture detection (SDK event timing)
- Voice activation on any page

**Tasks**
1. Classifier prompt (Claude): utterance → `{class, args}`
2. Per-class handlers in HUD page router
3. Long-press detection (track CLICK_EVENT start/end timing >500ms)
4. Save-contact flow: parse `415-555-0142 as Mom` → POST /api/contacts
5. Search flow: parse query → POST /api/history/search
6. Settings flow: parse "turn on quiet hours" → PATCH /api/preferences
7. Confirm/Cancel: commits / cancels current screen action

**Exit criteria**
- ✓ "Open inbox" from idle navigates correctly
- ✓ "Make it formal" on confirm screen re-renders with Formal tone
- ✓ "Save 415-555-0142 as Mom" creates contact
- ✓ "Find my last message to Sarah" returns search results

**Depends on:** P4, P7, P11, P12, P13, P14, P15

---

## P17 — Polish    [~5h]

**Deliverables**
- Microcopy review pass (warm, brief, human)
- Empty states for every page (teach, never blame)
- Error states (empathy + immediate next action)
- Microinteractions (brightness flash on tap, sent heartbeat, cursor transitions)
- Loading-state rotation (3 friendly variants per state)
- First-run voice cue card (one-time)

**Tasks**
1. Audit every string for tone (vs. "INITIALIZE SESSION" / "ERROR 502" patterns)
2. Empty-state design per page
3. Error-state design with retry CTA
4. Brightness-flash microinteractions (textContainerUpgrade pairs)
5. Loading copy library (rotate 3 variants per state)
6. Voice cue card with KVS flag

**Exit criteria**
- ✓ Every page passes subjective "warm + welcoming" review
- ✓ No corporate / shouty / robotic copy
- ✓ Empty states teach instead of blank-screen
- ✓ Errors offer the next action

**Depends on:** P11–P16

---

## P18 — Hardening    [~4h]

**Deliverables**
- Offline outbox queue with exponential backoff
- Rate limiting per shared secret (4 categories)
- OAuth refresh failure flow (Smart Idle re-auth surfacing)
- Wear / charging state handling (HUD dim/sleep)
- Telemetry endpoint
- Webhook signature verification (already in P5; verify here)
- Cost guardrails with HUD warning at 80%

**Tasks**
1. Outbox table + retry worker (5s, 30s, 2m, 10m, 1h, give up)
2. Idempotent send via client UUID
3. Rate limit middleware (4 categories)
4. OAuth refresh error → email_accounts.imap_status = 'error' → Smart Idle re-auth suggestion
5. Device-status event handlers (isWearing, isCharging)
6. `/api/telemetry/error` route + client errors table
7. Cost guardrail check before each send

**Exit criteria**
- ✓ Airplane-mode test: send queues, flushes on reconnect
- ✓ Rate-limit returns 429 + HUD shows "Take a breath" message
- ✓ Manual Google access revoke → Smart Idle surfaces re-auth in <60s
- ✓ Charging glasses → HUD goes dark, mic + IMAP pause
- ✓ 80% cost threshold → HUD warning banner

**Depends on:** P5, P6, P11–P16

---

## P19 — Hardware testing    [~6h]

**Deliverables**
- Real-G2 test session report
- Bug list (filed in ISSUES.md)
- Performance metrics on hardware
- Battery consumption baseline
- Pairing QR generation via Even Realities phone app

**Tasks**
1. `evenhub qr -u http://<lan-ip>:5173` → scan with Even Realities phone app
2. Run through every page on real glasses
3. Send 10 real SMS messages
4. Send 10 real emails
5. Receive replies, verify banner + inbox + read flow
6. Test offline mode (toggle phone airplane mode)
7. Test wear/charging transitions
8. Test voice-anywhere commands from each page
9. 30-minute continuous-use session, measure battery drain
10. Note any font rendering / scroll / lifecycle quirks vs simulator (log in ISSUES.md)

**Exit criteria**
- ✓ All golden-path scenarios pass on hardware
- ✓ No regressions vs simulator
- ✓ Battery drain <10% per 30-minute session
- ✓ All bugs filed in ISSUES.md with severity

**Depends on:** P11–P18

---

## P20 — Even Hub submission    [~2h]

**Deliverables**
- Production `.ehpk` build
- Even Hub listing metadata (name, description, screenshots, icons)
- Privacy policy URL (lightweight — single page on `vox.app/privacy`)
- App uploaded via portal at hub.evenrealities.com

**Tasks**
1. `evenhub pack app.json ./dist -o vox.ehpk`
2. Generate screenshots from simulator + hardware
3. Write privacy policy (deploy as static page)
4. Upload `.ehpk` via Even Hub portal (manual)
5. Fill listing metadata
6. Submit for review

**Exit criteria**
- ✓ App appears in Even Hub catalog
- ✓ Test install + launch from catalog works on real G2
- ✓ Submission accepted (no rejection on submission-gate violations)

**Depends on:** P19

---

## Summary table

| Phase | Title | Hours | Depends |
|---|---|---|---|
| P0  | Documentation & Setup        | 2  | — |
| P1  | Infrastructure               | 3  | P0 |
| P2  | Server core                  | 6  | P1 |
| P3  | LLM provider abstraction     | 4  | P2 |
| P4  | STT + intent + rewrites      | 5  | P2, P3 |
| P5  | Twilio (SMS)                 | 3  | P2 |
| P6  | Email (IMAP+SMTP)            | 7  | P2 |
| P7  | Contacts + Templates + Hist  | 3  | P2, P3 |
| P8  | Phone dashboard scaffold     | 6  | P2 |
| P9  | Onboarding wizard            | 6  | P5–P8 |
| P10 | Dashboard surfaces           | 10 | P5–P9 |
| P11 | HUD scaffold                 | 4  | P2 |
| P12 | HUD Smart Idle               | 5  | P7, P11 |
| P13 | HUD voice compose pipeline   | 7  | P4, P11 |
| P14 | HUD tone picker + send       | 4  | P5, P6, P13 |
| P15 | HUD inbox + reply            | 5  | P5, P6, P11, P12 |
| P16 | Voice-anywhere               | 6  | P4, P7, P11–P15 |
| P17 | Polish                       | 5  | P11–P16 |
| P18 | Hardening                    | 4  | P5, P6, P11–P16 |
| P19 | Hardware testing             | 6  | P11–P18 |
| P20 | Even Hub submission          | 2  | P19 |
| **Total** | | **~100h** | |
