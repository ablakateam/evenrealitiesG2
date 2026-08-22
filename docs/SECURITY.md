# Security

What VOX protects, what it does not, and what is currently wrong with it.

---

## Threat model

VOX is single-tenant and self-hosted. One person, one server, one secret.
The assets worth protecting:

| Asset | Where it lives | If it leaks |
|---|---|---|
| Shared secret | Argon2id hash in DB; plaintext in `hud/.env` and the packed `.ehpk` | Full API access: send messages as you, spend your Twilio and model credit |
| `MASTER_KEY` | `/opt/vox/.env`, mode 600 | Every stored third-party credential becomes decryptable |
| Provider credentials | `integrations` / `email_accounts`, AES-256-GCM | Direct abuse of your Twilio, mail and model accounts |
| Message content | `history`, `inbox` tables | Disclosure of everything sent and received |

The realistic attackers are: someone who obtains the `.ehpk`, someone who
photographs a screen, and someone who gets read access to the VPS.

---

## What is implemented

**Authentication.** A single shared secret, sent as `Authorization: Bearer`.
Stored only as an Argon2id hash (argon2id, 19 MiB, t=2, p=1). Rotatable from
the dashboard.

**Credentials at rest.** AES-256-GCM via Node's `crypto`, keyed by
`MASTER_KEY`. Authenticated encryption, fresh 12-byte IV per record, tag
verified on decrypt. Applies to provider API keys and the email password.

**Webhook verification.** Twilio webhooks are verified with HMAC-SHA1 over
the full public URL and sorted parameters. Unverified requests get `403` and
are not processed.

**Passkey-free sign-in.** Dashboard handoff tokens are single-use, 180 s TTL,
stored only as `sha256(token)`, and burned inside the same transaction as
the read so racing exchanges cannot both succeed. The `?from=` return URL is
scheme-validated, so `javascript:` and `data:` are rejected.

**Rate limiting.** Per-user hourly buckets on the expensive paths, persisted
in SQLite. Fails open by design — a metering bug must not block real
messages — and logs loudly when it does.

**Transport.** TLS via Let's Encrypt with auto-renewal. Node binds
`127.0.0.1` only; Nginx is the sole public listener. `ufw` allows 22, 80,
443. SSH is key-only with `fail2ban`.

**Input handling.** Zod validation on every request body. Inbound message
bodies are sanitised before display. Outbound rewrites are sanitised to the
glyph set the G2 font can actually render.

**Secrets never in git.** `.env` gitignored throughout; a pre-commit hook in
`.githooks/` blocks known credential and PII patterns. History has been
scanned blob-by-blob against the live secret values: zero hits.

---

### No credential in the distributed app

The `.ehpk` contains no server address and no secret. `pack.sh` clears
`VITE_VOX_SECRET` before building, then greps `dist/` for the value and
**refuses to pack** if it is present — the check exists because clearing the
shell variable is not sufficient on its own (Vite reads `hud/.env` directly, so
the value comes back unless a higher-precedence override clears it).

This matters because an `.ehpk` offers no protection of its own. The container
is zstd-compressed, not encrypted — there is no cipher anywhere in the packer —
so anything embedded in the bundle is readable by anyone holding the file.

An install gets its credential by pairing instead:

| Step | Endpoint | Auth |
|---|---|---|
| Dashboard mints a code | `POST /api/pair/code` | User secret. **Device secrets are refused** (403) so a compromised install cannot enrol more devices. |
| App redeems it | `POST /api/pair/claim` | None — the caller has no credential yet. Per-IP hourly limit; the code is verified and burned in one transaction. |
| App authenticates | any route | The per-device secret returned once by the claim. |
| Owner revokes | `DELETE /api/devices/:id` | User secret. Takes effect on the next request; other devices are unaffected. |

Only the SHA-256 of a pairing code is stored, so reading the database cannot
replay a live code. Missing, expired and already-used codes return an identical
message, so the endpoint is not an oracle for which codes exist.

The client verifies the credential persisted by reading it back after writing.
The code is already burned at that point, so a silent storage failure would
otherwise leave the app unpaired with no explanation.

---

## Known limitations

Listed here rather than omitted.

### Bearer verification is O(users + devices)

`requireAuth` runs Argon2id against each user secret, then each unrevoked
device secret, until one verifies. Correct, and constant-time per comparison,
but it adds roughly 30–50 ms per comparison and the cost grows with the number
of paired devices. Fine at single-tenant scale; a short-lived verified-token
cache would be the fix if it ever isn't.

### The server runs as root

pm2 runs `vox-server` as root on the VPS. It should run as an unprivileged
`vox` user with ownership limited to `/opt/vox`.

### Inbound SMS is not deduplicated

Twilio retries on timeout. There is no uniqueness constraint on `MessageSid`,
so a retry inserts a duplicate inbox row. Not a disclosure issue; a data
integrity one.

### Third-party data handling

VOX passes audio to OpenAI Whisper and message text to your chosen model
provider, using **your** credentials. Their retention policies apply. If that
matters to you, Ollama Cloud keeps the rewrite step off the major providers,
but Whisper is currently the only speech path.

---

## If a credential is exposed

1. **Shared secret** — rotate from the dashboard (Account → rotate), then
   update `hud/.env` and repack. The old secret stops working immediately.
2. **`MASTER_KEY`** — you cannot rotate it in place; stored credentials are
   encrypted under it. Re-key by re-entering every credential in the wizard
   after replacing the key.
3. **Provider keys** — revoke at the provider first, then update VOX. Assume
   anything committed to git is compromised even after removal.
4. Check `history` and the Twilio console for sends you did not make.

---

## Verifying this repository yourself

```bash
# Any live secret in history?
git rev-list --objects --all | awk '{print $1}' \
  | xargs -n1 git cat-file --batch-check='%(objecttype) %(objectname)' 2>/dev/null \
  | awk '$1=="blob"{print $2}' \
  | while read b; do git cat-file blob "$b" | grep -aqF "$SECRET" && echo "HIT $b"; done

# Secret-shaped strings anywhere
git log -p --all | grep -nE 'sk-[A-Za-z0-9]{20,}|AC[0-9a-f]{32}|BEGIN .*PRIVATE KEY'

# Dependency vulnerabilities
(cd server && npm audit --omit=dev) && (cd web && npm audit --omit=dev) \
  && (cd hud && npm audit --omit=dev)
```

At the last audit all three packages reported **0 production
vulnerabilities**, and the history scan found no live credential. The only
secret-shaped string in history is an obviously-fake Anthropic-style key (an
`sk-ant-` prefix followed by `test-key` and a digit run) used as a fixture in
`server/test/llm.test.ts`.

The literal is deliberately not reproduced here: `.githooks/pre-commit` blocks
`sk-` shaped strings, so spelling it out would make this very file unstageable
— which is precisely the guard working as intended.

---

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something exploitable,
use the contact address on the deployment's `/privacy/` page rather than a
public issue, and allow time for a fix before disclosure.
