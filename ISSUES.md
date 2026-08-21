# VOX — Issues, Risks, and Open Questions

**Purpose:** capture every non-trivial issue, risk, and open decision so we never re-litigate. Update continuously as we discover, fix, or punt items.

**Conventions:**
- Each entry has an ID (`I-001` issues, `R-001` risks, `Q-001` questions, `D-001` decisions)
- Severity: `critical` (blocks ship), `high` (degrades core flow), `medium` (degrades polish), `low` (minor)
- Status: `open`, `investigating`, `mitigated`, `resolved`, `wontfix`
- Owner: who's working on it
- All dates in `YYYY-MM-DD`
- **PII hygiene:** the GitHub repo is currently **private** (verified 2026-08-20 via `gh repo view`; several older entries below wrongly describe it as public). Keep the discipline anyway — visibility is one click away, history outlives the setting, and the `.ehpk` given to testers embeds the shared secret regardless. Never commit local filesystem paths, the server IP, the live domain, phone numbers, or real email addresses. Use placeholders (`<YOUR_DOMAIN>`, `<VPS_IP>`, `<your-org>`) in docs and example files; use env vars in code. A local pre-commit hook (`.git/hooks/pre-commit`) blocks the known PII patterns. See I-006.

---

## Open issues

| ID | Title | Severity | Status | Owner | Opened | Notes |
|---|---|---|---|---|---|---|
| I-001 | App runs as root on VPS | medium | open | Claude | 2026-05-13 | Hardening deferred: should create a non-root `vox` user with sudo, copy SSH key, run pm2 services as that user. Currently `vox-hello` runs as root. Mitigate before P10/P19 hardware tests. |
| I-002 | Server log retention not configured | low | open | — | 2026-05-13 | pm2 logs at `~/.pm2/logs/` grow without bound. Add logrotate rule before going live. |
| I-004 | First IMAP connect backfills entire mailbox history | low | open | — | 2026-05-13 | First-time IMAP IDLE pulled all 462 emails from Migadu (back to Nov 2025). Functional but heavy for a new account. Polish: on first connect, set imap_last_uid = (uidNext - 1) to start "fresh from now", with an opt-in "import history" toggle in the onboarding wizard. Update worker logic in P9 alongside the wizard. |
| I-005 | Inbox deduplication by Message-ID | low | open | — | 2026-05-13 | Self-sends (<YOUR_EMAIL> → <YOUR_EMAIL>) landed twice (id 461 + 462) because Migadu delivers to both Sent folder copy and Inbox. Add unique constraint on (user_id, raw_payload_json->message_id) or a dedup check in the IDLE fetch loop. |
| I-008 | app.json network whitelist needs pack-time domain substitution | low | open | — | 2026-05-14 | The committed `hud/app.json` keeps a `YOUR_DOMAIN` placeholder in the `network` permission whitelist so the live server domain stays out of git (PII scrub policy). `hud/pack.sh` substitutes the real domain from `VOX_DOMAIN` (env var or gitignored `hud/.env`) at build time. The simulator *bypasses* the whitelist gate so this only matters for on-device testing — verify in P19. |
| I-009 | Bitmap mascot via ImageContainerProperty (task #122) | low | open | — | 2026-05-27 | `ImageContainerProperty` accepts raw bytes but the format (bitmap layout, palette, endianness) isn't documented for 4-bit green. Scope-only investigation deferred — needs a hardware probe with known-good bytes and inspection of the resulting glyph. Currently we use ASCII art (fox icon) as the render surface instead. |
| I-011 | v0.1.16 companion app-home unverified on hardware | medium | open | — | 2026-08-20 | Phone companion rebuilt as a full app-home surface (identity header, service health, today tiles, quick-actions grid, richer activity). Headless-Chrome iPhone-width preview renders clean; awaiting real device install to verify iOS Even Realities WebView doesn't clip or reflow differently. |
| I-028 | Docs described the repo as public; it is private | low | resolved | 2026-08-20 | `CLAUDE.md`, `ISSUES.md` and `LESSONSLEARNED.md` all justified the PII policy with "the repo is public". `gh repo view` reports `visibility: PRIVATE`. Corrected the statements without relaxing the policy — the reasoning changes, the practice does not. Also found `main` had no upstream tracking and was 4 commits ahead, including v0.1.16 which PROGRESS.md recorded as pushed. Tracking set. |
| I-029 | Dashboard was desktop-only — unusable on a phone | high | resolved | 2026-08-20 | A grep for responsive breakpoints across `web/src` returned **zero** — the dashboard was built desktop-only, and the 240 px sidebar rendered unconditionally, leaving ~150 px of content on a 390 px iPhone. Since the companion's "Open dashboard" makes this the primary surface, that was the whole CRM experience on mobile. **Resolved:** sidebar becomes a drawer below `lg` with a sticky top bar; safe-area-aware gutters; 44 px touch targets on every control; 16 px inputs below `lg` so iOS stops zooming on focus; multi-column list rows restructured into two-line blocks; stat grids 2-up on phones; Modal is a bottom sheet under `sm`. Verified with Playwright at 320/390/844 and 1440: `scrollWidth === clientWidth`, 0 overflowing elements, 0 sub-44px targets, 0 sub-16px inputs, desktop rail unchanged. |
| I-030 | `px-safe` silently cancelled the page gutter | medium | resolved | 2026-08-20 | The first pass added `.px-safe { padding-left: env(safe-area-inset-left) }` and applied it as `px-4 px-safe`. Both set the same property, so the safe-area utility won and resolved to **0px** on any non-notched viewport — content sat flush against the screen edge, which looked exactly like the overflow bug it was meant to help. **Resolved:** gutters are additive — `.px-gutter` uses `max(1rem, env(safe-area-inset-left))`, keeping the designed gutter and only growing it where the inset is larger. |
| I-031 | iOS zoom guard lost to Tailwind's utility | medium | resolved | 2026-08-20 | The 16 px-inputs rule was written inside `@layer base` as a bare element selector, so Tailwind's `.text-sm` class beat it on specificity and all 13 controls on Preferences still measured 14 px — iOS would have zoomed on every field. Caught by measuring `getComputedStyle().fontSize` in Playwright rather than by eye; a screenshot cannot show this. **Resolved:** rule moved out of `@layer base` and given element+class specificity. |
| I-027 | Pairing QR embedded the permanent passkey | high | resolved | 2026-08-20 | The Account page QR encoded `{server, secret}` — the permanent shared secret in plaintext, on screen. Anyone who photographed it had unlimited Twilio/LLM spend indefinitely, undetectable and unrevocable short of rotating. **Resolved:** new `auth_handoffs` table + `POST /api/auth/handoff` (auth'd, mints a single-use token with a 180 s TTL, stores only SHA-256 of the token and the secret AES-GCM-encrypted) and `POST /api/auth/handoff/exchange` (burns the row inside the same transaction as the read, so racing exchanges cannot both win). The QR now carries `/connect?t=…` and shows a live countdown. 8 tests cover single-use, expiry, unknown token, no-plaintext-at-rest and the race. |
| I-019 | Inbox unread count is in the thousands | low | open | — | 2026-08-20 | Idle's Inbox row reads "99+ new" because the first IMAP sync backfilled the entire mailbox as unread (root cause is I-004). The badge is capped for display, but the underlying count is still wrong. Fix with I-004: on first connect set `imap_last_uid = uidNext - 1`, and offer a "mark all read" action. |
| I-020 | Inbound SMS never reaches the SSE stream | medium | open | — | 2026-08-20 | `routes/twilio-webhooks.ts` inserts the inbox row but never calls `inboxBus.publishNew` — the code comment says "SSE push to the HUD is wired in P15" and it never was. The email path (`mail/idle.ts:181`) does publish. Consequence: a dashboard or HUD subscribed to `/api/inbox/stream` sees new email live but not new SMS. Also no dedup on `MessageSid`, so a Twilio retry inserts a duplicate row (same class as I-005). |
| I-021 | `/webhooks/twilio/status` leaves the outbox row stale | low | open | — | 2026-08-20 | The delivery callback updates `history.status` keyed by `provider_message_id` but never touches the matching `outbox` row, which stays `'sent'` forever even when Twilio later reports `failed`/`undelivered`. Harmless today (nothing reads outbox status after send) but it makes the outbox useless as a retry queue. |
| I-022 | argon2 verify runs on every authenticated request | low | open | — | 2026-08-20 | `requireAuth` iterates every user row and runs `argon2.verify` (19 MiB, t=2) until one matches — roughly 30–50 ms added to every API call including the compose hot path, and O(n) once there is more than one user. Consider a short-lived in-memory cache keyed by a hash of the presented token. |
| I-012 | Auto-mode blocks safe direct push to main + Finder reveal | low | mitigated | Claude | 2026-08-20 | Harness classifier flags `git push origin main` and `open -R vox.ehpk` as needing explicit auth. Workflow is direct-push-to-main on the (private) repo, so this bounces every ship cycle. Mitigation: user runs those two commands manually after review. Could add Bash permission rules to `.claude/settings.json` but leaving to user's discretion. |

---

## Resolved / closed issues

| ID | Title | Severity | Status | Resolved | Resolution |
|---|---|---|---|---|---|
| I-007 | Text-drawn box frames can't align on the G2 font | medium | resolved | 2026-05-14 | The G2 firmware font renders box-drawing glyphs and letters at different advance widths, so a Pine-frame drawn as box chars in text `content` can't keep its right edge aligned (found in P11 simulator testing). **Fixed in P12:** `hud/src/render.ts` redesigned to frame with the SDK's real container `borderWidth`/`borderColor`/`borderRadius`; text `content` carries only inner lines. Smart Idle's three bordered containers render cleanly on the simulator. |
| I-013 | L:38 rebuild-container crash on shape re-expansion | high | resolved | 2026-07-28 | `bridge.rebuildPageContainer` fails silently when a rebuild re-introduces container IDs a prior smaller rebuild had dropped. Bit us three times (embedded picker in Confirm, send/sent transition, chrome pages). **Resolved:** `hud/src/render.ts` auto-pads every chrome page to the maximal 6-container shape at first render, so subsequent rebuilds never introduce new IDs. Any new page shape must respect the max or the pad must widen. |
| I-014 | U+25B8 ▸ cursor glyph missing from G2 font | medium | resolved | 2026-08-15 | Used `▸` (Black Right-Pointing Small Triangle) as the submenu affordance in Confirm's tone row. Sim log: `glyph dsc. not found for U+25B8`. **Resolved:** swapped to ASCII `>`. Verified-safe glyph set documented in `CLAUDE.md` and `LESSONSLEARNED.md` P19-prep retro. |
| I-015 | Phone companion never showed new sends | high | resolved | 2026-08-15 | `hydrate()` ran once on mount. New messages sent from the glasses never appeared in the WebView activity feed. Compounded by Nginx `304 Not Modified` on repeat fetches. **Resolved in v0.1.15:** 15 s poll while visible + `visibilitychange` refresh + `cache: 'no-store'` + `?_=${Date.now()}` cache-bust. `beforeunload` clears the interval. |
| I-016 | Phone companion felt like a debug view, not an app | medium | resolved | 2026-08-20 | v0.1.11–0.1.15 companion was a status banner + activity ticker. User: "it looks very generic." **Resolved in v0.1.16:** rewrite around real app-home semantics — identity header, service-health card, today tiles, quick-actions grid deep-linking to dashboard, richer activity feed with body previews, footer. Chrome-headless preview at iPhone width renders clean; pending hardware verification (see I-011). |
| I-017 | SDK drifted three minor versions unnoticed | low | resolved | 2026-08-15 | Shipped v0.1.11–0.1.14 on `@evenrealities/even_hub_sdk@0.0.10` while 0.0.13 was current — new features (`zOrderIndex`, `AudioInputSource`, `AppLocation` events, image picker) were on the table. **Resolved in v0.1.15:** bumped to 0.0.13; typecheck clean; no breaking changes hit us. Session ritual now includes `npm outdated @evenrealities/even_hub_sdk` every 2–3 iterations. |
| I-018 | PII pre-commit hook missed by large-diff rewrite | low | resolved | 2026-08-20 | v0.1.16 companion rewrite embedded the live domain as a hard-coded fallback for deep links. Pre-commit hook correctly blocked the commit. Fixed by replacing with `EMBEDDED_CONFIG.server ?? window.location.origin`. **Learning captured** in LESSONSLEARNED — for >200-line diffs, grep locally before staging; don't rely solely on the hook. |
| I-023 | Confirm's style row was never drawn (style stuck on Casual) | high | resolved | 2026-08-20 | Reported from hardware as "no way to select the message style, it appears permanently set to Casual." Not a routing bug: v0.1.15 sized Confirm's action list at 78 px for three rows on an assumed ~32 px row pitch, but the firmware draws list rows at **~40 px** (measured off rendered baselines: y = 99, 140, 181, 219). Three rows need ~134 px, so the third row — the tone submenu entry — was never rendered at all. Rows past a list container's height are NOT scrolled to; they simply do not exist on screen. **Resolved in v0.1.17:** `LIST_ROW_PITCH` corrected to 40, all list geometry derived from `listHeightFor(rows)` instead of hand-picked pixels, and Confirm's ready list reduced to a guaranteed-visible two rows (SEND / `Style: X >`) with channel switching moved into the submenu. Sim-verified end to end on the packed bundle. |
| I-024 | Launch tap bled through into the first mounted page | high | resolved | 2026-08-20 | Reported from hardware as "it briefly displays the main screen and then automatically switches to the Messages screen." Idle's only surface was a full-width capture container whose `onEvent` pushed ComposePage on ANY tap or list-select, so the temple touch that launches VOX was delivered to the freshly-mounted page and immediately opened the recording screen. **Resolved in v0.1.17:** the Router opens a 700 ms input-settle window on every mount and drops user-input events inside it (lifecycle events and mic audio are never suppressed, so the exit gate and mic teardown still work); Idle is now a menu, so a stray tap lands on a highlighted row rather than opening the mic; padding lists render with `isItemSelectBorderEn: 0` so the firmware can't attribute a selection to an off-screen container. Guard observed firing in the simulator. |
| I-025 | P15 inbox and P16 voice-anywhere were unreachable | high | resolved | 2026-08-20 | Found during the v0.1.17 architecture audit. When Idle was redesigned into the calm pulse surface at v0.1.11, it stopped being a menu — and nothing else ever pushed `InboxPage` or `VoicePage`. `navigateToInbox()` was exported but never called; `VoicePage` was referenced only by its own retry path and a comment. Two shipped phases had no entry point on the glasses, and `/api/voice-command` was dead in practice. **Resolved in v0.1.17:** the Idle hub links both. Prerequisite fix: `inbox.ts`/`inbox-read.ts` still carried the pre-chrome `{1,2,3}` container shape from P17, which would have re-introduced dropped container IDs on the way back to Idle — the exact L:38 trap — so both were migrated to the chrome shape first. |
| I-026 | Packed builds could invent a message from silence | high | resolved | 2026-08-20 | `compose.ts` fell back to a canned transcription ("send a text to alex saying running about ten minutes late, sorry") whenever fewer than 2 KB of PCM arrived, with only a `console.warn`. On hardware a mic failure would therefore walk the wearer into confirming and sending words they never spoke, to a real contact. **Resolved in v0.1.17:** the fallback is gated behind `import.meta.env.DEV`, so the simulator keeps it and a packed build raises "no audio from the mic". `audioControl` now also names `AudioInputSource.Glasses` explicitly instead of leaving the glasses-vs-phone choice to the host default. |
| I-003 | HUD must sanitize outbound rewrites for emoji/accents | medium | resolved | 2026-08-20 | Confirmed live, not theoretical: a real `/api/compose` call returned `casual: "Hey Alex, I'm gonna be about 10 mins late."` with U+2019 and `sarcastic: "...fashionably late—should arrive..."` with an em-dash, both of which the G2 font renders as missing-glyph boxes. **Resolved in v0.1.17:** new `hud/src/text.ts#sanitizeForGlasses` maps smart quotes, dashes, ellipsis and common emoji to ASCII, strips the rest, and preserves the card suits that ARE in the font. Applied inside `draft.getBodyText()` so the Confirm screen and the outbound send use the same string — the wearer always sends exactly what they approved. |
| I-010 | v0.1.15 tone submenu unverified on hardware | medium | resolved | 2026-08-20 | Verified — and it was broken. See I-023: the submenu logic was correct but its entry row was never rendered. Closed by the v0.1.17 geometry fix. |
| I-006 | Operational PII committed to public repo history | high | resolved | 2026-05-14 | Local paths, server IP, domain, phone numbers, and email addresses had accumulated across 13 per-phase commits in the public repo. **No secrets were ever committed** (`.gitignore` covered `.env` throughout — verified by scanning all history for the bootstrap secret / API keys / Twilio token / Migadu password → 0 hits). Remediation: (1) scrubbed all 13 working-tree files — code/config now flows through env vars + placeholder example files; (2) squashed all history into a single clean commit with a neutral GitHub-noreply author; (3) force-pushed `main`; (4) deleted the local backup branch + expired reflog + gc. Verified `origin/main` = 1 commit, 0 PII across all patterns + commit message + author. Pre-commit hook added locally to block future PII patterns. **Note:** GitHub may retain unreachable old commits accessible by direct SHA until its GC runs; for absolute certainty the repo can be deleted + recreated (no external engagement to lose). |

---

## Risks

| ID | Title | Severity | Status | Mitigation |
|---|---|---|---|---|
| **R-001** | SDK long-press detection isn't documented | medium | **resolved — capability now EXISTS** | I closed this on 2026-08-20 as "there is no long-press to detect", reading `OsEventTypeList` in **0.0.13** and generalising. Wrong: SDK **0.0.14** adds `LONG_PRESS_EVENT = 9` and `LONG_PRESS_RELEASE_EVENT = 10`, split precisely so hold-to-record works. Confirmed in the shipped `index.d.ts` and in the Even Hub developer newsletter (2026-08). See O-001 — this reopens hold-to-talk, which is the closest thing VOX has to its "less touches, more voice" north star. **Re-read the enum after every SDK bump.** |
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
| **R-017** | Microphone permission denied by user | medium | open | First-launch flow + onboarding wizard explicitly requests; HUD shows "Permission needed — open phone app to enable" message on `audioControl(true)` failure. Since v0.1.17 a packed build surfaces "no audio from the mic" rather than silently composing a canned message (I-026), so this failure mode is now visible instead of disguised. |
| **R-019** | SDK/CLI/simulator drift recurs between hardware cycles | low | open | Recurred once already: caught at 0.0.13 → 0.0.14 (plus CLI 0.1.13 → 0.1.14 and simulator 0.7.3 → **0.9.0**, two minors) during the v0.1.17 audit, despite I-017 adding a check to the session ritual. The ritual is not self-enforcing. Run `npm outdated` in `hud/` as the first step of every version bump, and note the versions in the P19-prep table row. |
| **R-018** | Even Realities phone app update breaks the SDK contract | low | open | `min_sdk_version` declared in `app.json`. If user's phone app is older, WebView refuses to launch with a clear update prompt. |

---

## Platform opportunities (new SDK capability, not yet adopted)

Source: Even Hub Developer Newsletter #1 (2026-08), verified against the
shipped `@evenrealities/even_hub_sdk@0.0.14` typings.

| ID | Capability | Why VOX cares | Cost to adopt |
|---|---|---|---|
| **O-001** | `LONG_PRESS_EVENT` / `LONG_PRESS_RELEASE_EVENT` (0.0.14) | Hold-to-talk. Today compose is tap-to-start / tap-to-stop, and a stray tap was the whole of I-024. Press-and-hold is unambiguous, self-terminating, and is the "less touches, more voice" interaction the RFP asked for. | Handle both events in `bridge.ts`; add a hold mode to `ComposePage`. No manifest change — it's an event we already receive. |
| **O-002** | Contextual menus — `menuObject` on create/rebuild, `menuItemClickEvent` | An OS-drawn command surface reachable from any page without spending body pixels. Style / Inbox / Voice command could hang off it, freeing the Idle hub body. | **Manifest change:** needs firmware 2.2.9 + Even App 2.2.9 + SDK 0.0.14, so `min_app_version` would have to rise from 2.0.0 → 2.2.9. That excludes testers on older phone apps (R-018). Do NOT bundle this with a bug-fix release. |
| **O-003** | `textColor` 0–4 on `TextContainerProperty` and `TextContainerUpgrade` | Real typographic hierarchy on a monochrome display. `render.ts` has carried a `Bright` palette since P12 that is applied to `borderColor` only — text brightness had no field to bind to until now. Omitted = device default 4. | Bind `Bright` to `textColor` in `textProp()`. Note the range is **0–4**, not the 0–15 the existing palette assumes — it needs remapping, not passing through. |
| **O-004** | `zOrderIndex` on list/text/image containers | Overlays without a page rebuild — the standing L:38 escape hatch. | Strict semantics: set on **all** containers or none, values unique per page; partial or duplicate payloads are rejected. `validateEvenHubPageContainer` (already wired into `showPage`) catches this before the bridge does. |
| **O-005** | LZ4 compression for raw image transfer | Nothing to do — automatic inside the SDK. Relevant only if I-009 (bitmap mascot) is ever picked up. | None. |

**Menu caveat:** the newsletter's example passes `position: 0` on each menu
item. The shipped `MenuItemProperty` has only `itemName` and `itemID`, and
its `toJson()` is documented as returning "only the supported first-level
fields" — so `position` is silently dropped. Don't build ordering
assumptions on it; verify against the typings, not the newsletter.

**Community:** Even Realities runs weekly developer AMAs on Discord,
Sundays 7 PM Pacific.

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
