# minimal

Bare Even Hub G2 starter. Vite + TypeScript + SDK + CLI + simulator, one text container that renders `Hello from G2!`.

## Run

```bash
npm install
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Pack for distribution

```bash
npm run pack
```

Produces an `.ehpk` file.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | WebView host. Viewport meta tag locks zoom; CSS kills iOS double-tap zoom + rubber-band scroll. |
| `src/main.ts` | Creates a single full-canvas text container at app startup. |
| `app.json` | Even Hub manifest. No permissions by default. |
| `tsconfig.json` | Standard Vite vanilla-ts config. |
| `vite.config.ts` | Dev server on port 5173, host binding for LAN QR access. |

## Next steps

- Add containers, input handling, lifecycle events — see the `everything-evenhub` skill suite.
- Pick another template if you need microphone/STT (`asr`), image display (`image`), or long-form reading (`text-heavy`).

## Simulator automation API

When launched with `--automation-port 9898`, the sim exposes:

| Endpoint | Notes |
|---|---|
| `GET  /api/ping` | health probe, returns `pong` |
| `GET  /api/screenshot/glasses` | PNG of the current HUD framebuffer |
| `GET  /api/screenshot/webview` | PNG of the inner webview (debug) |
| `GET  /api/console?since_id=N` | JSON array of buffered console entries |
| `POST /api/input` | body `{"action": "up" \| "down" \| "click" \| "double_click"}` |

There is no scroll-to-index or list-select-by-index — to reach the Nth list item, send `down` N times then `click`. There is no reload, exit, or shutdown endpoint either — kill the sim process to restart.

For driven flow tests, fetch the server's `/api/idle-suggestions` first so you know the target index *before* scrolling.
