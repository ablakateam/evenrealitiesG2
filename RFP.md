# VOX — Request for Proposal

**Status:** Frozen at P0. Updated only on scope changes.
**Last revision:** 2026-05-13

---

## 1. Executive Summary

VOX is a voice-first messaging companion for the Even Realities G2 smart glasses. It removes "phone-out latency" for routine messaging by letting the wearer dictate, confirm, and send SMS or email from the HUD without unlocking their phone. The same surface displays incoming SMS replies and emails in real time.

The product is delivered as an Even Hub `.ehpk` package backed by a Node server on Vultr. The HUD is the primary interface; a phone companion dashboard handles one-time setup and admin.

---

## 2. Problem Statement

Routine messages — "running late", "on my way", "got it" — currently require unlocking a phone, opening an app, finding the contact, and typing. That's 8–12 seconds per message and pulls the wearer out of whatever they were doing. The G2 already sits on the wearer's face with a microphone array, a display, and a temple touch surface; that's a complete I/O loop for messaging, going unused.

---

## 3. Goals & Objectives

### 3.1 Primary goals (v1)
1. **Voice-driven send in ≤6 seconds** from tap-to-talk to delivered.
2. **Two-way messaging** — incoming SMS + email surface on the HUD in real time.
3. **Voice anywhere** — voice is a peer-level input on every page (compose, navigate, correct, save contact, search, settings).
4. **HUD-first interface** — every operational action available without touching the phone.

### 3.2 Secondary goals
- Pluggable LLM (Anthropic / OpenAI / OpenRouter / Ollama Cloud) for cost + privacy flexibility
- Tone-aware rewrites (Casual / Professional / Friendly / Formal / Sarcastic / Grammar-fix / Original)
- Smart Idle context-aware suggestions
- Daily cost guardrails per integration
- Multi-device pairing (same account across multiple G2 pairs)

---

## 4. Scope

### 4.1 In scope (v1)
- Outbound SMS via Twilio API
- Outbound Email via user's own SMTP (Gmail/Outlook OAuth or custom IMAP/SMTP)
- Inbound SMS via Twilio webhook
- Inbound Email via IMAP IDLE persistent connection
- Voice compose pipeline (Whisper STT → Claude/LLM intent + 7 tone rewrites in parallel)
- Voice anywhere (8 intent classes: Navigate, Compose, Reply, Correct, Save contact, Search, Settings, Confirm/Cancel)
- HUD pages: Smart Idle, Compose, Confirm (SMS + Email variants), Tone picker, Recipient picker, Channel toggle, Subject prompt, Sent, Inbox, Read, Reply, Templates, Quick Send, Contacts, Contact detail, History, Settings, Menu, Empty/Error states
- Phone companion dashboard: Overview, Onboarding wizard (6 steps), Inbox, Contacts, Templates, Activity, Integrations, Preferences, Diagnostics, Account
- Smart Pause auto-send for short messages to recent recipients
- Tone memory per contact (silent learning)
- Long-press "send last body to last recipient"
- Offline outbox queue with exponential backoff
- Cost guardrails with HUD warning at 80% of daily caps
- Rate limiting per shared secret

### 4.2 Out of scope (v2+)
- Attachments (email)
- Group / broadcast sends
- CC / BCC for email
- UI localization (only voice language configurable in v1)
- Bring-your-own-Ollama (custom URL)
- Apple Mail / Yahoo OAuth (only Gmail + Microsoft OAuth in v1; iCloud/Yahoo via manual credentials)
- Multi-user / team accounts
- Custom tone prompts (preset 7 only)
- Voice cloning / TTS playback (G2 has no speaker)
- "Hey Even" system wake-word integration (impossible — SDK doesn't expose system AI intercepts)

---

## 5. Target User

**Primary:** single-tenant personal use (initially Dan / `<YOUR_EVEN_HUB_EMAIL>`). The architecture supports multi-tenant via per-secret isolation, but UX and onboarding are tuned for a single user managing their own account.

**Profile:**
- Owns a G2 + a Twilio account + an email account (Gmail/Outlook/custom)
- Comfortable with API keys and basic config
- Wants to message hands-free without taking out a phone
- Values privacy (IMAP/SMTP through their real account, not a sidecar identity)

---

## 6. Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| 6.1 | Outbound SMS via Twilio API | `nodemailer`-equivalent for Twilio (official SDK) |
| 6.2 | Outbound Email via user's SMTP | `nodemailer` with OAuth (Gmail/Outlook) or password (iCloud/custom) |
| 6.3 | Inbound SMS via Twilio webhook | Signature-verified, unguessable webhook URL per user |
| 6.4 | Inbound Email via IMAP IDLE | `imapflow` worker per user, auto-reconnect, OAuth-aware |
| 6.5 | Voice compose pipeline | Whisper STT + parallel 7 LLM rewrites + intent parse, total ≤4s |
| 6.6 | Voice anywhere | 8 intent classes via `/api/voice-command` classifier |
| 6.7 | Smart Idle suggestions | Server-ranked by reply-waiting, time-of-day pattern, quiet streak, repeat templates |
| 6.8 | Smart Pause auto-send | Triggers when body <60 chars + recent recipient + all confidence dots ●●● |
| 6.9 | Tone memory per contact | Silent learning from user overrides; default tone updates contact's `usual_tone` |
| 6.10 | Long-press send-last-to-last | Sustained temple touch re-sends previous body to previous recipient |
| 6.11 | Contact CRUD + Google sync | Server-side SQLite; Google People API OAuth |
| 6.12 | Template library | 12 phrases on first install; user can edit/add via dashboard |
| 6.13 | History + activity log | Every send/receive logged; cost meter per provider |
| 6.14 | Diagnostics page | One-tap end-to-end health check of every pipe |
| 6.15 | Onboarding wizard | 6 steps, ~3-minute completion target |
| 6.16 | Outbox queue | Server-side, exponential backoff, idempotent via UUID |
| 6.17 | Rate limiting | Per-secret caps on STT, rewrites, sends, daily AI tokens |
| 6.18 | Cost guardrails | User-configurable daily limits + 80% warning banner |
| 6.19 | Multi-device sync | SSE broadcast to all paired glasses for the same secret |
| 6.20 | OAuth refresh failure surfacing | Smart Idle promotes "Re-authorize email" when worker fails |
| 6.21 | Wear / charging state handling | HUD dims / sleeps based on SDK device status events |

---

## 7. Non-Functional Requirements

### 7.1 Performance
| Metric | Target |
|---|---|
| Tap-to-stop → Transcribing state | <100ms |
| Whisper STT response | <3s (typical short utterance) |
| Parallel 7 rewrites + intent parse | <3s (Anthropic Haiku default) |
| Tap-to-confirm-screen | ≤4s |
| Tap-to-sent | ≤6s typical |
| Inbound SMS → HUD banner | ≤5s |
| Inbound email (IMAP IDLE) → HUD | ≤5s |
| Cold-start (app launch → Smart Idle) | <2s |

### 7.2 Reliability
- Outbox queue + exponential backoff on transient failures (5s, 30s, 2m, 10m, 1h, give up)
- IMAP IDLE auto-reconnect on disconnect
- OAuth refresh on access-token expiry (Gmail/Outlook)
- Idempotent send via client-generated UUID
- SSE fallback to 5s polling if persistent connection drops

### 7.3 Security
- All API keys + OAuth refresh tokens encrypted at rest with libsodium secretbox
- Server master key in `.env`, never committed
- Shared-secret auth on every API call (argon2 hash, Bearer header)
- Twilio webhook signature verification (`X-Twilio-Signature`)
- Unguessable random subpaths for webhook URLs
- HTTPS-only via Nginx + Let's Encrypt
- No outbound API keys ever ship to the glasses (server-side only)

### 7.4 Privacy
- IMAP/SMTP through user's real account (no SendGrid sidecar identity)
- Optional Ollama Cloud / future BYO Ollama for AI privacy
- No third-party telemetry / analytics in v1
- `/api/telemetry/error` stays local to the Vultr box

### 7.5 Cost
- Default daily caps: 100 SMS sends, 50 emails, 50k AI tokens
- 80% warning banner on HUD + dashboard
- User-adjustable per integration
- Real-time cost meter on dashboard (Twilio rate + OpenAI tokens + Claude tokens)
- Provider switchable in Preferences for cost optimization

---

## 8. Technical Architecture (one-page summary)

### 8.1 Three tiers
```
HUD webview (G2)
  ─ TS + Vite + SDK container model
  ─ Voice / tap input → bridge calls → server
        │
        ▼
Phone companion dashboard
  ─ React + Tailwind + shadcn/ui
  ─ Setup, admin, monitoring
        │
        ▼
Server (Vultr VPS)
  ─ Node + Express + SQLite + IMAP IDLE workers
  ─ All secrets, all third-party API calls
        │
        ▼
Third-party APIs
  ─ Twilio · User's SMTP+IMAP · OpenAI Whisper
  ─ LLM (Anthropic / OpenAI / OpenRouter / Ollama Cloud)
  ─ Google People API
```

### 8.2 Stack
- **HUD + companion**: TypeScript, Vite, `@evenrealities/even_hub_sdk`, React (companion only), Tailwind, shadcn/ui
- **Server**: Node 20+, Express, TypeScript, better-sqlite3, nodemailer, imapflow, twilio, openai, @anthropic-ai/sdk, googleapis, libsodium
- **Infra**: Vultr VPS (Ubuntu 22.04), Nginx, Let's Encrypt, pm2
- **VCS**: GitHub `<your-org>/<your-repo>`

### 8.3 LLM provider abstraction
Pluggable via `server/src/llm/provider.ts`. Four implementations: Anthropic (native SDK), OpenAI, OpenRouter, Ollama Cloud (last three share an OpenAI-compatible client). User picks provider + model in Preferences with `⚡ fast / ⚙ balanced / 🐢 slower` glyphs.

### 8.4 Full architectural detail
See `<plan-file (local, not in repo)>` — the plan file contains complete page mockups, server route inventory, DB schema, prompt library, and design system.

---

## 9. Constraints

### 9.1 Hardware (G2)
- Display 576×288, 4-bit greyscale (green only), single firmware font, left-aligned only
- Microphone-only audio (no speaker, no TTS)
- No camera
- Bluetooth 5.2 (dual L/R lens)
- IMU + geomagnetic exist but not exposed via web SDK
- Battery ~2.5 days; mic streaming drains faster

### 9.2 SDK (`@evenrealities/even_hub_sdk` v0.0.10)
- Container-based UI only (no free pixel drawing)
- Max 12 containers per page (4 image + 8 text/list)
- Exactly one container per page has `isEventCapture: 1`
- No system-tray push notification API
- No raw BLE access
- No "Hey Even" wake-word intercept
- Browser localStorage is wiped on restart (must use `bridge.setLocalStorage`)

### 9.3 Even Hub submission gates
- Root double-tap must call `shutDownPageContainer(1)` (auto-reject otherwise)
- Edition `"202601"`, `min_sdk_version "0.0.10"` in `app.json`
- Network whitelist requires explicit origins (no wildcards)
- `g2-microphone` permission declared

### 9.4 Whisper batch-only
- No streaming partials; must show "Transcribing…" state during the ~2s gap
- Local amplitude meter (computed from PCM RMS) compensates visually

---

## 10. Success Criteria

| # | Criterion | How verified |
|---|---|---|
| 10.1 | v1 ships to Even Hub | `.ehpk` uploaded; app shows in catalog |
| 10.2 | End-to-end voice → SMS in <6s | Stopwatch test on real G2 hardware |
| 10.3 | Inbound SMS → HUD banner in <5s | Send a real SMS to Twilio number, time the banner appearance |
| 10.4 | IMAP IDLE stays up for 24h | Server logs show 0 unrecovered disconnects in a 24h window |
| 10.5 | All 7 tones produce coherent rewrites | Manual review of 20 sample messages × 7 tones |
| 10.6 | Voice-anywhere navigation works | Say "open inbox" from idle → inbox loads |
| 10.7 | Offline mode queues a send | Toggle airplane mode mid-send, verify queue + flush on reconnect |
| 10.8 | Onboarding completable in <5 min | Time a fresh setup from blank install |
| 10.9 | All Diagnostics tests pass green | One-tap from dashboard → all checks ✓ |
| 10.10 | OAuth re-auth flow works after token revoke | Manually revoke Google access, verify Smart Idle surfaces re-auth |

---

## 11. Stakeholders

| Role | Person | Contact |
|---|---|---|
| Owner / product | Dan (<your-org>) | <YOUR_EVEN_HUB_EMAIL> (Even Hub) · <YOUR_EMAIL> |
| Build | Claude (claude-opus-4-7) | this session + future sessions via memory + docs |
| Repo | `<your-org>/<your-repo>` | https://github.com/<your-org>/<your-repo> |

---

## 12. Timeline Overview

~20 phases (P0–P20), ~100 hours of focused build time. Full breakdown in `PHASES.md`.

**Rough buckets:**
- P0–P3 (setup + server foundation): ~15h
- P4–P7 (integrations + AI pipeline): ~18h
- P8–P10 (phone dashboard): ~22h
- P11–P16 (HUD complete): ~31h
- P17–P20 (polish, hardening, hardware test, submit): ~17h
