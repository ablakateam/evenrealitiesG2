# VOX — Progress Tracker

**This file is the live ground truth of "what's happening right now." Update at the end of every work session, after any phase completes, and whenever a non-trivial decision is made.**

---

## Status snapshot

| Field | Value |
|---|---|
| **Current phase** | P18 ✓ complete → ready for P19 prep |
| **% complete (overall)** | 95% (P0–P18 done) |
| **Last update** | 2026-05-15 |
| **Active session** | P18 closed — per-user hourly rate limits wired on the four expensive routes (stt 60/h, rewrite/voice-command 1200/h, sms 200/h, email 400/h) using the existing `rate_limit_state` table; fails open on metering errors so a counter bug never blocks real work. `POST /api/telemetry/error` route writes to `client_errors`; HUD `main.ts` subscribes to global `error` + `unhandledrejection` events and ships them best-effort, plus the global event subscriber now closes the mic on FOREGROUND_EXIT so backgrounded VOX never drains the battery. |
| **Blockers** | — |
| **Next milestone** | P19-prep — build `.ehpk`, smoke-test it on the simulator end-to-end before the real-glasses test session |

---

## Phase checklist

- [x] **P0** Documentation & Setup *(complete 2026-05-13 — 5 docs committed, Node ≥20 verified, evenhub CLI v0.1.13 + simulator installed)*
- [x] **P1** Infrastructure *(complete 2026-05-13 — Ubuntu 24.04 VPS hardened, Nginx + Let's Encrypt cert, Node 20 + pm2, hello-world live at https://<YOUR_DOMAIN>)*
- [x] **P2** Server core *(complete 2026-05-13 — Express + TS + SQLite + argon2 auth + AES-GCM crypto; `/api/health` + `/api/config` live; 10/10 vitest tests pass; pm2 process `vox-server` replaced the P1 placeholder)*
- [x] **P3** LLM provider abstraction *(complete 2026-05-13 — interface + 4 implementations (Anthropic native SDK with prompt caching · OpenAI · OpenRouter · Ollama Cloud, last 3 share OpenAI-compatible client); curated catalog with speed glyphs; `/api/llm/models` + `/api/llm/test` live; 23/23 vitest tests pass)*
- [x] **P4** STT + intent + rewrites *(complete 2026-05-13 — Whisper STT, 6 tone-rewrite prompts + identity, intent parse; `/api/stt`, `/api/compose`, `/api/parse`, `/api/rewrite` live; full pipeline ~2.9s for STT+intent+7 variants; 37/37 vitest tests pass)*
- [x] **P5** Twilio (SMS) integration *(complete 2026-05-13 — `/api/sms` outbound with idempotency, `/webhooks/twilio/inbound` with signature verification, `/webhooks/twilio/status` for delivery callbacks; sanitization layer maps emoji → ASCII; 54/54 vitest tests pass; **real SMS delivered to <DEST_PHONE>** in 188ms, status callback confirmed `delivered`)*
- [x] **P6** Email (IMAP+SMTP) *(complete 2026-05-13 — `/api/email` SMTP send with idempotency, `/api/email-account` CRUD with libsodium AES-GCM at-rest encryption, IMAP IDLE worker class with exponential-backoff reconnect, IMAP manager spawning per-user workers on boot, `/api/inbox` paginated, `/api/inbox/:id/read`, `/api/inbox/stream` SSE; 66/66 vitest tests pass; **live-verified against Migadu — 462 emails pulled**; OAuth Gmail/Outlook deferred to P9 onboarding wizard)*
- [x] **P7** Contacts + Templates + History *(complete 2026-05-13 — contacts CRUD with E.164 normalization, favorite + tags, fuzzy name match resolver, CSV import; templates CRUD with drag-reorder + 12 seeded defaults; history paginated with channel/direction/date filters + stats roll-up; 81/81 vitest tests pass; Google People OAuth sync deferred to P9 wizard)*
- [x] **P8** Phone dashboard scaffold *(complete 2026-05-14 — `web/` Vite+React+TS+Tailwind, dark theme + G2-phosphor green, hand-rolled UI primitives, 9-section sidebar nav, auth guard + shared-secret storage, TanStack Query, Welcome screen, working Overview page (live /api/health + /api/history/stats), 7 stub pages; Nginx now serves SPA at root + proxies /api + /webhooks; live at https://<YOUR_DOMAIN>)*
- [x] **P9** Onboarding wizard *(complete 2026-05-14 — credential storage refactored to encrypted `integrations` DB rows with env-fallback; Twilio + LLM factory + Whisper STT all read DB-first; `/api/integrations` GET/PUT/DELETE + per-provider test routes; 6-step wizard at `/setup` (Welcome / Twilio / Email / AI / Contacts / Done) with real save+test per step; pairing QR on Done; "Finish setup" banner on Overview; 95/95 vitest tests pass. OAuth Gmail/Outlook one-click deferred — custom IMAP/SMTP path covers all providers)*
- [x] **P10** Dashboard surfaces *(complete 2026-05-14 — all 8 stub pages built into full surfaces: Integrations (per-provider cards + edit/test/remove modals + email account), Contacts (search, CRUD, favorite, CSV import), Templates (CRUD + up/down reorder), Inbox (list + thread + mark-read, 20s poll), Activity (filterable history + stats + CSV export), Preferences (5 sectioned config groups, auto-save), Diagnostics (run-all panel against `/api/diagnostics`), Account (pairing QR + secret rotation + sign out). Server: `/api/diagnostics` (5/5 checks pass live), `/api/account` + `/api/account/rotate-secret`. UI primitives added: Switch, Select, Modal, Field, InlineNote. Dashboard 99 KB gzipped. The full phone companion is functional.)*
- [x] **P11** HUD scaffold *(complete 2026-05-14 — `hud/` from the official `evenhub-templates/minimal`; bridge.ts (event normalization across sysEvent/textEvent/listEvent/audioEvent, CLICK_EVENT-as-undefined coalesced), kvs.ts (bridge.setLocalStorage wrapper + pairing store + URL bootstrap), api.ts (bearer-auth client to the VOX server), router.ts (page state machine + back stack), render.ts (container helpers + brightness palette), Idle placeholder page; root double-tap → `shutDownPageContainer(1)` exit gate enforced in main.ts; verified on `evenhub-simulator` via its :9898 automation API — render, tap→CLICK_EVENT→textContainerUpgrade, scroll, double-tap exit all confirmed; `vox.ehpk` packs (31.7 KB). Discovered I-007: text-drawn box frames can't align on the G2 font.)*
- [x] **P12** HUD Smart Idle *(complete 2026-05-14 — `/api/idle-suggestions` ranks unread-replies → quiet-streak contacts → compose + a status block; HUD render system redesigned to frame with real container `borderWidth` (I-007 resolved); Smart Idle page = title-bar + native scrollable suggestion list + footer, 3 bordered containers; status badges (NET/TWL/MAIL/BAT) live; tap routes to per-action stub pages; server CORS middleware added; verified on the simulator — renders cleanly, list selection highlight works, tap → stub routing confirmed; 95/95 server tests pass)*
- [x] **P13** HUD voice compose pipeline *(complete 2026-05-14 — `AudioRecorder` (RMS meter + silence/max auto-stop, fallback for sim's empty mic buffer), `ComposePage` (recording/transcribing/error visual states, awaited mic control to avoid bridge races), `ConfirmPage` (atom rows TO/VIA/TONE/MSG with `*..` confidence dots, SUBJECT row for email intent, native list cursor + stub routing on each atom tap), `render.ts` HMR-safe createStartUp fallback + rebuild retry; entire app converted to a fixed 3-container shape (title-text c1 / list-c2 capture / footer-text c3) after discovering `rebuildPageContainer` can't reintroduce dropped container IDs; verified end-to-end on the simulator — Idle → scroll → tap → record → tap-stop → /api/compose round-trip → confirm renders atoms → TO-row tap → P14 stub. Two new G2 SDK quirks logged in LESSONSLEARNED §P13.)*
- [x] **P14** HUD tone picker + send *(complete 2026-05-15 — shared `draft.ts` module holds the editable intent + variants between Confirm and the pickers; four real picker pages (`recipient-picker.ts`, `channel-picker.ts`, `tone-picker.ts`, `subject-prompt.ts`) push themselves on the router stack and mutate the draft; `ConfirmPage` refactored from a factory to a singleton that reads from the draft on every mount; SEND row triggers `sendDraft` which validates, posts to /api/sms or /api/email with idempotency, and routes to a channel-aware `Sent` page (`->` glyph for SMS, `>>>` for email, copy "Off to <name>" / "Off to <name>'s inbox"); compose.ts onEvent now handles both `tap` and `list-select` because its capture container is a list. **End-to-end sim test sent a real SMS to Dan's number via Twilio — history row #4, status=delivered.** Voice → confirm → send → delivered round-trip now ships.)*
- [x] **P15** HUD inbox + reply *(complete 2026-05-15 — `InboxPage` paginated list view, `InboxReadPage` factory for single-message body display with native scroll + reply action (marks read via /api/inbox/:id/read on mount); `draft.ts` extended with `replyContext` + `locked` flags + a `stagePrefillForReply` slot consumed on the next `setDraftFromCompose` call so ComposePage stays a single page; `ConfirmPage` honours the locks (cursor on locked row is a no-op) and shows "Reply to <sender>" as the title; idle's reply suggestions wired to fetch the inbox item and push the read view. Sim-verified: top idle reply → InboxRead → tap reply → record → ConfirmPage shows `=TO cs`/`=VIA Email` locked with ***confidence + "Reply to cs" title.)*
- [x] **P16** Voice-anywhere *(complete 2026-05-15 — server `/api/voice-command` classifier route + `buildVoiceCommandSystemPrompt` (compose·reply·navigate·search·save_contact·settings·cancel·unknown), HUD `VoicePage` (record → STT → classifier → dispatch), Idle has new `> Speak (voice)` + `> Open inbox` shortcuts at top; compose-intent dispatch re-runs `/api/compose` with the transcription and routes through Confirm; save_contact intent POSTs `/api/contacts` and shows a success stub; navigate intent calls `router.go(page)`. Long-press temple gesture verified impossible on the current SDK (Risk R1) — explicit Speak shortcut replaces it. Curl-verified: 5 critical intents return structured actions in <1s.)*
- [x] **P17** Polish (microcopy + empty/error states + first-run cue) *(complete 2026-05-15 — first-run `VoiceCuePage` (KVS `seen_voice_cue` flag gates it; teaches the "> Speak" pattern with concrete example utterances), Inbox sender row shows the full from_address instead of just the local part, `InboxReadPage.senderName` returns the full from_address so reply titles read meaningfully, VoicePage error copy reworked to be warmer + suggest a concrete next step, SentPage auto-returns to Idle after 4 s (footer reads "back in 4s") with the timer cleared on tap / unmount, Compose + Voice `mount()` paths defensively clear any prior tick before scheduling a new one so retries don't leak timers.)*
- [x] **P18** Hardening *(complete 2026-05-15 — server `rate-limit.ts` (per-user hourly buckets via the existing `rate_limit_state` table; fails open on metering errors so a counter bug never blocks real work) wired onto stt(60/h), rewrite(1200/h covers /api/compose + /api/voice-command), sms(200/h), email(400/h); 429 response includes Retry-After and an empathetic message. New `POST /api/telemetry/error` route persists client crash dumps to `client_errors`. HUD `main.ts` subscribes to global `error` + `unhandledrejection` events and ships them best-effort, plus the global event subscriber now closes the mic on FOREGROUND_EXIT_EVENT — backgrounded VOX never drains the battery. Outbox table + idempotency-by-client_uuid already in place from P5/P6.)*
- [ ] **P19** Hardware testing
- [ ] **P20** Even Hub submission

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Live production endpoints

| Endpoint | Auth | Status | Notes |
|---|---|---|---|
| `GET https://<YOUR_DOMAIN>/api/health` | public | 200 JSON | service/uptime/node/schema_version/user_count |
| `GET https://<YOUR_DOMAIN>/api/config` | Bearer secret | 200 JSON / 401 | full preferences object for authenticated user |
| `PUT https://<YOUR_DOMAIN>/api/config` | Bearer secret | 200 / 400 / 401 | partial preferences update with zod validation |
| `GET https://<YOUR_DOMAIN>/api/llm/models` | Bearer secret | 200 JSON | full provider+model catalog with speed glyphs; configured-providers list |
| `POST https://<YOUR_DOMAIN>/api/llm/test` | Bearer secret | 200 / 400 / 401 / 429 / 502 | round-trip test against a (provider, model) pair; returns text + latency + token counts |
| `POST https://<YOUR_DOMAIN>/api/stt` | Bearer secret | 200 / 400 / 401 | multipart audio → Whisper → `{text, language, duration_seconds, latency_ms}` |
| `POST https://<YOUR_DOMAIN>/api/compose` | Bearer secret | 200 / 400 / 401 | the hot path — audio OR transcription JSON → returns `{transcription, intent, variants[7]}` parallelized |
| `POST https://<YOUR_DOMAIN>/api/parse` | Bearer secret | 200 / 400 / 401 | text-only intent parse (no STT, no rewrites) |
| `POST https://<YOUR_DOMAIN>/api/rewrite` | Bearer secret | 200 / 400 / 401 | single-tone rewrite for re-runs / manual edits |
| `POST https://<YOUR_DOMAIN>/api/sms` | Bearer secret | 200 / 400 / 401 / 429 / 502 | send SMS via Twilio; idempotent by client_uuid; writes outbox + history rows |
| `POST https://<YOUR_DOMAIN>/webhooks/twilio/inbound` | Twilio signature | 200 TwiML / 403 | inbound SMS handler; resolves contact, sanitizes, writes to inbox |
| `POST https://<YOUR_DOMAIN>/webhooks/twilio/status` | Twilio signature | 204 / 403 | delivery callbacks update history.status |
| `GET https://<YOUR_DOMAIN>/api/email-account` | Bearer secret | 200 / 404 | masked view of configured email account (no secrets) |
| `PUT https://<YOUR_DOMAIN>/api/email-account` | Bearer secret | 200 / 400 | upsert creds (encrypted at rest); restarts IMAP IDLE worker |
| `DELETE https://<YOUR_DOMAIN>/api/email-account` | Bearer secret | 200 | delete account + stop IDLE worker |
| `POST https://<YOUR_DOMAIN>/api/email-account/test` | Bearer secret | 200 / 400 / 502 | send a test email through configured SMTP |
| `POST https://<YOUR_DOMAIN>/api/email` | Bearer secret | 200 / 400 / 401 / 502 | send email via user's SMTP; idempotent by client_uuid; writes outbox + history |
| `GET https://<YOUR_DOMAIN>/api/inbox` | Bearer secret | 200 | paginated inbox (filter: unread, channel; before_id cursor) |
| `GET https://<YOUR_DOMAIN>/api/inbox/:id` | Bearer secret | 200 / 404 | single inbox item detail with contact join |
| `POST https://<YOUR_DOMAIN>/api/inbox/:id/read` | Bearer secret | 200 | mark read; publishes SSE event |
| `GET https://<YOUR_DOMAIN>/api/inbox/stream` | Bearer secret | text/event-stream | real-time SSE of new + read events for the user |
| `GET https://<YOUR_DOMAIN>/api/contacts` | Bearer secret | 200 | paginated, with `?q=` search + `?favorites_only=true` filter |
| `POST https://<YOUR_DOMAIN>/api/contacts` | Bearer secret | 201 / 400 | create with E.164 normalization; rejects unreachable contacts |
| `GET/PUT/DELETE https://<YOUR_DOMAIN>/api/contacts/:id` | Bearer secret | 200 / 404 | single contact CRUD |
| `POST https://<YOUR_DOMAIN>/api/contacts/match` | Bearer secret | 200 | fuzzy name resolver: `{query}` → `{exact, partial, ranked}` |
| `POST https://<YOUR_DOMAIN>/api/contacts/csv` | Bearer secret | 200 | upsert from CSV (name, phone, email) |
| `GET https://<YOUR_DOMAIN>/api/templates` | Bearer secret | 200 | sorted by sort_order; 12 seeded defaults on first launch |
| `POST/PUT/DELETE https://<YOUR_DOMAIN>/api/templates/:id` | Bearer secret | 200 / 404 | CRUD |
| `POST https://<YOUR_DOMAIN>/api/templates/reorder` | Bearer secret | 200 | `{order: [id,id,...]}` |
| `GET https://<YOUR_DOMAIN>/api/history` | Bearer secret | 200 | paginated audit log (filters: channel, direction, contact_id, status, dates, q) |
| `GET https://<YOUR_DOMAIN>/api/history/stats` | Bearer secret | 200 | roll-up: sent/failed/received counts + cost_cents + tokens, today + total |
| `GET https://<YOUR_DOMAIN>/api/integrations` | Bearer secret | 200 | masked status of every provider (twilio + 4 LLM); source = db / env / none |
| `GET https://<YOUR_DOMAIN>/api/integrations/:provider` | Bearer secret | 200 / 400 | single provider view |
| `PUT https://<YOUR_DOMAIN>/api/integrations` | Bearer secret | 200 / 400 | store credentials (encrypted at rest) for a provider |
| `DELETE https://<YOUR_DOMAIN>/api/integrations/:provider` | Bearer secret | 200 | remove stored credentials (falls back to env if present) |
| `POST https://<YOUR_DOMAIN>/api/integrations/twilio/test` | Bearer secret | 200 / 400 / 502 | live Twilio test — sends an SMS if `to` given |
| `POST https://<YOUR_DOMAIN>/api/integrations/:provider/test` | Bearer secret | 200 / 400 / 502 | live LLM round-trip test |
| `GET https://<YOUR_DOMAIN>/api/account` | Bearer secret | 200 | account info (created_at, rotated_at) |
| `POST https://<YOUR_DOMAIN>/api/account/rotate-secret` | Bearer secret | 200 | generate a new shared secret, returns plaintext once |
| `POST https://<YOUR_DOMAIN>/api/diagnostics` | Bearer secret | 200 | run-all health check report (db, twilio, email, IMAP, LLM providers) |
| `GET https://<YOUR_DOMAIN>/api/idle-suggestions` | Bearer secret | 200 | Smart Idle ranking — suggestions[] (unread replies → quiet-streak → compose) + status block (twilio/email/today counts/unread) |
| `http://<YOUR_DOMAIN>/*` | — | 301 → HTTPS | auto-redirect via certbot config |
| unknown route | — | 404 JSON | `{"error":"not_found"}` |

**Bootstrap secret**: shown once in deploy output. Used as the bearer token until the user pairs a real device. Held only on the VPS in `/opt/vox/.env` (mode 600); never committed to git. Rotate via the dashboard after pairing.

VPS: Vultr · Ubuntu 24.04.4 LTS · hostname `even` · IP `<VPS_IP>` · `vox-vps` SSH alias in `~/.ssh/config`

**Dashboard**: `https://<YOUR_DOMAIN>/` serves the phone companion SPA (static, from `/opt/vox-web`). `/api/*` + `/webhooks/*` proxy to the Node app on :3000. Deploy with `web/deploy.sh`. Onboarding wizard at `/setup`.

**Credential model**: Twilio + LLM keys resolve **DB-first** (encrypted `integrations` rows written by the wizard) with **env-var fallback** (`/opt/vox/.env` — the bootstrap path). Email account creds live in the encrypted `email_accounts` table.

---

## This session

**2026-05-13**
- Full research dump on Even Realities G2 platform (3 parallel Explore agents — official docs, GitHub org, community notes)
- Multi-session brainstorm produced the comprehensive plan file at `<plan-file (local, not in repo)>`
- Locked architecture: Vultr VPS + Node/Express + SQLite, Twilio SMS, IMAP+SMTP for email (replacing SendGrid), pluggable LLM (4 providers), Pine/Norton-Commander HUD aesthetic
- P0 executed end-to-end:
  - Git working tree set up in `<project-root>/` with origin `<your-org>/<your-repo>`
  - `.gitignore` excludes `.claude/`, `node_modules`, `.env`, `*.ehpk`
  - 5 doc files written (RFP, PHASES, PROGRESS, ISSUES, LESSONSLEARNED) + README rewritten
  - Commit `8751baf` pushed to origin/main
  - Pre-flight: Node v20.17.0 ✓
  - Configured user-owned npm prefix `~/.npm-global` (avoids sudo)
  - Installed `@evenrealities/evenhub-cli@0.1.13` + `evenhub-simulator` globally
  - Added `~/.npm-global/bin` to PATH in `~/.zshrc` for future shells
  - Created project memory directory with 6 memory files (user-context, feedback-clarify, project-vox, plan-file ref, repo ref, G2 platform ref)
- **P1 executed end-to-end on Ubuntu 24.04 VPS (<VPS_IP>)**:
  - Generated local ed25519 SSH key, copied to VPS via `expect` + `ssh-copy-id` (one password use)
  - Added `vox-vps` alias to `~/.ssh/config` for ergonomic access
  - `apt update && apt upgrade` clean
  - Installed: Node 20.20.2 (via NodeSource), Nginx 1.24, Certbot 2.9, pm2 7.0.1, ufw 0.36.2, fail2ban 1.0.2, git, build-essential
  - Configured ufw: deny in / allow out / allow 22, 80, 443 — enabled at boot
  - Configured fail2ban with aggressive SSH jail (1h ban, 5 attempts in 10m)
  - Hardened sshd: `PasswordAuthentication no`, `PermitRootLogin without-password`, `KbdInteractiveAuthentication no` — placed in `/etc/ssh/sshd_config.d/00-vox-hardening.conf` (00- prefix needed because OpenSSH uses first-match-wins, cloud-init's 50- file would otherwise override)
  - Nginx site config for `<YOUR_DOMAIN>` proxies `/` → `127.0.0.1:3000`, with `.well-known/acme-challenge` carve-out
  - Let's Encrypt cert issued (expires 2026-08-12), Nginx auto-config'd with HTTPS + HTTP→HTTPS redirect, auto-renewal scheduled by certbot
  - Deployed `vox-hello` Express app to `/opt/vox-hello/` on port 3000, managed by pm2
  - `pm2 save` + `pm2 startup systemd -u root --hp /root` configured for boot persistence
  - External verification: `curl https://<YOUR_DOMAIN>/health` returns 200 JSON
- **Still user-blocked** (not for P2, but for P11+ when sideloading begins):
  - `evenhub login` (interactive — user runs `!evenhub login` in this prompt)

---

## Latest events (most recent first)

| Date | Event |
|---|---|
| 2026-05-14 | P12 complete: Smart Idle live on simulator — ranked suggestions, status badges, container-border visual system (I-007 fixed); server CORS added |
| 2026-05-14 | P11 complete: HUD scaffold from official template; bridge/router/kvs/api built; simulator-verified; vox.ehpk packs |
| 2026-05-14 | P10 complete: all 8 dashboard surfaces built + live; phone companion fully functional; server-side build complete |
| 2026-05-14 | P9 complete: credential storage → encrypted DB rows (env-fallback kept); 6-step onboarding wizard live at /setup; 95/95 tests |
| 2026-05-14 | Security: scrubbed operational PII from repo + history (no secrets ever leaked); pre-commit PII guard added (I-006) |
| 2026-05-14 | P8 complete: dashboard scaffold live at https://<YOUR_DOMAIN> — nav, auth guard, Overview page; Nginx serves SPA + proxies API |
| 2026-05-13 | P7 complete: contacts + templates + history CRUD; fuzzy match resolver; CSV import; 81/81 tests pass |
| 2026-05-13 | Migadu IMAP IDLE verified — 462 real emails pulled from <YOUR_EMAIL>; SMTP test delivered |
| 2026-05-13 | P6 complete: email account CRUD, SMTP send, IMAP IDLE worker, SSE inbox stream; 66/66 tests; ready for live credential test |
| 2026-05-13 | Real SMS delivered to <DEST_PHONE> (status: delivered); P5 fully verified |
| 2026-05-13 | P5 complete: Twilio SMS in + out, signature verification, sanitization; 54/54 tests; live SM SID returned in 402ms |
| 2026-05-13 | Twilio creds (SID/Token/From/MessagingServiceSID) added to VPS env |
| 2026-05-13 | P4 complete: voice→intent+7-rewrites pipeline live, 2.9s total round-trip via OpenAI |
| 2026-05-13 | OPENAI_KEY configured on VPS; user's prefs default rewrite provider switched anthropic → openai/gpt-4o-mini |
| 2026-05-13 | P3 complete: pluggable LLM (4 providers), `/api/llm/models` + `/api/llm/test` live, 23/23 tests pass |
| 2026-05-13 | P2 complete: vox-server live, /api/health + /api/config, 10/10 tests pass |
| 2026-05-13 | P1 complete: VPS hardened, Nginx + LE TLS, pm2-managed Express live at `https://<YOUR_DOMAIN>/health` |
| 2026-05-13 | EVENDEV → VOX project-wide rename (commit `8ce4920`) |
| 2026-05-13 | P0 complete: docs pushed, CLI tools installed, memory saved (commit `8751baf`) |
| 2026-05-13 | npm prefix moved to `~/.npm-global`; PATH added to `~/.zshrc` |
| 2026-05-13 | Git working tree initialized in `<project-root>/`, origin set to `<your-org>/<your-repo>` |
| 2026-05-13 | Plan locked + approved → exited plan mode → started P0 execution |
| 2026-05-13 | Voice-first audit completed → 15 gaps identified and fixed in plan |
| 2026-05-13 | Pluggable LLM added (Anthropic / OpenAI / OpenRouter / Ollama Cloud) |
| 2026-05-13 | IMAP/SMTP architecture replaces SendGrid for personal-email integration |
| 2026-05-13 | Inbound messaging added (Twilio webhook + IMAP IDLE → HUD banner / inbox / reply) |
| 2026-05-13 | Old-school HUD aesthetic locked (Pine email × Norton Commander × VT100) |
| 2026-05-13 | Atom-card confirm screen, Smart Pause, Smart Idle, tone memory, long-press send-last-to-last |
| 2026-05-13 | Initial plan: HUD-first messaging app with Twilio + (then SendGrid → IMAP/SMTP) + voice compose |
| 2026-05-12 | Research session began; working dir `<project-root>/` created |

---

## Decisions log (with rationale)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-13 | **IMAP+SMTP over SendGrid for email** | Personal-account integration > transactional sidecar identity. Sent items land in user's real Sent folder; replies appear in their normal inbox. |
| 2026-05-13 | **Pluggable LLM with 4 providers** | Flexibility (model choice), cost optimization, privacy escape hatch (Ollama Cloud), future-proofing. |
| 2026-05-13 | **Voice-anywhere as core principle** | Less touches, more voice — user's explicit ask. Voice = peer-level input on every page, not just Compose. |
| 2026-05-13 | **Pine/Norton-Commander aesthetic** | Fits 4-bit green HUD perfectly; users instantly grok the old-school terminal language. Single-line box drawing widely supported in G2 font; bracketed `[TAP]` action keys are clear. |
| 2026-05-13 | **Vultr over Cloudflare Workers** | User has existing Vultr account. Also gives us persistent IMAP IDLE workers (not feasible on Workers). |
| 2026-05-13 | **OpenAI Whisper for STT** | Best accuracy, simple API. No streaming partials but acceptable — we show local-RMS amplitude meter during recording, then a transcribing state. |
| 2026-05-13 | **Claude Haiku 4.5 as default LLM** | Fast (~300ms typical), cheap, smart enough for tone rewrites. Prompt caching halves second-call latency. |
| 2026-05-13 | **Phone companion in same Vite project as HUD** | One codebase, two render targets (DOM on phone, container API on glasses). Shared services/lib. |
| 2026-05-13 | **Documentation-first (5 markdown files before any code)** | Operating memory across multi-session build. Survives context compaction. Versioned in git. |
| 2026-05-13 | **Shared-secret auth (not OAuth user accounts)** | Single-tenant personal use; full multi-tenant auth is v2. Server hashes secret via argon2. |
| 2026-05-13 | **Smart Pause opt-in, default OFF** | Auto-send is powerful but scary; user must explicitly enable it after they trust the parsing. |
| 2026-05-13 | **GitHub repo: `<your-org>/<your-repo>`** | User-created, public, default branch `main`. Local at `<project-root>/`. |

---

## Up next

**Immediately after P0:**
1. Pre-flight: `node -v` (verify ≥20), `npm i -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator`, `evenhub login` (interactive — user runs)
2. Begin P1: provision Vultr VPS, configure domain DNS, install Nginx + Certbot

**User-blocked items:**
- Purchase / spin up Vultr instance (~$6/mo Ubuntu 22.04)
- Register / configure a domain pointed at the VPS IP
- Provide credentials (or run `evenhub login` interactively)
- Twilio account (if not already set up)

---

## Metrics dashboard

(Filled in as we go — empty until P19 hardware testing produces real numbers)

| Metric | Target | Actual |
|---|---|---|
| Tap-to-sent latency | ≤6s | — (full path needs P11+ HUD) |
| Whisper STT latency | <3s | (server smoke: ~1.5s on sample WAVs) |
| 7 parallel rewrites latency | <3s | **2.4s** (intent+6 rewrites in parallel, GPT-4o-mini) |
| Full compose pipeline (override) | ≤4s | **2.9s** end-to-end |
| Inbound SMS → HUD banner | ≤5s | — |
| Cold start (launch → idle) | <2s | — |
| Battery drain per 30-min session | <10% | — |
| IMAP IDLE uptime (24h) | 100% | — |
