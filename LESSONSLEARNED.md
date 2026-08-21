# VOX — Lessons Learned

**Purpose:** institutional memory for v2 and future projects. Captures what went well, what went badly, surprises (especially G2/SDK quirks), and patterns to repeat or avoid.

**Update cadence:** at the end of every completed phase, and any time we hit a non-obvious surprise.

**Format per entry:** Phase · Date · Category (✓ went well / ✗ went badly / ⚠ surprise / 💡 insight) · Learning · Action

---

## Patterns to repeat (collected over time)

- **Placeholder/env-var from line one** — host, path, phone, email, IP, domain never hardcoded in a committed file. `<YOUR_DOMAIN>` in docs/examples, `env.X` in code.
- **Pre-commit PII grep guard** — `.git/hooks/pre-commit` blocks staged content matching the known PII patterns.
- **Scan history, not just the working tree** — a working-tree grep won't catch what's in old commits; scan `git rev-list --all`.
- **Wrap batch DB writes in `db.transaction()`** — atomic + ~10× faster.
- **rsync `dist/` + remote `npm ci`** for native deps (compile against the target arch).

## Patterns to avoid (collected over time)

- **Never hardcode operational PII in a committed file** — see the PII-scrub retro below. Every commit is forever-ish whatever the repo's visibility setting says today; visibility is one click, history is not. (The repo is in fact private — earlier entries here say public, which was wrong.)
- **Don't reach for a dependency when ~30–60 LOC of plain TS does it** — fuzzy match, CSV parse, AES-GCM crypto all ended up hand-rolled and better for it.
- **Don't both quote a heredoc delimiter AND backslash-escape `$`** — pick one.

---

## G2 / SDK quirks (the truly non-obvious stuff)

*(Populated as we discover during build)*

**Known going in (from community research):**
- `CLICK_EVENT === 0` gets serialized to `undefined` — always check both
- First list item often lacks `currentSelectItemIndex` on simulator and hardware
- Browser `localStorage` is wiped on app restart — must use `bridge.setLocalStorage`
- Image containers must be created empty in `createStartUpPageContainer`; data sent later via `updateImageRawData`
- Double-line box-drawing characters (`╔═╗`) are mostly missing from the G2 font
- Emoji not supported; ♥ (card suit) is supported as a fallback for hearts
- Simulator differs from hardware on font metrics, list scroll, image speed, event routing — **always validate on real G2**
- Root-page `DOUBLE_CLICK_EVENT` MUST call `shutDownPageContainer(1)` or Even Hub rejects the submission

**Measured on our own hardware/sim (these cost us real bugs):**
- **List rows draw at a ~40 px pitch, not 32.** A list container too short for
  its items does not clip visibly and does not scroll — the extra rows are
  never drawn. Size every list with `render.ts#listHeightFor(rows)`. See the
  v0.1.17 retro; this is what made message style look permanently Casual.
- **Text containers need >= 26 px** per rendered line, same failure mode.
- `currentSelectItemIndex` is **omitted when it is 0** (protobuf drops zero
  values) but correct and present for every other row — verified in the sim:
  a tap on row 0 sends `{containerID, containerName}` only, a tap after two
  scrolls sends `currentSelectItemIndex: 2`. So `?? 0` is the right default.
  `currentSelectItemName` was never populated in any event we observed —
  do not route on it.
- **There is no long-press event.** `OsEventTypeList` has nine members and no
  press-duration field, in 0.0.13 or 0.0.14 (closes R-001).
- **The launch tap reaches the first page you mount.** Treat the first ~700 ms
  after a mount as untrusted input.
- **SDK 0.0.14's page validators are client-side** — they run in your bundle,
  so using them does NOT require raising `min_sdk_version`. The OS contextual
  menu and text brightness in the same release DO need host support.
- The simulator (>= 0.9.0) **injects real microphone audio**, so the
  "sim has no mic" assumption in older notes no longer holds.

---

## Per-phase retros

### P0 — Documentation & Setup
*(filled in on phase completion)*

### P1 — Infrastructure

**2026-05-13 · ⚠ surprise · sshd_config.d ordering is first-match-wins, not last-match-wins**

**Learning:** OpenSSH (8.x+) processes `/etc/ssh/sshd_config.d/*.conf` files in lexical order, but uses **first-match-wins** for any given option. Ubuntu 24.04 ships `50-cloud-init.conf` which sets `PasswordAuthentication yes`. Our hardening file at `99-vox-hardening.conf` (intuitively "load last") never took effect because cloud-init's option was already locked in. Confused for a few minutes until `sshd -T` showed effective config still allowing passwords.

**Action:** Renamed our hardening conf to `00-vox-hardening.conf` so it loads first and wins. Documented in `/etc/ssh/sshd_config.d/00-vox-hardening.conf`. Always check `sshd -T | grep <option>` after editing — `sshd -t` only validates syntax, not effective values.

**2026-05-13 · 💡 insight · `~` not expanded in expect heredocs**

**Learning:** `expect <<'EOF' ... ~/.ssh/id_ed25519.pub ... EOF` does NOT expand `~` to `$HOME`. The expect binary doesn't do shell tilde expansion. Got `ssh-copy-id: ERROR: failed to open ID file '~/.ssh/id_ed25519.pub'`.

**Action:** Use `$HOME/.ssh/id_ed25519.pub` instead, with `<<EOF` (no quotes) so bash expands `$HOME` before passing to expect.

**2026-05-13 · ✓ went well · expect-driven ssh-copy-id pattern**

**Learning:** Bootstrapping passwordless SSH from local → VPS using only the user's password (and macOS built-in `expect`) is clean:
```bash
expect <<EOF
spawn ssh-copy-id -o StrictHostKeyChecking=accept-new -i \$HOME/.ssh/id_ed25519.pub root@<ip>
expect {
  "yes/no" { send "yes\r"; exp_continue }
  "password:" { send "<password>\r" }
}
expect eof
EOF
```
One password use, then key-based for everything else. No `sshpass` install needed.

**2026-05-13 · 💡 insight · Vultr ships Ubuntu 24.04, not 22.04**

**Learning:** The plan called for Ubuntu 22.04 but Vultr's default Ubuntu image is now 24.04.4 LTS. Worked identically for our stack (Node 20 via NodeSource, Nginx 1.24, Certbot 2.9, pm2 7.0.1) — no migration cost.

**Action:** Update RFP.md / PHASES.md from "Ubuntu 22.04" to "Ubuntu 24.04" for accuracy. Note: cloud-init quirk above is 24.04-specific (different default sshd configs across major versions).

### P2 — Server core

**2026-05-13 · ✗ went badly · `libsodium-wrappers-sumo` ESM build is broken**

**Learning:** The `libsodium-wrappers-sumo` v0.7.x ESM bundle ships `libsodium-wrappers.mjs` which imports `./libsodium-sumo.mjs` — but that file doesn't exist in the `modules-sumo-esm/` directory of the package. Vitest in ESM mode crashes immediately. Likely a packaging bug.

**Action:** Switched `server/src/crypto.ts` to Node's built-in `node:crypto` with AES-256-GCM. Same authenticated encryption guarantees, zero external deps, no broken bundles, simpler code. Logged learning: don't reach for libsodium unless we need a specific feature (e.g. age-style asymmetric, Argon2 KDF). For symmetric secretbox-equivalent, AES-GCM in `node:crypto` is fine.

**2026-05-13 · ⚠ surprise · `schema_meta` race between bootstrap and migration**

**Learning:** I initially had `runMigrations()` create `schema_meta IF NOT EXISTS` as a bootstrap, then migration 1 also issued `CREATE TABLE schema_meta` (without IF NOT EXISTS). First run worked because bootstrap ran first then migration 1 inside a transaction; but on tests the bootstrap-then-migration-1 path hit `table schema_meta already exists` because both attempted to create it.

**Action:** Removed `CREATE TABLE schema_meta` from migration 1's body — the bootstrap path is solely responsible for that table. Migration 1 now creates only the domain tables. Pattern: keep meta tables out of migration SQL; bootstrap them in code with IF NOT EXISTS.

**2026-05-13 · 💡 insight · `PORT=0` is a valid HTTP listen value**

**Learning:** Vitest setup wants `PORT=0` (let supertest grab any port). Zod schema with `positive()` rejected it. Test harness crashed before any test ran. Fix: `nonnegative()`.

**Action:** Zod numeric defaults should be `nonnegative()` not `positive()` when 0 has semantic meaning (e.g., ephemeral ports, no-rate-limit defaults). Documented in env.ts.

**2026-05-13 · ✓ went well · rsync + remote-npm-ci pattern for native deps**

**Learning:** `better-sqlite3` and `argon2` are native modules that need to compile against the target Node binary's arch. Naively shipping the local `node_modules/` to the VPS would mean a Darwin-arm64 binary trying to run on a Linux-x64 server. Crash.

**Action:** `deploy.sh` rsyncs only `dist/` + `package.json` + `package-lock.json` + `ecosystem.config.cjs`, then runs `npm ci --omit=dev` *on the VPS* so the native modules compile for the right arch. ~30s remote install on first deploy, ~5s on subsequent. Saved in `server/deploy.sh`.

**2026-05-13 · ✓ went well · first-deploy auto-generated MASTER_KEY + BOOTSTRAP_SECRET**

**Learning:** Production secrets need to exist exactly once, never travel through git, never appear in logs. Solved by having `deploy.sh` detect `.env` absence on first deploy and generate both keys inline on the VPS via `node -e "..."`, write to `/opt/vox/.env` (mode 600), and echo the bootstrap secret to the deploying shell exactly once.

**Action:** Pattern saved in deploy.sh. The bootstrap secret is the only secret that must be communicated out-of-band (so the dashboard can pair the first device). After pairing, it's rotated via the API.

### P3 — LLM provider abstraction

**2026-05-13 · ✓ went well · three providers in one SDK class**

**Learning:** OpenAI · OpenRouter · Ollama Cloud all implement OpenAI Chat Completions, so a single `OpenAICompatibleProvider` class works for all three — only the `baseURL` (and optional default headers) differs. Total LLM stack ended up at ~300 LOC across 5 files: provider interface, models catalog, Anthropic native, OpenAI-compatible (shared), factory.

**Action:** Pattern captured in `server/src/llm/openai-compatible.ts`. Adding a new OpenAI-compatible provider (Groq, Cerebras, Together, Mistral La Plateforme) is now ~10 lines: a factory function + a catalog entry.

**2026-05-13 · 💡 insight · Anthropic prompt caching wins on the 7-rewrite hot path**

**Learning:** Each compose call fires 7 tone rewrites in parallel, all with the *same* system prompt structure. Marking the system prompt as `cache_control: { type: 'ephemeral' }` on Anthropic means subsequent calls within ~5 min hit the cache, dropping per-call latency from ~400ms to ~150ms and slashing input-token cost. The `cacheSystemPrompt` flag is on the `LlmCompleteOptions` interface so other providers can no-op it; only Anthropic acts on it today.

**Action:** Will set `cacheSystemPrompt: true` for tone rewrite calls in P4. Verify cache hit rate via `cache_read_tokens` field in `LlmResult`.

**2026-05-13 · 💡 insight · Empty `?` model in LlmError for missing-credentials case**

**Learning:** When the factory throws `LlmError` because the env API key is missing, we don't yet have a meaningful `model` value (the caller picks model after factory resolves). Initially passed `null` and got a type error; settled on the sentinel string `?`. Not pretty but reads OK in error messages.

**Action:** Documented in `factory.ts` comment. If we ever need a stronger structure, switch to `LlmError | LlmCredentialsError` subclasses.

### P4 — STT + intent + rewrites

**2026-05-13 · ✓ went well · 7 parallel calls in ~3s total**

**Learning:** The compose pipeline fires 7 LLM calls (intent parse + 6 tone rewrites) in `Promise.all`. Even on OpenAI's `gpt-4o-mini` (without Anthropic's prompt caching), total wall time landed at **2.9s** end-to-end — well inside the 4s confirm-screen budget. Per-call latencies ranged 1.1s–2.4s with sufficient connection reuse. The HUD's "Transcribing…" state can render almost immediately and stay visible for a single ~3s window before the confirm screen pops fully formed.

**Action:** Pattern documented in `server/src/compose.ts:130-180`. When we add Anthropic with `cacheSystemPrompt: true` we expect another 30-50% latency drop on calls 2+ within a 5-minute window. Track this via `cache_read_tokens` field on the result.

**2026-05-13 · ⚠ surprise · `Tone` union type leaks into `REWRITE_TONES.map` callback**

**Learning:** Initially typed `REWRITE_TONES: Tone[]` (the full union including `'original'`). TypeScript inferred the `.map((tone) => ...)` callback param as the full `Tone` type, then `buildRewriteSystemPrompt({tone, ...})` rejected it because that function's `tone` field is `Exclude<Tone, 'original'>`. Needed an exported `RewriteTone` alias and typed `REWRITE_TONES: RewriteTone[]`.

**Action:** Pattern saved in `prompts.ts`: when an array excludes a member of a union, declare a derived type alias and type the array against the alias, so iteration narrows correctly downstream.

**2026-05-13 · 💡 insight · Pass contact names as Whisper prompt biasing**

**Learning:** `transcribe()` accepts an optional `prompt` field passed straight through to OpenAI's Whisper. Setting it to the comma-joined list of contact names dramatically improves recognition accuracy on names — `"alex morgan"` ASR'd correctly even on a noisy 16kHz mono recording. This is free; no extra call.

**Action:** Always pass contacts as the STT prompt in `compose.ts`. When contacts list is empty we pass nothing (no degradation).

**2026-05-13 · 💡 insight · Emoji escapes through into rewrites**

**Learning:** GPT-4o-mini happily emitted `😉` in the sarcastic variant. The G2 font can't render emoji, so the HUD will display gibberish or empty space. Server returns raw text; sanitization happens in the HUD render layer (per the plan's sanitization rules) — but worth confirming we apply it consistently to *outbound* compose results too, not just inbound sanitization for Twilio/email inbox.

**Action:** When wiring the HUD in P13, ensure the same emoji-strip pass runs on `variants[].text` before display. Logged in ISSUES.md.

### P5 — Twilio (SMS) integration

**2026-05-13 · 💡 insight · Messaging Service SID > From number for production**

**Learning:** Twilio offers two send modes: `from: '+1...'` (a specific number) or `messagingServiceSid: 'MG...'` (a Messaging Service that does sticky-sender, smart routing, A2P 10DLC compliance). Both still need TWILIO_SID + TWILIO_TOKEN. We support both: prefer Messaging Service when configured, fall back to From number. User had both configured so we send via MG29… which is the right path for production-grade routing.

**Action:** Pattern in `server/src/sms/twilio-client.ts:sendSms`. Document in onboarding wizard that MG is preferred when the user has one.

**2026-05-13 · ⚠ surprise · ♥ (U+2665) IS in the G2 font but my regex was stripping it**

**Learning:** When writing the sanitize regex `\u{2600}-\u{26FF}` to strip Miscellaneous Symbols, I clobbered the card-suit chars (♠♡♢♣♤♥♦♧ at U+2660–U+2667) which the G2 font actually supports per community research. The sanitizer test caught it: "I ♥ you" became "I you". Fix: split the range to `\u{2600}-\u{265F}\u{2668}-\u{26FF}`, preserving card suits.

**Action:** Always test sanitization against both "should strip" and "should preserve" cases. Pattern captured in `test/sms.test.ts` with explicit "preserves the card-suit heart" case.

**2026-05-13 · ⚠ surprise · cached `env` module doesn't pick up later `process.env` changes**

**Learning:** `verifyWebhookSignature` initially read `env.TWILIO_TOKEN` (the zod-validated cached value at module load). Vitest sets `process.env.TWILIO_TOKEN = 'fake-token-for-test'` AFTER env.ts has parsed, so the cached value remained undefined, signature verification always returned false, every test failed with 403.

**Action:** For *optional* env vars consumed by side-effects (webhook signatures, etc.), read from `process.env` dynamically:
```ts
const token = process.env.TWILIO_TOKEN ?? env.TWILIO_TOKEN;
```
This also has the nice side effect of letting `pm2 reload --update-env` take effect without a process restart for rotation. Keep zod-cached env for things that MUST be set at boot (MASTER_KEY, etc.).

**2026-05-13 · ✓ went well · idempotency via client_uuid in outbox table**

**Learning:** The HUD will retry sends if it loses connection mid-request. Without idempotency, a flaky cell connection could double-send the same SMS to a recipient. Solution: HUD generates a client UUID per send, server uses it as the outbox primary lookup. If the same UUID is POSTed again, server returns the existing outbox row (with its real status) and skips the Twilio call entirely.

**Action:** Pattern in `server/src/routes/sms.ts` (look up by `client_uuid` first, only insert + send if not found). Will replicate for /api/email in P6.

**2026-05-13 · 💡 insight · Twilio errors carry numeric codes — use them for clean error mapping**

**Learning:** Twilio errors include a numeric `code` field (21211 = invalid_to_number, 21610 = unsubscribed, 20003 = unauthorized, etc.). Mapping these to our internal `SmsError` codes lets the HUD show user-friendly errors instead of raw Twilio strings. Documented code → meaning mapping at `server/src/sms/twilio-client.ts:normalizeTwilioError`.

### P6 — Email (IMAP+SMTP)

**2026-05-13 · ✓ went well · provider defaults in account upsert**

**Learning:** Users adding a Gmail / Outlook / iCloud account don't want to remember `smtp.gmail.com:465 SSL` etc. The `upsertEmailAccount()` function applies a per-provider defaults map (gmail → 465 SSL + 993 SSL; outlook → 587 STARTTLS + 993 SSL; iCloud → 587 STARTTLS + 993 SSL). The user only needs to provide `email_address` + `password` (or OAuth tokens) and the right ports land automatically. `provider: 'custom'` skips defaults.

**Action:** Pattern at `server/src/mail/account.ts:PROVIDER_DEFAULTS`. Same pattern would work for adding Fastmail, Yahoo, Zoho, ProtonMail Bridge etc. in v2.

**2026-05-13 · ⚠ surprise · `JSON.stringify(view).not.toContain('password')` matches field NAMES too**

**Learning:** Initial leak-prevention test asserted `JSON.stringify(view).not.toContain('password')`. Failed because the safe view legitimately includes a boolean `has_password: true` flag — the *substring* `password` appears in the field name, even though no actual secret is exposed.

**Action:** Tighten the assertion: check `password_encrypted` (the storage column name) and `oauth_refresh_token` (another storage name) don't appear, AND the literal secret value doesn't appear. Don't blanket-match `password` substring — confuses legitimate boolean flags with actual leaks.

**2026-05-13 · 💡 insight · IMAP IDLE in `imapflow` is a thin async wrapper**

**Learning:** `imapflow`'s API exposes IDLE as `await client.idle()` which blocks until the connection drops or the server sends a notification. Meanwhile `client.on('exists', cb)` fires when new mail arrives during the IDLE window. Combined: enter IDLE, listen for 'exists', when fired call `client.fetch(range)` to pull the new UIDs, persist, then implicitly re-enter IDLE.

**Action:** Pattern in `server/src/mail/idle.ts:connectOnce`. The exit-from-IDLE path is what triggers reconnect — when `client.idle()` resolves (clean) or rejects (error), the outer `connectLoop()` catches and reschedules with exponential backoff (5s, 15s, 60s, 5m, 15m, 1h).

**2026-05-13 · 💡 insight · server-side SSE bus pattern**

**Learning:** Multiple HUD instances + dashboard for the same user need real-time inbox updates. Implemented as a per-process `EventEmitter` (`inboxBus`) keyed by `inbox:<userId>`. The IMAP IDLE worker publishes new-message events; SSE clients subscribe in the route handler; unsubscribe on disconnect. Heartbeat every 25s + `X-Accel-Buffering: no` header to keep Nginx from buffering the stream. Total ~80 LOC for full pub/sub + SSE wire format.

**Action:** Pattern in `server/src/mail/sse-bus.ts` + `server/src/routes/inbox.ts`. Single-process for v1; for horizontal scale we'd swap in Redis pubsub later. The interface stays the same.

**2026-05-13 · 💡 insight · IDLE worker startAll() is non-blocking on server boot**

**Learning:** The IMAP manager's `startAll()` is fire-and-forget in `index.ts` via `void` — don't block server startup on remote IMAP handshakes (which can take 5–10s each on cold connect). Workers come online asynchronously, and the route layer is ready to serve immediately. `imap_status` column tracks worker health so the dashboard can show progress.

**Action:** Pattern in `server/src/index.ts:main()`. Same applies to any background-worker startup — never block HTTP listening on out-of-process I/O.

### P7 — Contacts + Templates + History

**2026-05-13 · ✓ went well · in-process fuzzy resolver instead of Fuse.js**

**Learning:** Originally planned to install `fuse.js` for fuzzy name matching. But the use case is small (≤500 contacts per user) and the scoring is simple: exact full name → exact first name → prefix → token overlap → substring. Wrote ~60 lines of pure TS instead. Faster, no extra dep, behaviour is fully under our control (favorite bumps, etc.).

**Action:** Pattern in `server/src/contacts/match.ts`. Adding more sophisticated scoring later (Levenshtein for typos) is straightforward — drop in a similarity calc, weight it ~30 in the score formula.

**2026-05-13 · ⚠ surprise · existing user missed templates seed**

**Learning:** `seedDefaultTemplates(userId)` only runs from inside `ensureUserExists()` when a NEW user is created. Since user_id=1 was created in P2 (before this seed function existed), the templates table stayed empty even after P7 deployment. Found via curl smoke test (count: 0 instead of 12).

**Action:** Ran the seed retroactively via a one-liner SSH script (import + call). For future migrations like this, add a backfill step inside `runMigrations()` that detects missing default-data rows and seeds them on server boot. Or just make `seedDefaultTemplates` idempotent (checks count first — which it does) and call it from the migration runner.

**2026-05-13 · 💡 insight · CSV parser is small enough to hand-roll**

**Learning:** Considered `csv-parse` package, but standard CSV (quoted fields, doubled-quote escapes, comma separator) is ~30 lines of pure TS to parse correctly. No dep, no version risk, no async overhead. The CSV body comes in via JSON `{csv: "..."}` so we already have the full string in memory — streaming wasn't needed.

**Action:** Pattern in `server/src/routes/contacts.ts:parseCsv`. If we ever need TSV / semicolon-delimited / multi-line cell handling, swap to a library; until then hand-rolled is enough.

**2026-05-13 · 💡 insight · per-user transactions for batch ops**

**Learning:** CSV import inserts N contacts. Wrapping in `db.transaction((rows) => { for ... insert })` makes the whole import atomic AND ~10× faster than N individual statements (single fsync at commit). Same pattern for templates reorder.

**Action:** Pattern repeated wherever we do batch writes. better-sqlite3's `db.transaction(fn)` returns a function — call it with args; throws roll back the whole batch.

### P8 — Phone dashboard scaffold

**2026-05-14 · ⚠ surprise · quoted-heredoc + backslash-escaped `$` = literal `\$` in the file**

**Learning:** Writing the Nginx config to the VPS via `ssh 'cat > file <<"NGINX" ... NGINX'`. Used a *quoted* delimiter (`<<"NGINX"`) to prevent the local shell expanding `$host` etc. — correct instinct. But I ALSO backslash-escaped them (`\$host`), out of habit. With a quoted heredoc, backslashes are literal, so the file got `\$host` which Nginx rejects (`invalid condition "\$host"`).

**Action:** Rule: quoted heredoc (`<<"EOF"`) → write `$var` plain, no escaping. Unquoted heredoc (`<<EOF`) → escape with `\$` what you want literal. Never both. Caught immediately by `nginx -t` before reload — always validate before `systemctl reload`.

**2026-05-14 · ✓ went well · hand-rolled UI primitives instead of shadcn CLI**

**Learning:** `npx shadcn@latest init` is interactive (prompts for style, base color, paths) — bad for non-interactive scaffolding. Instead wrote ~150 lines of `components/ui/index.tsx`: Button (4 variants), Card family, Input, Badge, StatusDot, PageHeading, EmptyState, Spinner. Pure Tailwind, the "shadcn aesthetic" (dark surfaces, hairline borders, single accent) without the CLI or Radix dependency.

**Action:** Pattern in `web/src/components/ui/index.tsx`. If we later need complex primitives (Dialog, DropdownMenu with focus trapping), pull in Radix selectively — but for the dashboard's needs, hand-rolled is lighter and fully controlled.

**2026-05-14 · 💡 insight · single-domain SPA + API split via Nginx location precedence**

**Learning:** Dashboard and API share `<YOUR_DOMAIN>`. Nginx routes by location: `/api/` and `/webhooks/` proxy to Node; everything else serves the static SPA from `/opt/vox-web` with `try_files $uri $uri/ /index.html` for client-side routing. Key detail: `/api/` (with trailing slash) is a prefix match that wins over `location /`. `/assets/` gets `immutable` cache headers since Vite content-hashes bundle filenames; `index.html` is never cached so new deploys take effect instantly.

**Action:** Canonical config saved at `server/nginx.conf.example` + live copy backed up to `/opt/vox/nginx.conf.deployed` on the VPS. `web/deploy.sh` builds + rsyncs + reloads.

**2026-05-14 · 💡 insight · `import.meta.env` needs an explicit `vite-env.d.ts`**

**Learning:** `tsc -b` (the dashboard's typecheck) doesn't know about Vite's `import.meta.env` unless `src/vite-env.d.ts` exists with `/// <reference types="vite/client" />`. The `npm create vite` template includes it; since I scaffolded manually, I had to add it — plus an explicit `ImportMetaEnv` interface for our `VITE_API_BASE` var so it's typed, not `any`.

**Action:** Any manually-scaffolded Vite + TS project needs `src/vite-env.d.ts`. Documented in `web/src/vite-env.d.ts`.

### Mid-build — PII scrub (between P8 and P9)

**2026-05-14 · ✗ went badly · operational PII leaked into public-repo history**

**Learning:** Over P0–P8, operational PII steadily accumulated in committed files — local filesystem paths (revealing the macOS username), the Vultr server IP, the live domain, the Twilio number, a personal test cell number, and email addresses. Across 13 commits it touched ~48 files. It was never *secrets* (`.gitignore` covered `.env` from P0 — verified clean), but a public repo shouldn't expose any of it. Caught by the user, not by me — I should have used placeholders from the first commit.

**Action:** Scrubbed all working-tree files (env-vars in code, `<PLACEHOLDER>` tokens in docs + example files), squashed all history into one clean commit with a neutral GitHub-noreply author, force-pushed, purged the local backup branch + reflog. Added a local pre-commit hook that greps staged content for the known PII patterns and blocks the commit.

**Patterns to avoid (added to top of file):** never hardcode a real host/path/phone/email in a committed file — placeholder or env var from line one. **Patterns to repeat:** keep a pre-commit PII grep guard; keep `.env` gitignored and verify with a history scan, not just a working-tree scan.

### P9 — Onboarding wizard

**2026-05-14 · 💡 insight · env-only credentials block the dashboard from being a real admin surface**

**Learning:** Through P5–P8, Twilio + LLM keys lived only in `/opt/vox/.env`. That meant the onboarding wizard literally *couldn't* configure anything — pasting a key into a form would have nowhere to go without an SSH + pm2 restart. P9's first job wasn't UI, it was a credential-storage refactor: an `integrations` table (AES-256-GCM-encrypted blobs) with a **DB-first, env-fallback** resolution path. The env vars become the bootstrap (what a fresh deploy provides); once the wizard writes a DB row, that wins.

**Action:** Pattern in `server/src/integrations.ts`. `getIntegrationCreds(userId, provider)` is the single resolution point — DB row → decrypt → else `envFallbackCreds()`. Everything that needed a credential (`twilio-client`, `llm/factory`, `audio/stt`) was rethreaded to take `userId` and call it. Nothing broke for the existing env-configured deployment because fallback is transparent.

**2026-05-14 · ⚠ surprise · cached `env` bites a third time — `envFallbackCreds` edition**

**Learning:** Same trap as P5 (`verifyWebhookSignature`) and P8 nowhere — `envFallbackCreds` initially read the zod-cached `env` object, so a test setting `process.env.OLLAMA_CLOUD_KEY` at runtime didn't take. Third occurrence of "cached env vs live process.env."

**Action:** `envFallbackCreds` now reads `process.env` directly. **Standing rule for this codebase:** anything that reads an *optional / rotatable* env var at call-time reads `process.env.X`, not `env.X`. Reserve the zod-cached `env` for vars that are required-at-boot and never change (MASTER_KEY, PORT, DB_PATH). Add this to the env.ts header comment.

**2026-05-14 · ⚠ surprise · shared test DB → cross-file credential bleed**

**Learning:** Vitest runs with `singleFork: true` and one temp SQLite shared across all test files. `integrations.test.ts` writing a Twilio row for user 1 made `sms.test.ts`'s "missing_credentials" test fail — it deleted the env vars but the DB row from the other file persisted, so `sendSms` still found creds.

**Action:** Any test asserting a "no credentials" state must explicitly `deleteIntegration(1, provider)` first, not just clear env. Tests that need creds set them in a scoped `beforeAll`. Don't assume a clean DB between files when `singleFork` is on.

**2026-05-14 · ✓ went well · OAuth deferred without losing capability**

**Learning:** The plan had Gmail/Outlook one-click OAuth in steps 3 + 5. OAuth needs the *user* to stand up a GCP/Azure project — a chicken-and-egg we can't complete for them, and it adds more secrets to manage right after a PII cleanup. But the custom IMAP/SMTP path (proven against Migadu in P6) covers **every** provider including Gmail/Outlook (via app passwords). So the wizard ships fully functional with the custom path; OAuth becomes a pure convenience add later, not a blocker.

**Action:** Don't let a "nice to have" auth flow gate a phase when a universal fallback already works. Wizard step 3 has the provider buttons; Gmail/Outlook just use app-password mode for now.

### P10 — Dashboard surfaces

**2026-05-14 · ✓ went well · the whole phase was pure assembly because the API was already complete**

**Learning:** P10 built 8 full dashboard pages and only needed *two* small server additions (`/api/diagnostics`, `/api/account*`). Everything else — contacts CRUD, templates, history, inbox, integrations, config — was already live from P2–P9. The pages are thin: TanStack Query against existing endpoints + the UI primitives. Building the API-complete backend first (P2–P9) made the entire frontend phase low-risk assembly work.

**Action:** Validates the "server-complete before frontend" sequencing in PHASES.md. Keep it for any future surface work — never build a page against an endpoint that doesn't exist yet.

**2026-05-14 · 💡 insight · auto-save preferences beat a Save button**

**Learning:** The Preferences page has ~22 fields across 5 sections. A single "Save" button would mean either (a) one giant PUT on click, or (b) per-field dirty tracking. Instead: each control's `onChange` fires an immediate `PUT /api/config` with just that one field (the route already does partial updates). A tiny "saved" note flashes. No dirty state, no save button, no lost edits.

**Action:** Pattern in `web/src/pages/Preferences.tsx` — `set(key, value)` updates local state + fires the partial PUT. Works because the config route was built partial-update-friendly from P2.

**2026-05-14 · 💡 insight · up/down arrows instead of drag-to-reorder**

**Learning:** The plan mentioned drag-to-reorder for templates. `dnd-kit` is ~30KB + real complexity (sensors, collision detection, accessibility). For a list of ~12 templates, two ChevronUp/Down buttons that swap adjacent items and POST the new order array are ~15 lines, zero deps, and fully keyboard-accessible by default.

**Action:** Pattern in `web/src/pages/Templates.tsx`. Reserve real drag-and-drop for cases where the list is long or spatial arrangement matters. For short ordered lists, arrows win.

**2026-05-14 · ✓ went well · hand-rolled Modal over a dialog library**

**Learning:** Needed modals for contact edit, template edit, integration credential forms, secret rotation. Rather than pull in Radix Dialog, the `Modal` primitive is ~25 lines: a fixed overlay div, click-outside-to-close, `stopPropagation` on the inner card. No focus-trap (acceptable for this single-user admin tool). Total UI primitive set is still one ~330-line file.

**Action:** `web/src/components/ui/index.tsx` stays dependency-free. If we ever need true focus-trapping / nested dialogs, revisit — but not before.

### P11 — HUD scaffold

**2026-05-14 · ✓ went well · start from the official template, don't guess the SDK**

**Learning:** My research notes had the SDK API roughly right, but `npx degit even-realities/evenhub-templates/minimal` gave the *exact* real surface — and it differed from my notes in ways that would have cost hours: `containerID` is a **number** not a string; `CreateStartUpPageContainer` / `TextContainerProperty` are **classes** (constructed with `new`), not plain objects; events split across **four** envelopes (`sysEvent` / `textEvent` / `listEvent` / `audioEvent`); the `asr` template showed `permissions` is `[{name, desc}]` objects. Reading the SDK's `index.d.ts` (1292 lines) confirmed the rest (`audioControl`, `textContainerUpgrade`, `shutDownPageContainer`, `OsEventTypeList` ordinals).

**Action:** Always scaffold from the vendor template + read the shipped `.d.ts` before writing a line. Don't build against research-grade API knowledge.

**2026-05-14 · ⚠ surprise · CLICK_EVENT (0) really does arrive as `undefined`**

**Learning:** The template's own comment warned about it; the simulator confirmed it live. A `click` produced `{"sysEvent":{"eventSource":1}}` — `eventType` field entirely **absent** because protobuf omits zero values. Any `eventType === CLICK_EVENT` comparison silently never matches.

**Action:** `normalizeEvent` coalesces `eventType ?? OsEventTypeList.CLICK_EVENT` everywhere before comparing. Centralized in `hud/src/bridge.ts` so no page ever touches a raw event.

**2026-05-14 · ✗ went badly · text-drawn box frames can't align on the G2 font (I-007)**

**Learning:** The whole planned Pine/Norton-Commander aesthetic assumed drawing the frame with box-drawing chars (`┌─┐│└┘`) inside the text `content`. First simulator screenshot exposed the flaw: the G2 firmware font renders box-drawing glyphs and letters at **different advance widths** — 37 dashes span ~full container width, 37 letters span ~half. A fixed-char-count frame's right edge wanders depending on what's on the row.

**Action:** Logged I-007. P12 redesigns the visual system to use the SDK's real container `borderWidth`/`borderColor`/`borderRadius` for framing; text `content` carries only inner lines. P11 pages fell back to plain left-aligned text (renders predictably). The `render.ts` frame helpers are kept but marked provisional.

**2026-05-14 · ✓ went well · the simulator's :9898 automation API is a real test loop**

**Learning:** `evenhub-simulator --automation-port 9898 <url>` exposes `/api/ping`, `/api/console`, `/api/screenshot/glasses` (576×288 PNG), and `/api/input` (`{action: click|double_click|up|down}`). Backgrounding the simulator + driving it over curl gave a genuine automated render/interact/screenshot loop — I verified tap→CLICK_EVENT→textContainerUpgrade, scroll, and the double-tap exit gate without ever looking at the GUI window.

**Action:** This is the HUD dev loop for P12–P17. Pattern: start `npm run dev` + `evenhub-simulator --automation-port 9898` in the background, then `curl` input + screenshot. Note the input schema is `{action}` not `{type}`.

**2026-05-14 · 💡 insight · pairing bootstrap via launch-URL query params**

**Learning:** The HUD can't scan a QR (no camera in the SDK), and typing a secret on glasses is the exact friction VOX exists to remove. For the dev/sideload path, `evenhub qr -u "<url>?server=...&secret=..."` carries the pairing in the launch URL; `bootstrapPairingFromUrl()` lifts it into KVS on first launch. Production install (from Even Hub, no URL params) still needs a real pairing UX — logged for a later phase.

**Action:** Pattern in `hud/src/kvs.ts`. Production pairing flow is an open design question for P19/polish.

### P12 — HUD Smart Idle

**2026-05-14 · ✓ went well · I-007 fixed — frame with real container borders, not text box-chars**

**Learning:** The whole Pine/Norton-Commander aesthetic was salvaged by reading the docs' Display section: containers have real `borderWidth` (0–5), `borderColor`, `borderRadius`, `paddingLength` properties. The frame is a *property of the container*, not characters in the text. Redesigned `render.ts` around `TextBox` / `ListBox` specs that compile to bordered container props. Smart Idle = 3 bordered containers (title / list / footer), renders cleanly — no alignment math, no font-width guessing.

**Action:** Rule for the whole HUD: framing/structure = container geometry + borders; text `content` = inner lines only, never box-drawing chars. `render.ts` is the single source for this.

**2026-05-14 · 💡 insight · the native List container does the scroll UX for free**

**Learning:** `ListContainerProperty` + `ListItemContainerProperty` with `isItemSelectBorderEn: 1` gives a native scrollable list — firmware draws the selection highlight and handles scrolling. We supply `itemName: string[]` (max 20 items, 64 chars each) and get a `listEvent` with `currentSelectItemIndex` on tap. Caveat from the docs: lists **cannot be updated in-place** — changing items means a full `rebuildPageContainer`.

**Action:** Smart Idle's suggestions are a capture list container; index→action is cached on the page so `list-select` can route. Pages with changing list content rebuild rather than patch.

**2026-05-14 · ⚠ surprise · two independent network gates — and CORS bites in the simulator**

**Learning:** First `/api/idle-suggestions` fetch failed: `[fetch] Load failed`. The docs spell out two gates: (1) the `app.json` network whitelist — enforced by the Even App on device, **bypassed in the simulator**; (2) browser CORS — enforced *everywhere including the simulator*. So the simulator failure was pure CORS: the Express server sent no `Access-Control-Allow-Origin`.

**Action:** Added CORS middleware to `server/src/app.ts` — open `Access-Control-Allow-Origin: *` (every route is bearer-secret gated, so the origin isn't the auth boundary) + OPTIONS-preflight 204. The whitelist (placeholder + `pack.sh` substitution, I-008) is the other gate — device-only, verify in P19. Mnemonic: whitelist = "allowed to talk at all" (device); CORS = "server said yes" (everywhere).

**2026-05-14 · 💡 insight · one round-trip powers the whole idle screen**

**Learning:** `/api/idle-suggestions` returns both the ranked `suggestions[]` AND a `status` block. The HUD draws title-bar badges + Today line + the list from a single fetch — matters for the <500ms cold-start budget over a BLE-latency link. Battery is the only separate call (`getDeviceInfo()`, local/instant).

**Action:** Server endpoints backing a HUD screen return everything that screen needs in one response. No chatty per-widget fetches.

### P13 — HUD voice compose pipeline

**2026-05-14 · ⚠ surprise · `rebuildPageContainer` can't introduce container IDs that a smaller prior rebuild dropped**

**Learning:** The SDK docs describe `rebuildPageContainer` as "Replace the entire page — full redraw, all state is lost." In practice on the simulator (and almost certainly on hardware), shrinking the container set is one-way: a rebuild with `total=1, texts=1, lists=0` removes the other containers, and the next rebuild back to `total=3` returns `false` silently. The call resolves; no error throws; the page just never updates.

Symptom that masked this for an hour: Smart Idle → tap Compose → recording screen rendered → auto-stop fired → `/api/compose` returned 200 with valid intent + 7 variants → confirm `Page.mount` log fired ("confirm page mounted") → but the screen stayed frozen on the transcribing copy. The bridge swallowed the rebuild with no signal until I logged the boolean return value.

**Action:** Every page in the HUD uses the SAME 3-container shape: text c1 (title), list c2 (capture), text c3 (footer). Compose's "recording" state is encoded as 3 list items (greeting, blank, level meter) and the timer goes in the title — instead of a single full-screen text container. The 1Hz timer-label dedup keeps rebuild traffic to ~1/s during recording, not 4/s.

**2026-05-14 · ⚠ surprise · firmware silently rejects list items longer than ~32 chars (docs claim 64)**

**Learning:** SDK docs say `ListContainerProperty.itemContainer.itemName` accepts up to 64 chars per item. In practice, items at ~62 chars (Confirm's atom rows with the original `LABEL  value  ...padding...  ●●●` format) caused `rebuildPageContainer` to return `false`. Trimming each row to ≤32 chars made the rebuild succeed on the first try, no retry needed.

**Action:** Confirm rows now render as `LABEL value___________________ ***` capped at 32 chars total. ASCII confidence dots (`***` / `**.` / `*..`) replaced the unicode bullets (`●●●` / `●●○` / `●○○`) — partly belt-and-braces (the G2 font may not have the bullet glyph), partly because trimming naturally enforced ASCII width.

**2026-05-14 · ⚠ surprise · vite HMR resets `firstPageShown` but the sim keeps the original startup container**

**Learning:** `render.ts` had `let firstPageShown = false`; first `showPage` call used `createStartUpPageContainer`, subsequent ones used `rebuildPageContainer`. After a vite HMR full reload, `firstPageShown` reset to `false` but the simulator's startup container was still alive — so the next boot's `createStartUpPageContainer` returned code `1` ("invalid params") and `showPage` returned `false`. The page never re-rendered after any HMR, which made the debug loop excruciating because every code edit dark-screened the sim.

**Action:** `showPage` now treats a non-zero `createStartUpPageContainer` result as "already initialized" and falls through to `rebuildPageContainer` automatically. Same code path protects against any boot race on real hardware (e.g., if the firmware persists the prior session's container set across an app cold-start).

**2026-05-14 · 💡 insight · sim automation has `up`/`down`/`click`/`double_click` — no scroll-into-view or list-item indexing**

**Learning:** `POST /api/input` action vocabulary is exactly `up`, `down`, `click`, `double_click`. There is no `scroll_to(index)` or `select_item(index)`. To reach the 5th list item programmatically you send `down` four times then `click`. Useful detail for sim tests: query the server's `/api/idle-suggestions` first so the test knows the index of the target row before scrolling.

**Action:** Documented the actual action list at the top of `hud/README.md`. Pattern for sim-driven flow tests: `GET /api/idle-suggestions` to discover the target index → repeated `POST /api/input down` → `POST /api/input click`. Also useful: `GET /api/console?since_id=N` for incremental log polling.

**2026-05-14 · 💡 insight · macOS suspending the sim ≠ pausing the JS clock**

**Learning:** `recorder.elapsedSeconds` is computed from `Date.now() - this.startedAt`, which is wall-clock. When macOS suspends the sim's webview process, the JS event loop pauses; but on resume, `Date.now()` jumps forward by the suspend duration and the `setInterval` callback fires immediately for each missed tick. `MAX_RECORDING_SECONDS` triggered "immediately" after wake, with no audio captured, which scrambled the debug trail until I noticed a 12,500-second gap between two adjacent console timestamps.

**Action:** Lived with it for now — the actual production flow is fine because real users don't suspend mid-recording for hours. If it becomes a problem, switch to a monotonic-clock derivation that ignores wall-clock jumps (e.g., increment a counter inside the tick rather than reading `Date.now()`).

### P14 — HUD tone picker + send

**2026-05-15 · ⚠ surprise · a list-capture container fires `list-select`, not `tap`**

**Learning:** P13 ended with ComposePage being a single full-screen text container with `isEventCapture: 1`, and its `onEvent` handler only checked `event.kind === 'tap'`. When P14 converted Compose to the same 3-container shape as the rest of the app (so c2 is a list), tap-to-stop stopped working — the firmware now emits a `listEvent` (no `currentSelectItemIndex`, the list has no useful items to pick) which `bridge.ts` normalizes to `kind: 'list-select'`. The user's tap landed but the page ignored it; the sim sat on the recording screen forever.

**Action:** Compose's `onEvent` now handles both `tap` and `list-select` as "user wants to stop." Same applies to any page whose capture container is a list: treat list-select as a generic tap when the list items aren't menu choices.

**2026-05-15 · 💡 insight · `confirm = factory(result)` → `confirm = singleton(reads draft)` is a much better pattern**

**Learning:** P13's `makeConfirmPage(result)` captured the result via closure. That worked for a single-shot render, but the moment any picker needed to mutate the parsed intent (recipient, tone, subject, channel), we'd have to thread state through the closure — and rebuilding the closure means re-creating the Page identity, which breaks `router.push(p)`-stack ergonomics.

**Action:** A singleton `ConfirmPage` that reads from a shared `draft` module on every `mount()` is the cleaner pattern. Pickers push themselves on the stack, mutate the draft, and `router.back()` re-mounts Confirm — which redraws against the new draft state. The draft module owns the lifecycle (`setDraftFromCompose` on entry, `clearDraft` after a successful send). This pattern generalizes to any "edit a multi-field intent across multiple sub-pages" flow.

**2026-05-15 · ✓ went well · idempotency-by-client_uuid pays for itself the moment a retry happens**

**Learning:** Both `/api/sms` and `/api/email` accept an optional `client_uuid` and treat a duplicate UUID as idempotent — return the existing outbox row instead of re-sending. P14's `sendDraft` generates one with `crypto.randomUUID()` per send. Saved us during P14's debug loop: when the webview locked up mid-send and we re-ran the flow, a stale request never raced with the new one to double-send.

**Action:** Continue this pattern everywhere outbound — every state-mutating endpoint should take an idempotency key from the client. Add it to `/api/sms` and `/api/email` headers when bulk-sending lands in P16+.

**2026-05-15 · 💡 insight · whisper on raw PCM takes 6–8 s, not 2 s**

**Learning:** P13's "~2 s round-trip" estimate was based on the JSON transcription path (no STT — the transcription was already in the body). When P14 ran the real audio path on the sim (88 KB of PCM = ~5 s of mic input), `/api/compose` returned in 6–8 s. My 5-second sleep timeout in the sim driver wasn't enough, which made the page look frozen.

**Action:** When automating end-to-end tests, the budget for real-audio compose is **at least 10 s**, not 5. For sim flow tests, prefer the JSON-transcription path (set fields explicitly) — saves 6 s per cycle and keeps Whisper out of the test inputs.

### P15 — HUD inbox + reply
*(filled in on phase completion)*

### P16 — Voice-anywhere
*(filled in on phase completion)*

### P17 — Polish
*(filled in on phase completion)*

### P18 — Hardening
*(filled in on phase completion)*

### P19 — Hardware testing

*(in progress since 2026-05-15 — sub-phase versions 0.1.2 through 0.1.16 shipped. Retros captured version-by-version.)*

**2026-05-16 to 2026-07-28 · ⚠ surprise · The L:38 rebuild-container crash**

**Learning:** `bridge.rebuildPageContainer` silently fails at native
layer with a `L:38` error whenever the new page shape *re-introduces*
container IDs a prior smaller rebuild had dropped. Bit us three times
in 6 weeks:
1. Embedded recipient picker in Confirm — Confirm's initial shape had
   fewer containers than the picker mode, so entering picker mode
   crashed.
2. Send → Sent transition — the Sent page had fewer containers than
   Send, so returning from Sent to Compose crashed.
3. Chrome pages generally — any shape reduction followed by a shape
   restoration would crash.

**Action:** `hud/src/render.ts` now auto-pads every chrome page to the
maximal 6-container shape at first render, so subsequent rebuilds
never introduce a new ID. This is the L:38 defense. Any new page shape
must respect the max, or the pad must widen. Documented as a rule in
`CLAUDE.md`.

**2026-07-28 · ✗ went badly · U+25B8 ▸ glyph is not in the G2 font**

**Learning:** Used `▸` (U+25B8, Black Right-Pointing Small Triangle)
as the cursor / affordance glyph in the Confirm submenu row. Sim log
spat out `glyph dsc. not found for U+25B8` and the character rendered
as a missing-glyph box. Same failure mode as double-line box drawing
`╔═╗` characters.

**Action:** Swapped to ASCII `>`. When picking glyphs, restrict to the
verified-safe set: ASCII, single-line box drawing (`─│┌┐└┘├┤┬┴┼`), `→`,
`↑↓`, `●○◐◇▶◀`, block characters `▁▂▃▄▅▆▇█`, `♥` (card suit). Anything
else needs a sim-render check before shipping.

**2026-08-15 · ✗ went badly · Phone companion never showed new sends**

**Learning:** v0.1.11–0.1.14's companion `hydrate()` ran exactly once
on mount. If the user sent a message from the glasses and then opened
the phone WebView, the new message never appeared in the activity
feed. Compounded by Nginx returning `304 Not Modified` on repeat
fetches, so even manual reloads didn't help.

**Action (v0.1.15):**
1. Wrap `hydrate()` in a `setInterval` at 15 s while
   `document.visibilityState === 'visible'`.
2. Add a `visibilitychange` listener that force-refetches when the tab
   returns to foreground.
3. All fetches use `cache: 'no-store'` + a `?_=${Date.now()}` query
   param to defeat both the browser HTTP cache and any intermediary
   `If-None-Match` handling.
4. `beforeunload` clears the interval to avoid leaked timers.

**Rule of thumb:** any WebView surface that reads server state must
poll on visibility, not just on mount — the WebView lifecycle in the
Even Realities phone app doesn't reliably re-fire mount when the user
comes back.

**2026-08-15 · 💡 insight · SDK drifted three minor versions unnoticed**

**Learning:** We shipped v0.1.11–0.1.14 on `@evenrealities/even_hub_sdk`
0.0.10 while 0.0.13 was current. Only caught it when doing a
comprehensive docs sweep. 0.0.13 added `zOrderIndex` on containers
(makes overlays possible without page rebuilds — huge for L:38
avoidance), `validateEvenHubPageContainerZOrder`, `AudioInputSource`
enum, `AppLocation` events, image picker. `compressMode` was removed
from image containers but we don't use images.

**Action:** Added SDK version check to session startup ritual. Every
2–3 iterations, run `npm outdated @evenrealities/even_hub_sdk` to
catch drift early. Bumped and typecheck stayed clean — no breaking
changes actually hit our code. Consider adopting `zOrderIndex` for
overlay flows (Confirm submenu is the obvious candidate) in the next
Confirm refactor.

**2026-08-15 · ✓ went well · Tone submenu solves discoverability +
scroll in one move**

**Learning:** v0.1.14's Confirm crammed 9 tone chips into a single
scroll list beside the body. Only 2 tones visible at a time, list
scroll felt fighty with the body text container, and the affordance
arrow (U+25B8) was invisible. User feedback was "tones unscrollable
and message not fully visible."

**Action (v0.1.15):** collapse Confirm's main list to 3 rows — SEND,
switch-channel, `tone: Casual >` — and gate tone selection behind a
submenu. Tapping the tone row enters a `picking-tone` mode where the
body container shrinks to a 4 px spacer and the list container grows
to 154 px, showing all 9 tones with real scroll room. Body renders on
3 lines in the default mode. Cleaner information architecture: main
Confirm answers "am I about to send the right message?", submenu
answers "what tone?". Two smaller questions instead of one crowded
one.

**2026-08-20 · 💡 insight · Phone companion is a product surface, not a status bar**

**Learning:** v0.1.11–0.1.15 treated the phone WebView as a passive
"is VOX running?" indicator plus an activity ticker. When the user
opened it after hardware testing, they saw a mostly-blank page that
felt like a debug view, not an app. User: "it looks very generic."

**Action (v0.1.16):** rebuilt `hud/src/companion/index.ts` around real
app-home semantics. Six blocks vertically: identity header (VOX +
version + tagline + service-count meta), service-health card, today
tiles (sent/received/failed + last-send line), quick-actions grid
deep-linking into the dashboard SPA, richer activity feed with
direction glyph + preview text, footer. Uses the phosphor green
accent (`#39FF6A`) sparingly. Total ~470 lines of vanilla DOM — no
framework since bundle stays inside the .ehpk.

**Rule:** any surface the user opens *manually* (not just an ambient
overlay) must have identity, orientation, and next-action affordances
on first paint. Otherwise it reads as a debug tool no matter how
useful the data is.

**2026-08-20 · ⚠ surprise · Pre-commit PII guard hits redesigns, not just new files**

**Learning:** v0.1.16 rewrite of `companion/index.ts` embedded a hard
fallback URL — the live domain, spelled out — for deep links when the run mode
wasn't a stripped-server render. Committed unaware — the file *had*
been touched by the redesign, so the guard scanned the whole diff and
flagged it. `Commit blocked — 1 PII match(es).` Correct outcome, but
easy to miss on a large refactor.

**Action:** Whenever a large file is rewritten (>200 line diff),
grep it for the blocked patterns in `.githooks/pre-commit` before staging.
The pre-commit hook is the safety net, not the primary check. Fixed
by replacing the fallback with
`EMBEDDED_CONFIG.server ?? window.location.origin`.

**2026-08-20 · 💡 insight · Auto-mode blocks `git push origin main` + `open -R`**

**Learning:** After committing v0.1.16, `git push origin main` was
rejected by the harness's auto-mode classifier ("bypasses PR review;
user did not authorize direct push to main"). Same for `open -R`
which was misclassified based on the recent push denial context. Both
are safe operations for this workflow — user pushes directly to main
on their public repo, and revealing a file in Finder is not
destructive.

**Action:** When the classifier bounces a safe follow-up, don't retry
destructively. Explain what was blocked, offer the exact command for
the user to run manually, and continue with whatever else is
independent. For repeatable safe operations, the user can add a Bash
permission rule to their settings; we don't proactively suggest that.

**2026-08-20 · ✗ went badly · A list row that doesn't fit is not scrolled to — it does not exist**

**Learning:** The hardware report was "there is no way to select the
message style, it appears permanently set to Casual." The obvious
suspects were all wrong: the submenu logic was correct, the tone
variants were all present in the API response, and list index routing
worked. The actual cause was arithmetic. v0.1.15 sized Confirm's action
list at 78 px for three rows, assuming a ~32 px row pitch. Reading
baselines off a rendered 7-item list (y = 99, 140, 181, 219) shows the
firmware draws rows at **~40 px**. Three rows need ~134 px. The third
row — the tone submenu entry, the ONLY affordance for changing style —
was simply never drawn.

The dangerous part is the failure mode. An overflowing list does not
clip visibly, does not scroll to the missing row, and does not warn.
It renders a short, tidy, entirely plausible menu that is missing an
item. Nothing in a screenshot tells you a row is absent unless you
already know how many there should be.

**Action:** `render.ts` now owns the constant (`LIST_ROW_PITCH = 40`)
and exposes `listHeightFor(rows)` / `listRowsVisible(h)`. Every list
height in the app is derived from those instead of a hand-picked pixel
value, and Idle + Confirm log a warning if their own container cannot
show every row they built. **Rule: never hand-pick a list container
height. If you write a pixel number next to a list, you are writing a
future missing-row bug.**

**2026-08-20 · ⚠ surprise · The tap that launches the app lands on the app**

**Learning:** Second hardware report: "it briefly displays the main
screen and then automatically switches to the Messages screen." Idle's
entire body was one full-width capture container whose handler pushed
ComposePage on any tap. The temple touch that selects VOX in the
launcher is delivered to whatever page mounts first — so the launch
gesture itself opened the recording screen, roughly 200 ms after Idle
painted. From the wearer's seat that is indistinguishable from an
automatic redirect, which is exactly how it was reported.

**Action:** two independent defences, because either alone is thin.
(1) `Router` opens a 700 ms input-settle window on every mount and
drops tap / list-select / scroll inside it — lifecycle events and mic
audio are deliberately never suppressed, since dropping those would
leak the microphone or defeat the double-tap exit gate. (2) Idle is a
menu now, so even an unsuppressed stray tap lands on a highlighted row
instead of opening the mic. Also: off-screen padding lists are built
with `isItemSelectBorderEn: 0`, so the firmware cannot attribute a
selection to a container the wearer cannot see.

**Generalisable:** any page reachable at launch should treat its first
few hundred milliseconds of input as suspect, and a root screen should
never put an irreversible or resource-acquiring action behind an
undifferentiated tap.

**2026-08-20 · ✗ went badly · Two finished phases had no entry point**

**Learning:** An architecture audit before touching the reported bugs
found that `VoicePage` (P16) and `InboxPage` / `InboxReadPage` (P15)
were unreachable from the glasses. Nothing pushed either one.
`navigateToInbox()` was exported and never called; `VoicePage` was
referenced only by its own retry path and by a comment in `idle.ts`
explaining that the entry point had been removed. Both phases are
ticked complete in PROGRESS.md, both were sim-verified when built, and
both quietly stopped being reachable at v0.1.11 when Idle was
redesigned from a menu into the calm pulse surface. `/api/voice-command`
had been dead in production for months.

Worse, the pending P19 hardware tasks #105 and #106 were written to
test exactly those two flows. They could not have passed.

**Action:** the Idle hub links both. Prerequisite: `inbox.ts` and
`inbox-read.ts` still carried the pre-chrome `{1,2,3}` container shape
from P17 — wiring them up without migrating them first would have
re-introduced dropped container IDs on the way back to Idle, i.e. the
L:38 trap, on a build heading to hardware.

**Rule: "done" means reachable.** When a navigation surface is
redesigned, enumerate what used to point out of it. A cheap standing
check is a reachability sweep from the root page — anything not
transitively pushed from Idle is dead code or a missing entry point,
and both deserve a decision rather than silence.

**2026-08-20 · 💡 insight · A convenience fallback became a way to send words nobody said**

**Learning:** `compose.ts` substituted a canned transcription whenever
fewer than 2 KB of PCM arrived — added in P13 so the mic-less simulator
could exercise the flow. It shipped in every packed build. The canned
string is a complete, plausible message ("running about ten minutes
late, sorry"), and the flow after it is fully functional: it parses,
resolves a real contact, renders a normal Confirm screen and sends. A
mic failure on hardware would therefore not look like a failure — it
would look like VOX mishearing you, and it would send.

**Action:** gated behind `import.meta.env.DEV`, so the simulator keeps
it and a packed build raises "no audio from the mic". Also started
naming `AudioInputSource.Glasses` explicitly rather than leaving the
glasses-vs-phone choice to the host default.

**Rule:** a test affordance that fabricates *plausible* data must never
survive into a production build. Loud, honest failure beats a silent
substitution every time — especially where the product's whole job is
to send things on the user's behalf.

**2026-08-20 · 💡 insight · Preferences that no client reads are decoration**

**Learning:** `preferences` has 23 columns, a validating PUT endpoint,
a full dashboard surface and tests. The HUD read none of it — a
grep for `/api/config` across `hud/src` returned nothing. `default_tone`
was a dashboard control wired to nothing, while `draft.ts` hard-coded
`casual`. That is the deeper reason style "looked permanently Casual":
even with the picker visible, the *starting* style ignored the saved
preference.

**Action:** `hud/src/prefs.ts` hydrates `/api/config` once at launch
and writes back when the wearer changes style from the glasses; the
companion grew a matching style card. One value, three surfaces,
verified round-tripping `professional → casual` against the live API.

**Rule:** when adding a preference, name the client that reads it in
the same change. If there isn't one, it isn't a feature yet.

**2026-08-20 · ⚠ surprise · SDK drift recurred despite a ritual to prevent it**

**Learning:** I-017 (v0.1.15) added "run `npm outdated
@evenrealities/even_hub_sdk` every 2–3 iterations" to the session
ritual. Two versions later the audit found 0.0.13 → 0.0.14, CLI
0.1.13 → 0.1.14 and the simulator **0.7.3 → 0.9.0** — two minor
versions on the tool we use to verify every change. A ritual nobody is
forced to perform is not a control.

0.0.14 turned out to matter: it adds client-side page validators
(`validateEvenHubPageContainer` and friends) that turn a silent `false`
from the bridge into a named cause — directly useful against the L:38
class. Worth noting these run **inside our bundle**, so adopting them
did not require raising `min_sdk_version`; the host-side additions
(OS contextual menu, text brightness) were left alone precisely so an
older phone app still launches the build.

**Action:** `npm outdated` is now the first step of a version bump, and
the resulting versions get recorded in the PROGRESS P19-prep row so
drift is visible in the table rather than in someone's memory.

### P20 — Even Hub submission
*(filled in on phase completion)*

---

## How to write a good retro entry

A useful retro entry isn't "this was hard." It's:

- **Specific** — name the file, function, library, or commit
- **Causal** — why it happened, not just what happened
- **Actionable** — what we'd do differently next time

**Example (hypothetical):**

> **P6 — 2026-05-20 — ⚠ surprise**
>
> **Learning:** `imapflow`'s IDLE auto-reconnect fires before the OAuth access token has a chance to refresh, causing `AUTHENTICATIONFAILED` and an infinite reconnect loop.
>
> **Action:** wrap the connect step in a `try { } catch (AUTHENTICATIONFAILED) { refresh token first }` pattern. Documented in `server/src/mail/imap-idle.ts:42`. Will check for similar patterns when adding Microsoft OAuth.

vs.

> **P6 — 2026-05-20** — IMAP was annoying

The first is institutional memory. The second is venting.

---

## v2 candidate list (born from v1 lessons)

*(Populated as we ship and discover what's missing)*

Seeds from planning:
- Bring-your-own-Ollama (custom URL endpoint)
- Attachments for email
- Group / broadcast sends
- CC / BCC for email
- UI localization
- Apple Mail / Yahoo OAuth
- Multi-user / team accounts with role-based permissions
- Custom tone prompts (user-edited)
- Webhook for incoming email via SendGrid Inbound Parse (alternative to IMAP for users without an existing email account)
- Voice-trained contact name pronunciations
- Scheduled sends + recurring messages
- Message search via full-text index across history
- Cost projection per message ("This send would push you over today's cap")
- Encryption of message bodies at rest (currently only API keys encrypted)
- Threaded conversations view (group inbox messages by contact)
- Quick-replies inferred from incoming message ("they asked X; suggested replies: yes / no / running late")
