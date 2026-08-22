# API

Base URL: `https://<your-domain>`.

Every `/api/*` route except the two noted below requires
`Authorization: Bearer <shared secret>`. The server verifies it with
Argon2id against `users.shared_secret_hash`.

Errors are JSON: `{ "error": "<code>", "message": "<human text>" }`.

| Status | Meaning |
|---|---|
| 400 | Invalid body or query. Zod issues included as `issues`. |
| 401 | Missing or wrong secret; or an expired/used handoff token. |
| 404 | No such record. |
| 422 | Well-formed but unusable — currently only `silent_audio`. |
| 429 | Rate limited. `Retry-After` header in seconds. |
| 502 | An upstream provider failed (Twilio, SMTP, model provider). |

---

## Endpoints

Generated from `server/src/routes/`.

| Endpoint | Auth | Rate limit |
|---|---|---|
| `GET /api/account` | Bearer | — |
| `POST /api/account/rotate-secret` | Bearer | — |
| `POST /api/auth/handoff` | Bearer | handoff 120/h |
| `POST /api/pair/code` | Bearer (user secret only) | — |
| `POST /api/pair/claim` | **None** | 20/h per IP |
| `GET /api/devices` | Bearer | — |
| `DELETE /api/devices/:id` | Bearer | — |
| `POST /api/auth/handoff/exchange` | none | — |
| `POST /api/compose` | Bearer | rewrite 1200/h |
| `GET /api/config` | Bearer | — |
| `PUT /api/config` | Bearer | — |
| `GET /api/contacts` | Bearer | — |
| `POST /api/contacts` | Bearer | — |
| `GET /api/contacts/:id` | Bearer | — |
| `PUT /api/contacts/:id` | Bearer | — |
| `DELETE /api/contacts/:id` | Bearer | — |
| `POST /api/contacts/csv` | Bearer | — |
| `POST /api/contacts/match` | Bearer | — |
| `POST /api/diagnostics` | Bearer | — |
| `POST /api/email` | Bearer | email 400/h |
| `GET /api/email-account` | Bearer | — |
| `PUT /api/email-account` | Bearer | — |
| `DELETE /api/email-account` | Bearer | — |
| `POST /api/email-account/test` | Bearer | — |
| `GET /api/health` | none | — |
| `GET /api/history` | Bearer | — |
| `GET /api/history/stats` | Bearer | — |
| `GET /api/idle-suggestions` | Bearer | — |
| `GET /api/inbox` | Bearer | — |
| `GET /api/inbox/:id` | Bearer | — |
| `POST /api/inbox/:id/read` | Bearer | — |
| `GET /api/inbox/stream` | Bearer | — |
| `GET /api/integrations` | Bearer | — |
| `PUT /api/integrations` | Bearer | — |
| `GET /api/integrations/:provider` | Bearer | — |
| `DELETE /api/integrations/:provider` | Bearer | — |
| `POST /api/integrations/:provider/test` | Bearer | — |
| `POST /api/integrations/twilio/test` | Bearer | — |
| `GET /api/llm/models` | Bearer | — |
| `POST /api/llm/test` | Bearer | — |
| `POST /api/parse` | Bearer | — |
| `POST /api/rewrite` | Bearer | — |
| `POST /api/sms` | Bearer | sms 200/h |
| `POST /api/stt` | Bearer | stt 60/h |
| `POST /api/telemetry/error` | Bearer | — |
| `GET /api/templates` | Bearer | — |
| `POST /api/templates` | Bearer | — |
| `PUT /api/templates/:id` | Bearer | — |
| `DELETE /api/templates/:id` | Bearer | — |
| `POST /api/templates/reorder` | Bearer | — |
| `POST /api/voice-command` | Bearer | rewrite 1200/h |
| `POST /webhooks/twilio/inbound` | signature | — |
| `POST /webhooks/twilio/status` | signature | — |

Two routes are deliberately unauthenticated:

- `POST /api/auth/handoff/exchange` — the single-use token *is* the
  credential. It is burned inside the same transaction as the read.
- `GET /api/health` — a liveness probe, and returns nothing sensitive.

Webhook routes verify a Twilio HMAC-SHA1 signature over the full public URL
rather than a bearer token.

---

## The endpoints that matter

### `POST /api/compose`

The hot path. Accepts either raw audio or a transcription.

```http
POST /api/compose
Authorization: Bearer <secret>
Content-Type: multipart/form-data

audio=<raw PCM 16 kHz mono 16-bit LE>
is_raw_pcm=true
```

```jsonc
{
  "transcription": "text alex i'm running ten minutes late",
  "stt_latency_ms": 1480,
  "language": "en",
  "intent": {
    "channel": "sms",
    "recipient_id": 5,
    "recipient_name": "Alex",
    "body": "i'm running ten minutes late",
    "subject": null,
    "language": "en",
    "confidence": { "recipient": 3, "channel": 2, "body": 3 },
    "candidates": []
  },
  "variants": [
    { "tone": "casual",       "text": "Hey, running about 10 late!", "latency_ms": 812 },
    { "tone": "professional", "text": "I will be approximately...",  "latency_ms": 940 }
    // friendly, formal, sarcastic, grammar, original
  ],
  "total_latency_ms": 2410
}
```

All seven variants are generated in one `Promise.all`, so tone switching on
the glasses costs no further round trip.

`422 silent_audio` when the submitted PCM is below the RMS floor. This is
not an error condition to retry blindly — it means the microphone captured
nothing. `whisper-1` invents plausible text from silence, often in the wrong
language, so the guard refuses rather than paying for a hallucination.

A JSON body of `{"transcription": "..."}` skips speech-to-text entirely.

### `POST /api/sms` · `POST /api/email`

```jsonc
// POST /api/sms
{ "to": "+15555550142", "body": "...", "contact_id": 5,
  "tone": "casual", "client_uuid": "uuid-v4" }
```

`client_uuid` is an idempotency key. Re-posting the same UUID returns the
existing outbox row instead of sending twice — which matters when a WebView
stalls mid-send and the user retries.

`/api/email` additionally requires `subject`. The glasses derive one from the
message body when the user did not dictate a subject, because there is no way
to type on the device.

### `POST /api/auth/handoff` → `POST /api/auth/handoff/exchange`

Passkey-free dashboard sign-in. Mint with the secret, exchange once for it.

```jsonc
// POST /api/auth/handoff   → 32-byte base64url token, 180 s TTL
{ "token": "xjweTX...", "expires_at": "...", "expires_in": 180 }

// POST /api/auth/handoff/exchange  (no auth — the token is the credential)
{ "token": "xjweTX..." }  →  { "secret": "...", "user_id": 1 }
```

Only `sha256(token)` is stored. The secret is captured from the minting
request's `Authorization` header and stored AES-256-GCM encrypted on the row,
so handoff keeps working after a secret rotation. The row is marked used in
the same transaction as the read, so two racing exchanges cannot both win.

### `POST /api/pair/code` → `POST /api/pair/claim`

How an app with no credential gets one. This is the only unauthenticated
credential-issuing path in VOX, so the constraints are worth stating.

```jsonc
// POST /api/pair/code    (dashboard, user secret)
{ "label": "Work glasses" }
→ { "code": "ABCD-2345",
    "url": "https://vox.example.com/p/ABCD2345",
    "server": "https://vox.example.com",
    "expires_at": "...", "expires_in": 600 }

// POST /api/pair/claim   (unpaired app, NO auth — it has no credential yet)
{ "code": "ABCD-2345", "device_name": "VOX glasses" }
→ { "secret": "...", "server": "https://vox.example.com",
    "device_id": 3, "name": "VOX glasses" }
```

The `url` carries both halves the app needs — origin says *which server*, path
says *which code*. A bare code could not work: the app has no server address
baked in, and resolving a code to a host would need a central directory that
self-hosted VOX deliberately does not have.

- Only `sha256(code)` is stored. Reading the database cannot replay a live code.
- Read and burn happen in one transaction, so two apps racing the same code
  cannot both get a credential.
- Missing, expired and already-used all return the same message — the endpoint
  does not reveal which codes exist.
- `POST /api/pair/code` **rejects device secrets with 403**. A compromised
  install cannot enrol further installs.
- The claim limiter fails *closed*. Unlike ordinary rate limiting, a metering
  error here would turn an unauthenticated endpoint into an unmetered guessing
  oracle.

Codes accept lower case, hyphens and spaces, and map the Crockford confusables
(`I`/`L` → `1`, `O` → `0`), so a code read off a screen by eye still matches.

### `GET /api/devices` · `DELETE /api/devices/:id`

Paired installs, and revocation. Device rows never expose a secret or its hash.
Revoking sets `revoked_at`; `requireAuth` only considers unrevoked rows, so the
credential stops working on the next request and no other device is affected.

### `GET /api/inbox/stream`

Server-Sent Events. Emits `hello` on connect, then `new` and `read` events,
with a heartbeat every 25 s. Requires `proxy_buffering off` in Nginx.

> Known gap: inbound **email** publishes to this stream; inbound **SMS**
> does not yet.

### `GET /api/idle-suggestions`

One round trip that returns everything the glasses home screen needs —
ranked suggestions plus a status block (Twilio, email, today's counts,
unread). Deliberately not several small endpoints: cold start over BLE has a
latency budget, and chatty per-widget fetches spend it.

### `POST /api/diagnostics`

Runs live checks against the database, Twilio, SMTP, IMAP and each
configured model provider. The fastest way to tell whether a deployment
problem is VOX or a provider.

---

## Rate limits

Hourly buckets per user, persisted in SQLite so they survive a restart.

| Bucket | Limit | Applies to |
|---|---|---|
| `stt` | 60/h | `/api/stt` |
| `rewrite` | 1200/h | `/api/compose`, `/api/voice-command` |
| `sms` | 200/h | `/api/sms` |
| `email` | 400/h | `/api/email` |
| `handoff` | 120/h | `/api/auth/handoff` |

Metering **fails open**: if the counter itself errors, the request proceeds
and the failure is logged. A metering bug should never block real messages.
