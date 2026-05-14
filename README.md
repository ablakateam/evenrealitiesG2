# VOX — Voice-First Messaging for the Even Realities G2

VOX is a voice-first SMS + email companion for the Even Realities G2 smart glasses. Tap, speak, glance, send — without taking out your phone.

Currently in **P0 — Documentation & Setup** of a ~20-phase build.

---

## What it does

- **Voice-driven SMS** via Twilio API (tap → speak → confirm → sent in ~6s)
- **Voice-driven email** via your own Gmail / Outlook / iCloud / custom SMTP account — sends land in your real Sent folder
- **Real-time inbound** — incoming SMS (Twilio webhook) and email (IMAP IDLE) surface on the HUD with a banner
- **Tone rewrites** — Casual / Professional / Friendly / Formal / Sarcastic / Grammar-fix / Original, all pre-computed in parallel
- **Voice anywhere** — voice is a peer input on every screen (navigate, correct, save contact, search, change settings)
- **Smart Idle** — context-aware suggestions ("haven't texted Mom in 2 days", "Alex replied 3m ago")
- **Pluggable LLM** — Anthropic Claude / OpenAI / OpenRouter / Ollama Cloud

---

## Repository structure (forming)

```
/
├── README.md           ← you are here
├── RFP.md              ← project brief (the contract we're building to)
├── PHASES.md           ← implementation roadmap (P0–P20)
├── PROGRESS.md         ← live status tracker
├── ISSUES.md           ← issues, risks, decisions log
├── LESSONSLEARNED.md   ← per-phase retrospectives
├── hud/                ← G2 HUD web app (to be scaffolded in P11)
├── web/                ← phone companion dashboard (to be scaffolded in P8)
├── server/             ← Vultr-hosted Node API (to be scaffolded in P2)
└── .gitignore
```

---

## Quick start (for future contributors)

1. **Read RFP.md first** — understand what we're building and the success criteria
2. **Read PHASES.md** — see where we are in the roadmap
3. **Read PROGRESS.md** — see what's happening this week
4. **Skim ISSUES.md** — know the open risks and decisions
5. The full architectural detail (page mockups, prompts, BLE constraints) lives in the plan file:
   `<plan-file (local, not in repo)>`

---

## Architecture in one paragraph

The HUD is a Vite-built web app running inside the Even Realities phone-app WebView. It talks to a Node/Express server on a Vultr VPS via authenticated HTTPS. The server holds all third-party API keys and credentials (encrypted at rest with libsodium), brokers calls to Twilio · OpenAI Whisper · the user's chosen LLM · the user's own SMTP server · the user's own IMAP mailbox (via persistent IDLE workers). The same web app, opened in a regular phone browser, renders a SaaS-style dashboard for setup and admin. State lives in SQLite. Glasses pair via a shared-secret QR code.

---

## License

TBD. (To be decided in P0 — likely MIT.)

---

## Stack at a glance

**HUD + Dashboard**: TypeScript · Vite · React (dashboard) · Tailwind · shadcn/ui · `@evenrealities/even_hub_sdk`

**Server**: Node 20+ · Express · TypeScript · better-sqlite3 · nodemailer · imapflow · twilio · openai · @anthropic-ai/sdk · googleapis · libsodium

**Infra**: Vultr VPS · Nginx · Let's Encrypt · pm2

---

## Status

See [PROGRESS.md](./PROGRESS.md) for the live status. As of this commit: **P0 in flight — documentation foundation being laid.**
