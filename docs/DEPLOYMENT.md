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
# VOX_DOMAIN=vox.example.com
# VITE_VOX_SERVER=https://vox.example.com
# VITE_VOX_SECRET=<the bootstrap secret, or a rotated one>
bash pack.sh            # → hud/vox.ehpk
```

Upload `vox.ehpk` at [hub.evenrealities.com](https://hub.evenrealities.com),
then **switch the build to the Beta track**. Uploads default to Private, and
a Private build reports "test version expired" to invited testers with no
indication that the track is the cause.

Install from the Even Realities phone app → Even Hub → VOX.

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
