# Deployment

Clean VPS to a running system. Every step is one someone actually has to
perform — there are no implied steps between them.

---

## What you need first

| Requirement | Notes |
|---|---|
| **VPS** | 1 vCPU, 1 GB RAM, 25 GB SSD is enough. VOX idles around 70 MB. Tested on Vultr; any provider works. |
| **OS** | Ubuntu 24.04 LTS. 22.04 works; the sshd hardening step differs slightly. |
| **Domain** | An A record pointing at the VPS IP. Required — Twilio will not send webhooks to a bare IP, and Let's Encrypt will not issue for one. |
| **Twilio account** | A phone number capable of SMS. Optional if you only want email. |
| **Email account** | With SMTP and IMAP access. Gmail and Outlook need an app password, not your login password. |
| **OpenAI API key** | Required for Whisper speech-to-text. There is no alternative STT provider in this build. |
| **Model provider key** | Anthropic, OpenAI, OpenRouter or Ollama Cloud, for the tone rewrites. OpenAI can serve both roles. |

Sizing: SQLite with WAL, one Node process, one persistent IMAP connection.
The dominant disk consumer is inbound email bodies. 25 GB is generous.

**Ports:** 22 (SSH), 80 (ACME challenge and the HTTPS redirect), 443. Nothing
else needs to be open. The Node process binds to `127.0.0.1:3000` and is not
reachable from outside.

---

## 1. DNS

Point an A record at the VPS before starting — certbot validates over HTTP
and will fail if DNS has not propagated.

```bash
dig +short vox.example.com     # must return your VPS IP
```

## 2. Base system

```bash
ssh root@YOUR_VPS_IP
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx ufw fail2ban git build-essential

# Node 20 (better-sqlite3 and argon2 compile native modules against it)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

node -v && nginx -v && pm2 -v
```

## 3. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
ufw status
```

## 4. Harden SSH

```bash
cat > /etc/ssh/sshd_config.d/00-vox-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin without-password
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl restart ssh
sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
```

> The `00-` prefix is load-bearing. OpenSSH takes the **first** value it sees
> for an option, and Ubuntu ships `50-cloud-init.conf` with
> `PasswordAuthentication yes`. A `99-` file never takes effect. Confirm with
> `sshd -T`, which prints effective config — `sshd -t` only checks syntax.

Copy your key up **before** restarting sshd, or you will lock yourself out:

```bash
ssh-copy-id root@YOUR_VPS_IP     # from your workstation
```

## 5. Nginx and TLS

```bash
cat > /etc/nginx/sites-available/vox <<'EOF'
server {
    listen 80;
    server_name vox.example.com;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Server-Sent Events on /api/inbox/stream
        proxy_buffering off;
        proxy_read_timeout 24h;
    }

    location /webhooks/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    root /opt/vox-web;
    index index.html;
    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location / { try_files $uri $uri/ /index.html; }
}
EOF
mkdir -p /var/www/certbot /opt/vox-web
ln -sf /etc/nginx/sites-available/vox /etc/nginx/sites-enabled/vox
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d vox.example.com --agree-tos -m you@example.com --redirect
systemctl status certbot.timer      # auto-renewal
```

`proxy_buffering off` on `/api/` matters: `/api/inbox/stream` is SSE, and
Nginx buffering would hold events until the buffer filled.

`try_files $uri $uri/ /index.html` serves the SPA, and also serves the
static `/privacy/` and `/terms/` pages directly because they exist on disk.

## 6. Deploy the server

From your **workstation**, not the VPS. Add an SSH alias first:

```bash
cat >> ~/.ssh/config <<'EOF'
Host vox-vps
    HostName YOUR_VPS_IP
    User root
    IdentityFile ~/.ssh/id_ed25519
EOF
```

```bash
git clone https://github.com/ablakateam/evenrealitiesG2.git vox && cd vox
cd server
npm ci
npm run build
bash deploy.sh
```

`deploy.sh` rsyncs `dist/` plus the manifests, runs `npm ci --omit=dev`
**on the VPS**, and reloads pm2. The remote install is deliberate:
`better-sqlite3` and `argon2` are native modules that must compile against
the target architecture — shipping local `node_modules` from macOS to a
Linux box produces a binary that cannot load.

On a first deploy it generates `/opt/vox/.env` with a fresh `MASTER_KEY` and
`BOOTSTRAP_SECRET`, mode 600, and prints the bootstrap secret **once**.

> **Save that secret.** It is how you first sign in. It is stored on the
> server only as an Argon2id hash and cannot be recovered.

Persist pm2 across reboots:

```bash
ssh vox-vps 'pm2 save && pm2 startup systemd -u root --hp /root'
```

Verify:

```bash
curl -s https://vox.example.com/api/health | jq
# {"status":"ok","service":"vox-server","schema_version":3,...}
```

## 7. Deploy the dashboard

```bash
cd ../web
npm ci
bash deploy.sh          # builds, substitutes the support email, rsyncs, reloads nginx
```

Open `https://vox.example.com/`, paste the bootstrap secret, and complete the
six-step wizard at `/setup`: Twilio → email account → AI provider → contacts.
Credentials entered here are encrypted with `MASTER_KEY` and stored in the
database, taking precedence over any environment variables.

## 8. Twilio webhooks

In the Twilio console, on your number:

| Field | Value |
|---|---|
| A message comes in | `https://vox.example.com/webhooks/twilio/inbound` (HTTP POST) |
| Status callback | `https://vox.example.com/webhooks/twilio/status` (HTTP POST) |

`TWILIO_WEBHOOK_BASE_URL` in `/opt/vox/.env` must match this domain exactly.
Twilio signs the request against the full URL it called; a mismatch produces
a `403` on every inbound message and no other symptom.

## 9. Build and install the glasses app

```bash
cd ../hud
npm ci
cp .env.example .env
# VOX_DOMAIN=vox.example.com   ← the only value pack.sh needs
bash pack.sh            # → hud/vox.ehpk
```

`VOX_DOMAIN` goes into `app.json`'s network whitelist. It is not a secret, but
it is load-bearing: the Even Realities App blocks requests to any domain the
manifest does not list, and wildcards are not supported. A build can therefore
only ever talk to the one domain it was packed for — which is why each
self-hoster packs their own `.ehpk`.

The bundle carries **no credential**. `pack.sh` clears `VITE_VOX_SECRET`,
then greps `dist/` and refuses to pack if the value is still present.

Upload `vox.ehpk` at [hub.evenrealities.com](https://hub.evenrealities.com),
then **switch the build to the Beta track**. Uploads default to Private, and
a Private build reports "test version expired" to invited testers with no
indication that the track is the cause.

Install from the Even Realities phone app → Even Hub → VOX.

### Pair the install

A fresh install has no server address and no credential — it shows a pairing
screen until you give it one.

1. Dashboard → **Account** → **Pair your glasses** → *Create pairing link*.
2. Open VOX on the phone, paste the link, tap **Pair this device**.
3. Tap once on the glasses to leave the *not paired yet* card.

The link (`https://vox.example.com/p/ABCD2345`) carries the origin and the
code together — the app has nothing baked in, so it needs both. Codes last ten
minutes and are single use. What the device stores is its own credential,
revocable on its own from the same screen.

---

## Alternative deployments — NAS, homelab, Tailscale

Nothing above is VPS-specific. VOX is a Node 20 + SQLite process; the Ubuntu
steps are one way to host it, not a requirement. This section covers the common
alternative: a NAS (Unraid, Synology, TrueNAS) reached over Tailscale.

### Run it in a container

The usual stumbling block on a NAS is that `argon2` and `better-sqlite3` are
native modules — they compile against the local Node ABI, so a bare install
needs python3 and a C++ toolchain. The provided image builds them in one stage
and copies the result into a slim runtime, so the host needs neither.

```bash
cp server/.env.example .env      # fill it in — see docs/CONFIGURATION.md
docker compose up -d
docker compose logs -f vox-server
```

The database lives on the `vox-data` volume, so it survives image rebuilds.
The API is published on `127.0.0.1:3000` only; something in front terminates
TLS.

Note `HOST=0.0.0.0` in `docker-compose.yml`. The application binds `127.0.0.1`
by default — correct on the VPS, where Nginx should be the only caller — but
loopback inside a container is not reachable from outside it.

### TLS without Nginx or certbot

`tailscale serve` terminates TLS with a real certificate on your `*.ts.net`
name, which replaces sections 5 and part of 1 entirely:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

Your `VOX_DOMAIN` is then the `ts.net` hostname. Any device on your tailnet —
including the phone running the Even Realities app — can reach it.

### Inbound SMS needs to be publicly reachable

This is the one thing a private tailnet cannot do. Twilio delivers inbound
messages by POSTing a webhook to you, and it is not on your tailnet:

```bash
tailscale funnel --bg 443        # exposes the same service publicly over HTTPS
```

Set `TWILIO_WEBHOOK_BASE_URL` to that public URL and follow section 8 as
written. Webhook signatures are verified, so the exposed surface is the webhook
route plus the pairing claim endpoint, both of which are designed for it.

**If you only use email, skip Funnel.** SMTP and IMAP are outbound connections
from your box, so they work on a private tailnet with nothing exposed at all.

### You still build your own `.ehpk`

Each build is pinned to one domain — `app.json`'s network whitelist takes a
single origin, wildcards are unsupported, and the Even Realities App blocks
anything else before the request leaves the WebView. So set `VOX_DOMAIN` to
your `ts.net` hostname and pack it yourself (section 9). The phone must be on
the tailnet for the glasses app to reach the server.

### Other hosts

The same shape works anywhere that runs Node 20 or Docker — a Raspberry Pi, a
spare mini-PC, a home server behind Cloudflare Tunnel. The only hard
requirements are HTTPS with a valid certificate (the WebView will not accept
otherwise), and a publicly reachable webhook URL if you want inbound SMS.

---

## Operating it

### Updating

```bash
git pull
cd server && npm ci && npm run build && bash deploy.sh    # zero-downtime pm2 reload
cd ../web && npm ci && bash deploy.sh
cd ../hud && npm ci && bash pack.sh                       # then re-upload
```

Database migrations run automatically at boot, inside a transaction, and are
idempotent — `server/src/db.ts` tracks applied versions in `schema_meta`.

### Restarting

```bash
ssh vox-vps 'pm2 reload vox-server'     # graceful
ssh vox-vps 'pm2 restart vox-server'    # hard
ssh vox-vps 'pm2 logs vox-server --lines 100'
```

### Backups

Everything that matters is one SQLite file. Back it up with the online API,
not `cp` — a plain copy of a WAL database can be torn:

```bash
ssh vox-vps "sqlite3 /opt/vox/data/vox.db \".backup '/root/vox-\$(date +%F).db'\""
```

Also back up `/opt/vox/.env`. Losing `MASTER_KEY` makes every stored
credential permanently undecryptable — they would all have to be re-entered.

### Logs and health

| What | Where |
|---|---|
| Application | `pm2 logs vox-server`, files under `~/.pm2/logs/` |
| Nginx | `/var/log/nginx/{access,error}.log` |
| Health | `GET /api/health` — public, no auth |
| Deep check | `POST /api/diagnostics` — authenticated; tests DB, Twilio, SMTP, IMAP and each model provider |

pm2 logs are not rotated by default. On a long-lived box:

```bash
ssh vox-vps 'pm2 install pm2-logrotate'
```

### Monitoring worth having

- `GET /api/health` on an uptime checker.
- `email_accounts.imap_status` — `error` means the IMAP worker is in backoff.
- The `client_errors` table — crash dumps shipped from the glasses.
