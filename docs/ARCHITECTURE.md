# Architecture

Three deployable units, one server, no VOX-operated infrastructure.

---

## Components

| Unit | Runtime | Where it runs | Built from |
|---|---|---|---|
| Glasses app + phone companion | WebView, `@evenrealities/even_hub_sdk` | G2 display + Even Realities app | `hud/` |
| API server | Node 20, Express, better-sqlite3 | Your VPS, pm2 behind Nginx | `server/` |
| Dashboard | React 18 SPA, static | Same VPS, served by Nginx | `web/` |

`hud/` produces **one bundle with two render targets**. `hud/src/main.ts`
renders the companion DOM into `#app` *and* boots the glasses bridge. On the
glasses the DOM is invisible; in the phone app the container API is a no-op.
Neither surface knows about the other.

---

## Why single-tenant

Every table carries a `user_id` and the code paths are multi-user shaped, but
authentication is a single shared secret rather than accounts. That is
deliberate: VOX is one person's messaging client running on one person's
server. Adding OAuth would mean operating an identity provider, which would
mean operating infrastructure, which is exactly what the design avoids.

---

## Request flow: composing a message

```
G2 mic
  │  PCM 16 kHz mono, streamed as audioEvent frames
  ▼
hud/src/audio.ts ── accumulates chunks, computes RMS for the live trace
  │
  │  POST /api/compose   multipart, Bearer <shared secret>
  ▼
server/src/routes/compose.ts
  │
  ├─ rate-limit  (rewrite bucket, 1200/h)
  ├─ auth        (argon2id verify)
  │
  ▼
server/src/compose.ts
  │
  ├─ audio/stt.ts ──► RMS silence guard ──► WAV wrap ──► Whisper
  │                   (refuses silence rather than letting the model
  │                    hallucinate — see below)
  │
  └─ Promise.all ─┬─ intent parse      (contacts injected as grounding)
                  ├─ rewrite: casual
                  ├─ rewrite: professional
                  ├─ rewrite: friendly
                  ├─ rewrite: formal
                  ├─ rewrite: sarcastic
                  └─ rewrite: grammar
                     + 'original' appended locally (identity, no call)
  │
  ▼
{ transcription, intent, variants[7] }
  │
  ▼
hud/src/draft.ts ── singleton draft; Confirm re-reads it on every mount
  │
  ▼
Confirm screen ── SEND ──► POST /api/sms | /api/email  (client_uuid = idempotency)
                                │
                                ├─ outbox row (pending → sent | failed)
                                ├─ history row
                                └─ contact.last_sent_at
```

**Seven rewrites in one round trip** is the central latency decision. Tone
switching on the glasses has to feel instantaneous, and a second round trip
over BLE plus an LLM call would not. So every variant is generated up front
in a single `Promise.all` — measured at ~2.4 s for intent + six rewrites.
Switching tone afterwards is a local array lookup.

**The silence guard** exists because `whisper-1` does not fail on silence —
it hallucinates, confidently, and frequently in another language. English
speech coming back as Japanese was a real reported bug. The server measures
RMS before spending the API call and returns `422 silent_audio` below the
floor. See [EVEN_REALITIES.md](EVEN_REALITIES.md).

---

## Request flow: receiving

```
inbound SMS ──► Twilio ──► POST /webhooks/twilio/inbound
                              │  HMAC-SHA1 signature verified against the
                              │  full public URL (TWILIO_WEBHOOK_BASE_URL)
                              ├─ resolve contact by phone
                              ├─ sanitizeForHud()  emoji/accents → ASCII
                              └─ inbox row

inbound email ──► ImapIdleWorker (one per account, persistent IDLE)
                              │  backfills UIDs missed while disconnected,
                              │  then reacts to `exists` events
                              ├─ parse (mailparser)
                              ├─ resolve contact by address
                              ├─ inbox row
                              └─ inboxBus.publishNew ──► GET /api/inbox/stream (SSE)
```

IMAP IDLE is why VOX needs a persistent server rather than serverless
functions: the connection has to stay open. Reconnection uses exponential
backoff (5 s → 15 s → 60 s → 5 m → 15 m → 60 m).

---

## Request flow: dashboard authentication

```
companion (holds the secret)
  │  POST /api/auth/handoff        Bearer <secret>
  ▼
server mints a single-use token
  │  · 32 random bytes, base64url
  │  · 180 s TTL
  │  · only sha256(token) stored
  │  · the secret is captured from the Bearer header and stored
  │    AES-256-GCM encrypted on the row, so handoff survives rotation
  ▼
companion opens  /connect?t=<token>&from=<companion-url>
  ▼
dashboard  POST /api/auth/handoff/exchange
  │  row marked used INSIDE the same transaction as the read,
  │  so two racing exchanges cannot both win
  ▼
secret returned once → stored in localStorage → token stripped from history
```

The alternative — putting the permanent secret in a QR code or a URL — was
the previous design and is why this exists. A photograph of that QR was
unlimited spend, forever, undetectable.

---

## Data model

SQLite, WAL mode, migrations in `server/src/db.ts`.

| Table | Holds |
|---|---|
| `users` | Argon2id hash of the shared secret |
| `preferences` | 23 per-user settings; read by both dashboard and glasses |
| `integrations` | Twilio and model-provider credentials, AES-256-GCM encrypted |
| `email_accounts` | SMTP/IMAP settings and password, encrypted; IMAP cursor |
| `contacts` | Name, E.164 phone, email, tags, favourite, last-used channel |
| `templates` | Reusable message bodies, ordered |
| `history` | Audit log of every send and receive, with status and cost |
| `inbox` | Received messages, read state, raw payload |
| `outbox` | Idempotency ledger keyed by `client_uuid` |
| `auth_handoffs` | Single-use dashboard sign-in tokens |
| `client_errors` | Crash dumps shipped from the glasses |
| `rate_limit_state` | Hourly counters per user and bucket |

---

## Credential resolution

Every third-party credential resolves **database first, environment second**:

```
getIntegrationCreds(userId, provider)
  ├─ integrations row?  → decrypt with MASTER_KEY → use
  └─ else env var?      → use
     else null          → LlmError('missing_credentials')
```

The database path is what the setup wizard writes. The environment path is
the bootstrap, so a fresh server works before anyone opens the dashboard.
`envFallbackCreds` reads `process.env` directly rather than the cached,
validated `env` object, so `pm2 reload --update-env` picks up a rotated key
without a code change.

---

## Rendering model on the glasses

There is no DOM and no CSS. A page is up to 12 absolutely-positioned
containers, and exactly one must have `isEventCapture: 1`. `hud/src/render.ts`
compiles declarative `TextBox` / `ListBox` specs into SDK container objects.

Two rules dominate the design, both learned the hard way:

1. **Container shape must stay stable.** `rebuildPageContainer` silently
   fails when a rebuild re-introduces a container ID that a previous smaller
   rebuild dropped. Every chrome page is therefore padded to the same maximal
   six-container shape, with unused containers parked off-screen.
2. **Never hand-pick a list height.** Rows draw at a ~40 px pitch and a list
   too short for its items does not scroll — the extra rows are simply never
   drawn. All heights come from `listHeightFor(rows)`.

Both are explained with their failure modes in
[EVEN_REALITIES.md](EVEN_REALITIES.md).

---

## Deployment topology

```
                    :443 TLS (Let's Encrypt, certbot auto-renew)
                              │
                          ┌───▼────┐
                          │ Nginx  │
                          └───┬────┘
              ┌───────────────┼────────────────┐
              │               │                │
        /api  │      /webhooks│              / │
              ▼               ▼                ▼
        ┌─────────────────────────┐   ┌────────────────┐
        │  node  127.0.0.1:3000   │   │ /opt/vox-web   │
        │  pm2 · vox-server       │   │ static SPA     │
        └───────────┬─────────────┘   └────────────────┘
                    │
              /opt/vox/data/vox.db  (SQLite, WAL)
```

The Node process binds to loopback only. Nginx is the sole public listener.
`ufw` allows 22, 80 and 443; everything else is denied.
