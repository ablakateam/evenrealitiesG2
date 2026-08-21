# Configuration

Where every setting lives, and which are required.

Three `.env` files, one per deployable unit. None is committed; each has a
`.env.example` beside it.

| File | Consumed by | Committed |
|---|---|---|
| `server/.env` → `/opt/vox/.env` | API server at runtime | No |
| `hud/.env` | `pack.sh` and Vite, at **build** time | No |
| `web/.env` | Vite, local dev only | No |

---

## Precedence: database beats environment

Third-party credentials resolve **database first, environment second**:

```
getIntegrationCreds(userId, provider)
  ├─ encrypted `integrations` row?  → decrypt with MASTER_KEY → use
  └─ else environment variable?     → use
     else                           → missing_credentials
```

The database path is what the setup wizard writes and is the intended one.
Environment variables are the bootstrap, so a fresh server works before
anyone opens the dashboard. **Setting an env var will not override a
credential already saved in the dashboard** — remove it there first.

---

## `server/.env` — required

| Variable | Notes |
|---|---|
| `MASTER_KEY` | 32 random bytes, base64. Encrypts every stored credential (AES-256-GCM). **Losing it makes stored credentials unrecoverable.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `TWILIO_WEBHOOK_BASE_URL` | Public origin of this server. Twilio signs webhooks against the full URL it called — a mismatch fails every inbound SMS with `403` and no other symptom. |

`server/deploy.sh` generates `MASTER_KEY` and `BOOTSTRAP_SECRET` on a first
deploy and prints the bootstrap secret once.

## `server/.env` — optional

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3000` | Binds `127.0.0.1` only |
| `DB_PATH` | `./data/vox.db` | Created with its parent on first boot |
| `LOG_LEVEL` | `info` | `fatal…trace` |
| `BOOTSTRAP_SECRET` | — | Seeds the first user on an empty database. Stored as an Argon2id hash. Needed once. |
| `PUBLIC_BASE_URL` | falls back to the Twilio one | Outbound attribution headers |
| `TWILIO_SID` / `TWILIO_TOKEN` | — | Bootstrap fallback; prefer the wizard |
| `TWILIO_FROM_NUMBER` | — | E.164. Either this or a messaging service is required to send |
| `TWILIO_MESSAGING_SERVICE_SID` | — | Preferred over `FROM` when set |
| `OPENAI_KEY` | — | **Required for voice** — Whisper is the only speech path |
| `ANTHROPIC_KEY` / `OPENROUTER_KEY` / `OLLAMA_CLOUD_KEY` | — | At least one model provider is required for compose |
| `OPENROUTER_BASE_URL` / `OLLAMA_CLOUD_BASE_URL` | official | Rarely changed |

Email is **not** configured here. SMTP/IMAP credentials are per-account, so
they are entered in the dashboard and stored encrypted in the database.

---

## `hud/.env` — build time

Vite inlines every `VITE_*` value into the bundle, so these become plain
strings inside the packed `.ehpk`. See [SECURITY.md](SECURITY.md).

| Variable | Required | Notes |
|---|---|---|
| `VOX_DOMAIN` | Yes | Bare hostname. `pack.sh` substitutes it into `app.json`'s network whitelist — without it the glasses cannot reach the server at all. |
| `VITE_VOX_SERVER` | Yes | Full origin used at runtime |
| `VITE_VOX_SECRET` | Yes | Shared secret sent as `Authorization: Bearer` |
| `VOX_SUPPORT_EMAIL` | No | Substituted into the hosted legal pages by `web/deploy.sh` |

Changing any of these requires `bash pack.sh` and a re-upload.

---

## `web/.env` — local dev only

| Variable | Notes |
|---|---|
| `VITE_API_BASE` | Leave **empty** in production — Nginx serves the bundle and proxies `/api` same-origin. Set it to point local `npm run dev` at a deployed server. |

---

## User preferences (database, not env)

23 settings in the `preferences` table, edited in the dashboard, exposed at
`GET`/`PUT /api/config`. The ones that reach the glasses:

| Setting | Default | Effect |
|---|---|---|
| `default_tone` | `casual` | Style new messages start in; mirrored by the glasses Style menu |
| `voice_language` | `en` | Language pinned for speech recognition |
| `max_recording_seconds` | 60 | Hard cap on a recording |
| `silence_autostop_seconds` | 4 | Silence before recording ends; `0` disables |
| `rewrite_provider` / `rewrite_model` | `anthropic` / `claude-haiku-4-5` | Which model performs intent parsing and rewrites |
| `default_channel` | `sms` | Assumed channel when the speech does not say |

**`voice_language` defaults to `en` rather than auto-detect.** Given a free
choice on marginal audio, `whisper-1` will confidently return another
language — English speech coming back as Japanese was a real reported bug.
Set a specific language, or `auto` if you need multilingual and accept that.

Remaining settings — daily limits, quiet hours, notification filters, smart
toggles — are stored and editable but not all are consumed yet.
[ISSUES.md](../ISSUES.md) is the honest record of which.

---

## Rotating the shared secret

1. Dashboard → Account → rotate. The new value is shown **once**.
2. Update `VITE_VOX_SECRET` in `hud/.env`.
3. `bash hud/pack.sh`, re-upload, reinstall.

The old secret stops working immediately. Skipping step 2 leaves the
installed glasses build unable to authenticate.

Existing dashboard handoff tokens keep working: the secret is captured at
mint time and stored encrypted on the row.
