# VOX — Issues, Risks, and Open Questions

**Purpose:** capture every non-trivial issue, risk, and open decision so we never re-litigate. Update continuously as we discover, fix, or punt items.

**Conventions:**
- Each entry has an ID (`I-001` issues, `R-001` risks, `Q-001` questions, `D-001` decisions)
- Severity: `critical` (blocks ship), `high` (degrades core flow), `medium` (degrades polish), `low` (minor)
- Status: `open`, `investigating`, `mitigated`, `resolved`, `wontfix`
- Owner: who's working on it
- All dates in `YYYY-MM-DD`
- **PII hygiene (the repo is public):** never commit local filesystem paths, the server IP, the live domain, phone numbers, or real email addresses. Use placeholders (`<YOUR_DOMAIN>`, `<VPS_IP>`, `<your-org>`) in docs and example files; use env vars in code. A local pre-commit hook (`.git/hooks/pre-commit`) blocks the known PII patterns. See I-006.

---

## Open issues

| ID | Title | Severity | Status | Owner | Opened | Notes |
|---|---|---|---|---|---|---|
| I-001 | App runs as root on VPS | medium | open | Claude | 2026-05-13 | Hardening deferred: should create a non-root `vox` user with sudo, copy SSH key, run pm2 services as that user. Currently `vox-hello` runs as root. Mitigate before P10/P19 hardware tests. |
| I-002 | Server log retention not configured | low | open | — | 2026-05-13 | pm2 logs at `~/.pm2/logs/` grow without bound. Add logrotate rule before going live. |
| I-003 | HUD must sanitize outbound rewrites for emoji/accents | medium | open | — | 2026-05-13 | LLM emits emoji (e.g. 😉 in sarcastic tone). G2 font can't render them. The plan's sanitization rules already cover inbound; ensure the same pass runs over `compose.variants[].text` before HUD display. Apply in P13 (HUD voice compose pipeline). |
| I-004 | First IMAP connect backfills entire mailbox history | low | open | — | 2026-05-13 | First-time IMAP IDLE pulled all 462 emails from Migadu (back to Nov 2025). Functional but heavy for a new account. Polish: on first connect, set imap_last_uid = (uidNext - 1) to start "fresh from now", with an opt-in "import history" toggle in the onboarding wizard. Update worker logic in P9 alongside the wizard. |
| I-005 | Inbox deduplication by Message-ID | low | open | — | 2026-05-13 | Self-sends (<YOUR_EMAIL> → <YOUR_EMAIL>) landed twice (id 461 + 462) because Migadu delivers to both Sent folder copy and Inbox. Add unique constraint on (user_id, raw_payload_json->message_id) or a dedup check in the IDLE fetch loop. |

---

## Resolved / closed issues

| ID | Title | Severity | Status | Resolved | Resolution |
|---|---|---|---|---|---|
| I-006 | Operational PII committed to public repo history | high | resolved | 2026-05-14 | Local paths, server IP, domain, phone numbers, and email addresses had accumulated across 13 per-phase commits in the public repo. **No secrets were ever committed** (`.gitignore` covered `.env` throughout — verified by scanning all history for the bootstrap secret / API keys / Twilio token / Migadu password → 0 hits). Remediation: (1) scrubbed all 13 working-tree files — code/config now flows through env vars + placeholder example files; (2) squashed all history into a single clean commit with a neutral GitHub-noreply author; (3) force-pushed `main`; (4) deleted the local backup branch + expired reflog + gc. Verified `origin/main` = 1 commit, 0 PII across all patterns + commit message + author. Pre-commit hook added locally to block future PII patterns. **Note:** GitHub may retain unreachable old commits accessible by direct SHA until its GC runs; for absolute certainty the repo can be deleted + recreated (no external engagement to lose). |

---

## Risks

| ID | Title | Severity | Status | Mitigation |
|---|---|---|---|---|
| **R-001** | SDK long-press detection isn't documented | medium | open | Prototype in P13 using `CLICK_EVENT` start/end timing >500ms. If unworkable, fall back to a tap-to-toggle voice mode button in title bar. |
| **R-002** | Whisper latency on slow networks | low | open | Show "Transcribing… (slow network)" hint after 5s. Allow user to switch to Deepgram (v2 feature) for streaming partials. |
| **R-003** | IMAP IDLE drops on cellular / sleep | medium | open | Exponential backoff reconnect (5s, 30s, 2m, 10m, 1h, give up). Telemetry alert at >3 failures/hour. SSE client also auto-reconnects to flush queued events. |
| **R-004** | OAuth refresh token revoked silently | medium | open | Worker catches `AUTHENTICATIONFAILED`, marks `email_accounts.imap_status = 'error'`, Smart Idle surfaces high-priority "Re-authorize email" suggestion. |
| **R-005** | Twilio number not delivering inbound (region restrictions) | low | open | Pre-flight in P5 with user's actual Twilio number. Document fallback to long-code if short-code blocked. |
| **R-006** | Even Hub submission rejected over root-double-tap requirement | high | mitigated | Hard-coded in `hud/src/main.ts` page router — root page double-tap always calls `shutDownPageContainer(1)`. Manual test in P19. |
| **R-007** | Network whitelist requires exact origins (no wildcards) | low | mitigated | `app.json` declares the single Vultr API origin. Future provider additions require app re-pack. |
| **R-008** | Browser localStorage wiped on app restart | low | mitigated | Use `bridge.setLocalStorage` for any state that must persist (shared secret, voice cue card flag, etc.). |
| **R-009** | Sanitizing emoji from incoming bodies may lose meaning | low | open | Map common emoji to ASCII (❤ → `<3`, 👍 → `+1`, 🙏 → `thx`); strip the rest. Keep raw body in `inbox.raw_payload_json` for dashboard display. |
| **R-010** | LLM provider 5xx errors mid-compose | medium | open | Implement fallback chain in `server/src/llm/factory.ts`: if user's chosen provider fails, retry once with the same provider, then fall back to a secondary (configurable). Surface fallback in HUD as small `(via fallback)` hint. |
| **R-011** | Daily AI cost caps hit during normal use | low | open | Conservative defaults (50k tokens/day). User can raise. Warning banner at 80%. |
| **R-012** | iCloud/Yahoo IMAP needs app passwords (no OAuth) | medium | open | Custom IMAP/SMTP form in onboarding step 3 collects host/port/credentials. Document the app-password setup in companion help text. |
| **R-013** | Spanish/non-English tone rewrites may drift register | low | open | Explicit language pin in tone prompts: "Rewrite this <lang> message in <tone>, keeping output in <lang>." Manual test set in P4. |
| **R-014** | SDK simulator differs from hardware (font, scroll, lifecycle) | medium | open | Always validate on real G2 in P19. Document deltas in LESSONSLEARNED.md as we find them. |
| **R-015** | Shared-secret leak = unrestricted Twilio/OpenAI spend | high | mitigated | Rate limiting per secret (60 STT/h, 600 rewrites/h, 200 sends/h, 50k tokens/day). Daily cost cap. Secret rotation flow in Account page. |
| **R-016** | Smart Idle suggestions feel intrusive / noisy | medium | open | Cap at 3 suggestions max. Each must beat a confidence threshold. Manual review in P12. Can disable via Preferences. |
| **R-017** | Microphone permission denied by user | medium | open | First-launch flow + onboarding wizard explicitly requests; HUD shows "Permission needed — open phone app to enable" message on `audioControl(true)` failure. |
| **R-018** | Even Realities phone app update breaks the SDK contract | low | open | `min_sdk_version` declared in `app.json`. If user's phone app is older, WebView refuses to launch with a clear update prompt. |

---

## Open questions (need a decision before relevant phase ships)

| ID | Question | Default | Decide by |
|---|---|---|---|
| **Q-001** | Should always-on voice listening be opt-in or opt-out? | Opt-in (battery concern) | P16 |
| **Q-002** | Daily AI-token cap default? | 50,000 tokens (~100 sends typical) | P18 |
| **Q-003** | Reply-aware tone matching: always on, or user-configurable? | Always on | P14 |
| **Q-004** | Should we ship inbound-email v1, or defer to v2? | v1 — IMAP IDLE is well-supported by `imapflow`, no DNS gymnastics required | P6 |
| **Q-005** | Microsoft OAuth: ship in v1 or v2? | v1 — most common Outlook scenario for personal users | P6 |
| **Q-006** | Banner UX: subtle title-bar overlay vs full-screen interrupt? | Subtle title-bar overlay | P15 |
| **Q-007** | History retention period before auto-delete? | 90 days (config in Preferences) | P10 |
| **Q-008** | Should sanitized incoming bodies preserve `♥` since G2 font supports it? | Yes — `♥` is in card suits, supported; map other emoji to nearest ASCII | P6 |
| **Q-009** | Dashboard theme toggle in v1, or just dark? | Dark only — match Even Hub | P8 |
| **Q-010** | What's the v1 cutline for "show this on Smart Idle" suggestion types? | Reply-waiting · time-of-day pattern · quiet streak · repeat templates (4 types only) | P12 |

---

## Decisions made (point-in-time record — also synced to PROGRESS.md)

| ID | Date | Decision | Why |
|---|---|---|---|
| D-001 | 2026-05-13 | IMAP+SMTP over SendGrid | Personal-account integration > sidecar transactional identity |
| D-002 | 2026-05-13 | Pluggable LLM (4 providers) | Flexibility + cost + privacy + future-proofing |
| D-003 | 2026-05-13 | Voice-anywhere as core principle | "Less touches, more voice" — user explicit ask |
| D-004 | 2026-05-13 | Pine/Norton-Commander aesthetic | Fits 4-bit green; instantly grokkable |
| D-005 | 2026-05-13 | Vultr VPS for backend | User has existing Vultr account + needs persistent IMAP IDLE workers |
| D-006 | 2026-05-13 | OpenAI Whisper for STT | Best accuracy; batch is acceptable given local amplitude meter UX |
| D-007 | 2026-05-13 | Claude Haiku 4.5 as default LLM | Fast, cheap, capable; prompt caching |
| D-008 | 2026-05-13 | Phone companion in same Vite project | One codebase, two render targets |
| D-009 | 2026-05-13 | Documentation-first (5 markdown files before code) | Operating memory across sessions |
| D-010 | 2026-05-13 | Shared-secret auth (not OAuth user accounts) | Single-tenant; full auth is v2 |
| D-011 | 2026-05-13 | Smart Pause opt-in, default OFF | Auto-send too aggressive without trust |
| D-012 | 2026-05-13 | GitHub repo `<your-org>/<your-repo>` | User-created, public |
| D-013 | 2026-05-13 | AES-256-GCM via `node:crypto` instead of libsodium | The `libsodium-wrappers-sumo` ESM build is broken (missing dist file); Node's built-in AES-GCM gives identical authenticated-encryption guarantees with zero external deps |
| D-014 | 2026-05-13 | rsync `dist/` + remote `npm ci` (vs ship local node_modules) | Native modules (`better-sqlite3`, `argon2`) must compile against the VPS Node binary's arch; deploying local Darwin-arm64 binaries to Linux-x64 would crash |

---

## How to use this file

1. **Found a bug or quirk?** → Add an `I-XXX` entry under Open issues. Set severity + status.
2. **Identified a risk before it becomes a bug?** → Add an `R-XXX` entry under Risks with a mitigation.
3. **Don't know what to decide?** → Add a `Q-XXX` under Open questions with a default + decide-by phase.
4. **Made a non-trivial choice?** → Add a `D-XXX` entry under Decisions; also mirror to `PROGRESS.md`.
5. **Closed an issue/risk?** → Move to Resolved section with `resolution:` note.
