# Troubleshooting

Symptom → likely cause → how to confirm.

Start here:

```bash
curl -s https://your-domain/api/health | jq        # is the server alive?
ssh vox-vps 'pm2 logs vox-server --lines 100'      # what did it say?
curl -s -X POST https://your-domain/api/diagnostics \
  -H "Authorization: Bearer $SECRET" | jq          # what is actually broken?
```

`/api/diagnostics` tests the database, Twilio, SMTP, IMAP and every
configured model provider in one call, and is usually the fastest way to
tell whether a problem is VOX or a provider.

---

## Installing on the glasses

### "Test version expired", or the update never appears

**The build is on the Private track.** Uploads default to Private, and a
Private build reports this to invited testers with no indication that the
track is why. Switch it to **Beta** in the portal.

Then: confirm the portal shows the version you uploaded (if it still shows
the previous one, the upload silently failed); confirm the tester's
invitation is **Active**, not **Invited**; force-quit and reopen the Even
Realities app. If an update still will not appear, uninstall VOX on the
phone and install fresh — that bypasses version comparison entirely.

### "Not paired yet" on the glasses

Expected on a fresh install — the app ships with no credential. Open VOX on
your phone, paste a pairing link from Account → Pair your glasses, then tap
once on the glasses to re-check.

If it returns after pairing succeeded, the credential did not persist. The app
reports this explicitly ("the credential did not persist on this device")
because it reads the value back after writing it. Generate a fresh code and
retry — the previous one is already burned.

### "That pairing code is not valid, has expired, or was already used"

One message covers all three deliberately, so the endpoint cannot be used to
discover which codes exist. In practice it is almost always the ten-minute TTL
or a code already redeemed. Generate a new one.

### "Too many pairing attempts"

Twenty claim attempts per hour per IP. Wait for the hour to roll over. This
limiter fails closed, so it can also trigger if the database is unwritable —
check `pm2 logs vox-server` for `pair attempt metering failed`.

### Pairing fails with "Could not reach &lt;host&gt;"

Either the address is wrong, the server is down, or the domain is not in the
build's network whitelist. The Even Realities App blocks non-whitelisted
domains before any traffic leaves the WebView, and wildcards are not
supported — so a build packed for one domain cannot talk to another. Confirm
`VOX_DOMAIN` matched the server you are pairing to when `pack.sh` ran.

### The app launches, then immediately opens the microphone

Fixed in v0.1.17. The temple tap that launches the app was landing on the
home screen. If you see this, you are running an older build.

---

## Voice

### "I didn't hear anything"

The server measured the audio and found silence. In order of likelihood:

1. **Microphone permission denied.** Grant it in the Even Realities app.
2. **Wrong input source.** VOX names `AudioInputSource.Glasses` explicitly;
   older builds left it to the host default, which may be the phone mic.
3. **You genuinely stopped too early** — under ~125 ms of audio.

This error is a *feature*: `whisper-1` invents plausible text from silence,
often in another language, so the server refuses rather than passing a
hallucination on to you.

```bash
ssh vox-vps "pm2 logs vox-server --lines 200 --nostream | grep 'stt:'"
# logs requested vs detected language, duration and RMS for every call
```

### Transcription comes back in the wrong language

Set `voice_language` in Preferences to your language rather than `auto`.
Given a free choice on marginal audio, `whisper-1` picks badly — English in,
Japanese out is the classic signature. The `stt:` log line above shows
requested vs detected language, which distinguishes a detection problem from
a bad-audio problem.

### Compose returns 400 `missing_credentials`

No model provider key is resolvable. Check Integrations in the dashboard;
remember the database takes precedence over environment variables.

---

## Messaging

### Inbound SMS never arrives

Almost always webhook signature verification.

```bash
ssh vox-vps "pm2 logs vox-server --lines 200 --nostream | grep -i twilio"
# "twilio webhook signature mismatch" → the URL does not match
```

`TWILIO_WEBHOOK_BASE_URL` must exactly equal the URL configured in the
Twilio console — scheme, host, no trailing slash. Twilio signs the full URL
it called. Also confirm the number's "A message comes in" webhook points at
`/webhooks/twilio/inbound` with POST.

### Outbound SMS fails

Check the error code in the response and in `history.error`:

| Code | Meaning |
|---|---|
| `invalid_to_number` | Not valid E.164, or unroutable |
| `unauthorized` | Bad Twilio credentials |
| `missing_credentials` | No SID/token, or neither a From number nor a messaging service |
| `recipient_unsubscribed` | The recipient replied STOP |

### Email will not send

`smtp_auth_failed` on Gmail, Outlook or iCloud almost always means you used
your account password. All three require an **app password**. Test from
Integrations → Email account → Test.

### Inbox shows thousands of unread

Expected on a first connection: the IMAP worker backfills the entire
mailbox as unread. A known limitation; the glasses badge caps at "99+".

### Inbox stops updating

The IMAP connection dropped and is in exponential backoff (5 s → 15 s →
60 s → 5 m → 15 m → 60 m).

```bash
ssh vox-vps "pm2 logs vox-server --lines 100 --nostream | grep -i imap"
```

`imap idle worker error` with `AUTHENTICATIONFAILED` means the credential or
app password was revoked. Re-enter it; the worker restarts on save.

---

## Dashboard

### "This link has expired" on connect

Handoff tokens are single-use with a 180-second TTL. Tap **Open dashboard**
again for a fresh one. If it fails repeatedly, the server clock may be wrong
— check `timedatectl` on the VPS.

### No way back to VOX after opening the dashboard

Fixed in v0.1.20. The companion now passes a return address and the shell
renders a **Back to VOX** control. On an older build, force-quit the Even
Realities app and reopen.

### 401 on every request

The stored secret no longer matches. Sign out and paste the current one, or
use **Connect another device** from an already-authenticated session. If the
secret was rotated, `hud/.env` needs updating and the glasses app repacking
too.

---

## Server and infrastructure

### 502 Bad Gateway

Node is not running or not listening.

```bash
ssh vox-vps 'pm2 list && curl -s localhost:3000/api/health'
ssh vox-vps 'pm2 logs vox-server --err --lines 50'
```

Common startup failures: `MASTER_KEY must decode to 32 bytes` (malformed
key), `Invalid environment configuration` (a required variable missing), or
a native module built for the wrong architecture — always `npm ci` **on the
VPS**, never rsync `node_modules`.

### SSE / inbox stream disconnects

`proxy_buffering off` and a long `proxy_read_timeout` must be set on
`location /api/` in Nginx. Without them the stream is buffered or cut.

### Certificate expired

```bash
ssh vox-vps 'certbot renew --dry-run && systemctl status certbot.timer'
```

### Disk filling

pm2 logs are not rotated by default:

```bash
ssh vox-vps 'du -sh ~/.pm2/logs/* /opt/vox/data/*'
ssh vox-vps 'pm2 install pm2-logrotate'
```

---

## Development

### The simulator will not get past the listening screen

Expected. The simulator streams near-silent audio, which the server's
silence guard correctly rejects with `422`. Run the dev build with `?demo=1`
to force a scripted transcription — it is gated behind `import.meta.env.DEV`
and cannot ship.

### A screen renders blank after an edit

Vite HMR reset `firstPageShown` while the simulator kept the original
startup container. `showPage` handles this by falling back to a rebuild. If
it persists, restart the simulator.

### A list row is missing

The container is too short. Rows draw at a ~40 px pitch and surplus rows are
not drawn at all — they do not scroll into view. Size with
`listHeightFor(rows)`; both Idle and Confirm warn to the console when their
own container cannot show every row they built.
