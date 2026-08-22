# Contributing

## Getting set up

Node 20+ required — `better-sqlite3` and `argon2` compile native modules
against it.

```bash
git clone https://github.com/ablakateam/evenrealitiesG2.git vox && cd vox
git config core.hooksPath .githooks     # enable the PII guard — do this first

for d in server web hud; do (cd $d && npm ci); done
```

You need a running VOX server to develop against. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
covers standing one up; a local one works for everything except Twilio
webhooks, which need a public URL.

## The development loop

```bash
cd server && npm run dev     # API on :3000
cd web    && npm run dev     # dashboard on :5173
cd hud    && npm run dev     # glasses bundle on :5173
```

### Glasses work happens in the simulator

Hardware round trips are expensive — installs go through the Even Hub
portal — so every UI change is walked in the simulator first.

```bash
npx @evenrealities/evenhub-simulator --automation-port 9898 http://localhost:5173

curl -s localhost:9898/api/screenshot/glasses > shot.png
curl -XPOST localhost:9898/api/input -H 'content-type: application/json' -d '{"action":"click"}'
curl -s 'localhost:9898/api/console?since_id=0'
```

Actions are exactly `click`, `double_click`, `up`, `down`. There is no
select-by-index — to reach the fifth row, send `down` four times, then
`click`.

The voice flow cannot be driven normally: the simulator streams near-silent
audio, which the server's silence guard correctly rejects. Load the dev
build with `?demo=1` to force a scripted transcription. That flag is behind
`import.meta.env.DEV` and cannot ship.

### Dashboard work

Set `VITE_API_BASE` in `web/.env` to a deployed server. Verify mobile
changes by **measuring**, not by eye — font size, hit area, accessible name
and keyboard geometry are all invisible in a screenshot. Playwright works
well for this:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth  // overflow
[...document.querySelectorAll('button,a')].filter(e => e.getBoundingClientRect().height < 44)
[...document.querySelectorAll('input')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 16)
```

## Before you open a PR

```bash
cd server && npx tsc --noEmit && npx vitest run && npm audit --omit=dev
cd ../web && npx tsc --noEmit && npm run build
cd ../hud && npx tsc --noEmit && npm run build
```

All three must typecheck, the server suite must be green (103 tests), and
production audits must be clean.

## Conventions

**Commits:** `type(scope): summary`, e.g. `fix(P19-prep): …`. The body
should explain *why*, and name the failure mode if you fixed a bug — the
history is the main record of how this system's constraints were learned.

**Never `--no-verify`.** The pre-commit hook blocks credentials and PII. If
it fires, fix the source; do not bypass it. It has caught real leaks.

**Documentation lives with the change.** If you alter behaviour that
[docs/](docs/) describes, update it in the same commit. Do not document
functionality that does not exist.

**Record surprises.** Platform quirks belong in
[docs/EVEN_REALITIES.md](docs/EVEN_REALITIES.md), with the symptom, the
cause and the fix. This platform fails in ways that are not obvious from its
documentation, and re-learning them is expensive — a one-line note costs
minutes, rediscovering it costs days.

## Things worth knowing before touching the glasses code

Full detail in [docs/EVEN_REALITIES.md](docs/EVEN_REALITIES.md). The three
that cause the most damage:

1. **Never hand-pick a list container height.** Rows draw at a ~40 px pitch;
   a list too short for its items silently omits the surplus rather than
   scrolling. Use `listHeightFor(rows)`.
2. **Keep container shape stable within a flow.** `rebuildPageContainer`
   silently fails when a rebuild re-introduces an ID a smaller rebuild
   dropped. `render.ts` pads chrome pages to a fixed six-container shape;
   respect it.
3. **"Done" means reachable.** Two completed features sat unreachable for
   months after a navigation redesign. After changing any navigation
   surface, check what used to point out of it — anything not transitively
   reachable from `IdlePage` is either dead code or a missing entry point.

## Testing

Server tests use Vitest + supertest against a real temporary SQLite
database, with providers mocked at the HTTP boundary. Add tests for anything
touching auth, idempotency or encryption — those are the paths where a
regression is expensive and silent.

There are no automated tests for the glasses UI; it is verified in the
simulator by screenshot and by measurement.
