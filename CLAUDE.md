# CLAUDE.md — VOX project onboarding

Read this first every session. It is the shortest possible path from cold
start to productive work. Every claim here is either invariant or points
to the file that owns the current truth.

---

## 1. What VOX is

Voice-first SMS + email companion for the **Even Realities G2** smart
glasses. Tap-to-speak on the temple → Whisper STT → LLM parses intent +
rewrites in 7 tones → HUD confirm → send via Twilio (SMS) or the user's
own SMTP (email). Replies flow back via Twilio webhook + IMAP IDLE into
a HUD inbox.

**Target user (v1):** single-tenant, the project owner. Multi-tenant
groundwork is there (per-user rows in every table) but auth is a shared
bearer secret, not OAuth logins.

**North-star metric:** tap-to-sent ≤ 6 s for a routine short SMS.

---

## 2. Where to look — canonical docs

| File | Purpose | When to read it |
|---|---|---|
| `RFP.md` | Frozen product contract. Scope, goals, success criteria. | On scope questions. Rarely changes. |
| `PHASES.md` | P0–P20 roadmap with "done when" gates. | Deciding "is this the right thing to build next?" |
| `PROGRESS.md` | Live status — what's done, what's next, live endpoints, decisions log. | **Every session start.** Ground truth for current phase. |
| `ISSUES.md` | Open issues, risks, questions, decisions with IDs (I-/R-/Q-/D-). | Before opening a new bug — see if it already has an ID. |
| `LESSONSLEARNED.md` | Per-phase retros + G2/SDK quirks. | When something surprising happens — check "have we seen this?" |
| `DEV/CLAUDE_SESSIONS.md` | Session-by-session narrative of the build. | For historical context on why a decision was made. |
| `STORE_LISTING.md` | Portal metadata for the Even Hub submission (P20). | When shipping the .ehpk publicly. |
| `~/.claude/plans/lets-research-this-https-hub-evenrealiti-enumerated-journal.md` | The canonical plan file — architecture, mockups, prompts, everything. | For any design-level question, not just "how do I use tool X". |

---

## 3. Repo layout

```
<project-root>/            ← this repo
├── CLAUDE.md              ← you are here
├── RFP.md · PHASES.md · PROGRESS.md · ISSUES.md · LESSONSLEARNED.md
├── STORE_LISTING.md · README.md
├── DEV/CLAUDE_SESSIONS.md
├── hud/                   ← the glasses HUD + phone companion (one Vite project, two entrypoints)
│   ├── app.json           ← package_id, version, min_sdk_version, permissions
│   ├── pack.sh            ← npm run build → sed YOUR_DOMAIN → evenhub pack → vox.ehpk
│   ├── src/
│   │   ├── main.ts        ← bootstrap + companion-vs-HUD detection
│   │   ├── bridge.ts      ← @evenrealities/even_hub_sdk normalization
│   │   ├── router.ts      ← page stack + input-settle window
│   │   ├── prefs.ts       ← /api/config mirror (default_tone, recording limits)
│   │   ├── text.ts        ← sanitizeForGlasses() — font-safe outbound text
│   │   ├── version.ts     ← APP_VERSION / SDK_VERSION (single source)
│   │   ├── kvs.ts · api.ts · render.ts · chrome.ts · draft.ts · pulse.ts
│   │   ├── pages/         ← idle(hub), compose, confirm, style, send, sent,
│   │   │                     inbox, inbox-read, voice, voice-cue, stub
│   │   └── companion/index.ts ← phone WebView (VOX app home)
│   └── .env               ← VOX_DOMAIN + VITE_VOX_SERVER + VITE_VOX_SECRET (gitignored)
├── server/                ← Node + Express + SQLite, deploys to Vultr
│   ├── src/               ← routes/*, llm/*, mail/*, db.ts, crypto.ts, auth.ts
│   └── deploy.sh          ← rsync dist + npm ci on VPS + pm2 reload
├── web/                   ← phone dashboard SPA (React + Tailwind, at https://<domain>/)
└── screenshots/           ← simulator captures — freshly regenerated per test cycle
```

The **HUD** and the **phone companion** are the same Vite bundle; the
bootstrap in `hud/src/main.ts` detects context and renders one or the
other. The **web dashboard** is a separate SPA served at `/` on the
same server.

---

## 4. Current state

**Version:** `0.1.17` (packed at `hud/vox.ehpk`, 55670 B, awaiting upload +
hardware test). Built against SDK `0.0.14`; `min_sdk_version` intentionally
stays `0.0.13` (see §7).

**Phase:** P0–P18 complete. P19 (hardware testing) is the active loop —
"P19-prep" is the sub-phase where the HUD is refined between each real
G2 test session.

**What's still pending:**
- Real-G2 verification of v0.1.17 (Idle hub + launch-settle, message style
  on the glasses, Inbox/Voice reachable again, style shared with dashboard)
- P20 Even Hub Beta submission with Store listing

For the exact "what changed in v0.1.X" and current live endpoints, read
`PROGRESS.md` (its status snapshot is the ground truth).

---

## 5. Dev loop

```bash
# Simulator (>= 0.9.0 injects REAL mic audio — the old "empty PCM" note is stale)
npx @evenrealities/evenhub-simulator          # opens :9898 automation API
curl http://localhost:9898/api/screenshot/glasses > shot.png
curl -X POST http://localhost:9898/api/input -d '{"action":"click"}'

# HUD dev (also serves the companion for iPhone-width preview)
cd hud && npm run dev                          # Vite on :5173

# Pack for hardware
cd hud && bash pack.sh                         # → hud/vox.ehpk
open -R hud/vox.ehpk                           # reveal for portal upload

# Server (already deployed on Vultr, rarely touched)
cd server && bash deploy.sh                    # rsync dist + pm2 reload
ssh vox-vps 'pm2 logs vox-server --lines 100'  # live tail
```

**Sim is the primary iteration surface.** Every UX change gets walked
through the simulator (screenshot each page, POST clicks) before
packing an .ehpk. Hardware round-trips are expensive because installs
go through the Even Hub portal.

---

## 6. Ship path — the .ehpk lifecycle

1. `bash hud/pack.sh` → `hud/vox.ehpk`
2. User uploads to `hub.evenrealities.com` portal (only path — no CLI
   install exists)
3. Portal defaults to **Private** track → shows "test version expired"
   to invited testers. **You must flip to Beta on the portal** for
   anything to actually install on the invited tester's glasses. This
   trips people up every time — see `feedback-even-hub-build-ttl.md`.
4. Tester installs from the Even Realities phone app
5. Real-G2 test session → issues → next iteration

---

## 7. Non-obvious rules (read before touching code)

**PII scrub.** `.githooks/pre-commit` blocks any commit
that touches paths, IPs, live domain, real emails, or phone numbers.
Never hardcode those in a tracked file. Use `<YOUR_DOMAIN>` in docs and
`process.env` / `EMBEDDED_CONFIG` in code. Real values live only in
`hud/.env` (build-time inline) and `/opt/vox/.env` on the VPS.

**Embedded secret pattern.** `hud/.env` supplies `VITE_VOX_SERVER` +
`VITE_VOX_SECRET`. Vite inlines them into `EMBEDDED_CONFIG` at build
time. Acceptable for Private/Beta because only the invited tester has
the .ehpk. Must be replaced with proper pairing before public
Production release.

**L:38 SDK quirk.** `rebuildPageContainer` silently fails when it
re-introduces container IDs a prior smaller rebuild had dropped. Every
chrome page in `render.ts` is now auto-padded to the maximal
6-container shape so this never happens again. If you add a new page
shape, verify the pad still covers the max.

**Never hand-pick a list container height.** The firmware draws list rows at
a **~40 px pitch**, and a list that is too short for its items does not clip
or scroll — the extra rows are simply never drawn, silently. Always size with
`render.ts#listHeightFor(rows)` and sanity-check with `listRowsVisible(h)`.
This is what made message style unreachable in v0.1.15/0.1.16 (I-023). Text
containers need >= 26 px per rendered line, same failure mode.

**The launch tap lands on your first page.** The temple touch that launches
VOX is delivered to whatever page mounts first. `Router` drops tap /
list-select / scroll for 700 ms after every mount (lifecycle events and mic
audio are never suppressed). Don't put an irreversible or mic-opening action
behind an undifferentiated tap on a root screen (I-024).

**"Done" means reachable.** P15's inbox and P16's voice-anywhere shipped,
were ticked complete, and then became unreachable when Idle was redesigned —
for months (I-025). After changing any navigation surface, sweep what used to
point out of it: anything not transitively pushed from `IdlePage` is either
dead code or a missing entry point.

**Preferences need a named reader.** The HUD ignored `/api/config` entirely
until v0.1.17, so every dashboard preference was inert on the glasses. When
adding a preference, name the client that reads it in the same change.

**SDK version policy.** Depend on the latest SDK, but keep
`min_sdk_version` at the oldest release whose *host-side* features we
actually use. 0.0.14's page validators are client-side (bundled, no host
round-trip) so they're free; its OS contextual menu and text brightness are
host-side and are deliberately unused. Run `npm outdated` in `hud/` as the
first step of every version bump — drift has recurred once already (R-019).

**G2 font gotchas.**
- `U+25B8 ▸` and other geometric arrows are **not** in the font — sim
  logs `glyph dsc. not found`. Use ASCII `>` instead.
- LLM rewrites arrive with curly quotes / em-dashes / emoji. Everything
  bound for the glasses goes through `text.ts#sanitizeForGlasses`, which
  `draft.getBodyText()` already applies so display and send never diverge.
- Double-line box drawing (`╔═╗`) is missing.
- Emoji not supported. `♥` (card suit) is the fallback for hearts.
- Text containers < 26 px tall clip content. Minimum height is 26.

**Platform capabilities added in SDK 0.0.14** (Even Hub newsletter 2026-08,
verified against the shipped typings — see ISSUES.md O-001..O-005):
- **Long press is real, and it is TWO events**: `LONG_PRESS_EVENT` (9) on
  press, `LONG_PRESS_RELEASE_EVENT` (10) on release. Absent in 0.0.13. This
  is the enabler for hold-to-talk. An earlier note in these docs claimed no
  long press existed — that was read off 0.0.13 and wrongly generalised.
  **Re-read `OsEventTypeList` after every SDK bump.**
- **Contextual menus**: pass `menuObject` to create/rebuild, handle
  `event.menuItemClickEvent.itemID`. Max 10 items, labels <= 32 UTF-8 bytes,
  itemID non-zero and unique. The gesture is **tap-and-hold** (a fast tap
  immediately followed by a hold), NOT a plain long press. Menus are a
  *command* surface — label entries as verbs ("Switch to night", not "Night
  mode"). **Requires firmware 2.2.9 + Even App 2.2.9**, so adopting it means
  raising `min_app_version` 2.0.0 -> 2.2.9 and cutting off older phone apps.
- **`textColor` 0–4** on `TextContainerProperty` / `TextContainerUpgrade` —
  brightness, not colour; omitted means device default 4. Note `render.ts`'s
  `Bright` palette is 0–15 and would need remapping, not passing through.
- **`zOrderIndex`**: set on ALL containers or none, unique per page, or the
  payload is rejected. `showPage` already runs `validateEvenHubPageContainer`
  which catches this locally.
- **LZ4 image compression** is automatic inside the SDK; no app-side change.

**`CLICK_EVENT` gotcha.** `CLICK_EVENT === 0` serializes to `undefined`
on the bridge. `bridge.ts` normalizes this — always route touch events
through the normalized `NormalizedEvent.kind` field, never raw. Same for
`currentSelectItemIndex`: omitted when 0, present and correct otherwise, so
`?? 0` is right. `currentSelectItemName` is never populated — don't route on
it. Pages should also check `event.containerID` against their own capture
container, since chrome pages carry off-screen padding lists.

**Container shape must stay stable within a page.** Prefer swapping
`content` via `textContainerUpgrade` or overlaying with SDK 0.0.13
`zOrderIndex` rather than rebuilding the page shape. Rebuilds are only
safe across full page transitions.

**Auto-mode command classifier.** Some things (SSH one-shots with
secrets, direct `git push origin main`, `open -R`) get blocked by the
harness. If a command bounces, don't retry destructively — ask the
user to run it themselves, or find a source-code-level equivalent.

---

## 8. Server, VPS, credentials

- **VPS:** Vultr, Ubuntu 24.04, hostname `even`. SSH alias `vox-vps` in
  `~/.ssh/config`. Runs Node 20 + Nginx + Let's Encrypt + pm2. App at
  `/opt/vox/`, dashboard SPA at `/opt/vox-web/`.
- **Domain:** the live production hostname. **Never** typed in a
  tracked file — always `<YOUR_DOMAIN>` in docs, `VOX_DOMAIN` env in
  code, `hud/.env` at build.
- **Shared secret:** held only in `hud/.env` (client) and `/opt/vox/.env`
  (server). Never in git. Rotate via `POST /api/account/rotate-secret`.
- **Live endpoints:** enumerated in `PROGRESS.md` under "Live production
  endpoints".

---

## 9. Working style with this user

- **Conversational text clarification, not multi-choice forms** — see
  memory `feedback-clarify-pattern.md`. `AskUserQuestion` is heavier
  than it needs to be for most questions.
- **Confirm before destructive git ops** — direct push to `main` bounces
  through the classifier. User does the push after review.
- **Commit convention:** `feat|fix|chore|docs(P<n>[-prep]): <summary>`
  with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
  in the trailer.
- **PII discipline is non-negotiable** — the repo is public. If a
  pre-commit hook fails, fix the source, don't `--no-verify`.

---

## 10. If you're picking up cold — the 60-second orientation

1. Read `PROGRESS.md` "Status snapshot" (top of file).
2. Read the latest 3–5 entries in `DEV/CLAUDE_SESSIONS.md`.
3. `git log --oneline -10` to see recent commits.
4. If the user's task involves the HUD: `ls hud/src/pages/` for
   available pages, then look up the specific one.
5. If it involves the server: `ls server/src/routes/` and pick the
   route by URL.
6. If it involves the phone dashboard: `ls web/src/pages/`.
7. If in doubt about the underlying design: search the plan file at
   `~/.claude/plans/lets-research-this-https-hub-evenrealiti-enumerated-journal.md`.
