# Even Realities integration

How VOX uses the G2 platform, which constraints are real, and the quirks
that cost us time. Written against `@evenrealities/even_hub_sdk` **0.0.14**.

Official documentation: [hub.evenrealities.com/docs](https://hub.evenrealities.com/docs).
This file records what we verified in practice, not a copy of theirs.

---

## Versions

| Thing | Version | Why |
|---|---|---|
| `@evenrealities/even_hub_sdk` | `0.0.14` | Current at time of writing |
| `min_sdk_version` in `app.json` | `0.0.13` | See below |
| `min_app_version` | `2.0.0` | Lowest phone app we support |
| Simulator | `0.9.0` | Injects real microphone audio; older versions did not |
| CLI | `0.1.14` | `evenhub pack` |

**Why `min_sdk_version` is lower than the SDK we build against.** 0.0.14's
page validators (`validateEvenHubPageContainer` and friends) are *client-side*
— they execute inside our own bundle and need nothing from the host app, so
using them costs no compatibility. The genuinely host-side additions in 0.0.14
(OS contextual menus, `textColor` brightness) are deliberately **not** used,
because adopting them would force `min_app_version` to 2.2.9 and cut off
testers on older phone apps. Declaring the lowest version we actually require
is the honest value.

---

## Hardware constraints that shape the design

| Constraint | Consequence |
|---|---|
| 576×288, 4-bit monochrome green | No colour, no imagery. Hierarchy comes from brightness and spacing. |
| See-through waveguide | Content is light projected over the world, not pixels on a panel. |
| One touch surface | The entire interaction model is scroll / tap / double-tap. |
| BLE link to the phone | Every render costs bandwidth. Prefer in-place text updates over page rebuilds. |
| No camera, no keyboard | No QR scanning on-device; nothing can be typed. Subjects are derived, not entered. |
| Max 12 containers per page | 4 image + 8 text/list, exactly one with `isEventCapture: 1`. |

---

## Event model

Events arrive in four envelopes — `sysEvent`, `textEvent`, `listEvent`,
`audioEvent` — and `hud/src/bridge.ts` normalises all of them into one
tagged union before any page sees them.

### Zero values are omitted on the wire

Protobuf drops zero-valued fields, so:

- `CLICK_EVENT` is `0` and arrives as `eventType: undefined`. Any
  `eventType === CLICK_EVENT` comparison silently never matches. Coalesce
  with `?? OsEventTypeList.CLICK_EVENT`.
- `currentSelectItemIndex` is omitted when it is `0`. Verified on the
  simulator: tapping row 0 sends `{containerID, containerName}` with no
  index; tapping after two scrolls sends `currentSelectItemIndex: 2`. So
  `?? 0` is the correct default, not a guess.
- `currentSelectItemName` was **never populated** in any event we observed.
  Do not route on it.

### Long press exists as of 0.0.14

`LONG_PRESS_EVENT` (9) and `LONG_PRESS_RELEASE_EVENT` (10) — two events, not
one, so hold-to-record is possible. They are **absent in 0.0.13**. An earlier
version of these notes claimed no long press existed, generalising from the
older enum; re-read `OsEventTypeList` after every SDK bump.

### The launch tap lands on your first page

The temple touch that launches an app is delivered to whatever page mounts
first. Before VOX guarded against this, that tap landed on the home screen's
capture surface and immediately opened the microphone — indistinguishable
from an automatic redirect, and reported as one. `hud/src/router.ts` now
drops tap / list-select / scroll for 700 ms after every mount. Lifecycle
events and audio frames are never suppressed: dropping those would leak the
microphone or defeat the exit gate.

---

## Rendering rules

### Container shape must stay stable

`rebuildPageContainer` **silently fails** when a rebuild re-introduces a
container ID that a previous, smaller rebuild dropped. It resolves, returns
`false`, throws nothing, and the screen simply does not update.

`hud/src/render.ts` pads every chrome page to the same maximal six-container
shape (text 2, 3, 4 + list 5 + header 90 + footer 99), parking unused
containers off-screen at `y: 290`. Nothing is ever dropped, so nothing is
ever re-introduced.

### List rows draw at a ~40 px pitch

Measured from rendered baselines (y = 99, 140, 181, 219). A list container
too short for its items does **not** clip visibly and does **not** scroll —
the surplus rows are never drawn at all. It renders a short, tidy, entirely
plausible menu that is missing an item.

This shipped as a bug: a three-row action list sized at 78 px on a 32 px
assumption rendered two rows, and the missing one was the only way to change
message style. Always size with `listHeightFor(rows)`.

Text containers need ≥ 26 px per rendered line, same failure mode.

### Other firmware limits

- List items are capped near **32 characters** in practice, though the docs
  say 64. Longer items make the whole rebuild return `false`.
- Max 20 items per list.
- Lists cannot be updated in place — changing items means a full rebuild.

### Font coverage

Verified safe: ASCII, single-line box drawing `─│┌┐└┘├┤┬┴┼`, `→ ↑ ↓`,
`● ○ ◐ ◇ ▶ ◀`, blocks `▁▂▃▄▅▆▇█`, `·`, and the card suits `♠♥♦♣`.

Missing, confirmed by `glyph dsc. not found` in the simulator log: `▸`
(U+25B8) and other geometric arrows, double-line box drawing `╔═╗`, and all
emoji.

Because model rewrites routinely return curly quotes, em-dashes and emoji,
`hud/src/text.ts#sanitizeForGlasses` maps them to ASCII before display —
applied inside `draft.getBodyText()` so the review screen and the outbound
message are byte-identical. Showing one string and sending another would be
worse than losing a curly quote.

---

## Application lifecycle

| Event | VOX behaviour |
|---|---|
| `FOREGROUND_ENTER` | Home screen re-mounts and refreshes counts |
| `FOREGROUND_EXIT` | **Microphone closed globally**, before page routing |
| `SYSTEM_EXIT` / `ABNORMAL_EXIT` | Unsubscribe the global handler |
| Root double-tap | `shutDownPageContainer(1)` — required by Even Hub review |

The exit gate is intercepted in `hud/src/main.ts` before the router sees the
event, so it fires from every screen regardless of what is mounted.

Closing the microphone on `FOREGROUND_EXIT` is a battery decision: a
backgrounded app holding the mic open drains the glasses.

---

## Microphone

`audioControl(true, AudioInputSource.Glasses)` — **name the source
explicitly.** The argument is optional, and omitting it leaves the
glasses-vs-phone choice to the host default. If that default is ever the
phone, the wearer speaks into the temple and the app captures silence.

Audio arrives as `audioEvent.audioPcm` frames, 16 kHz mono 16-bit LE. Note
the SDK does **not** document the sample rate anywhere — 16 kHz is our
working assumption, confirmed by Whisper producing correct transcriptions.

VOX accumulates frames in `hud/src/audio.ts`, computes RMS per frame for the
live trace, and posts the concatenated buffer. The server WAV-wraps it before
sending to Whisper.

---

## Distribution

There is no CLI install path. The only route onto hardware is:

1. `bash hud/pack.sh` → `hud/vox.ehpk`
2. Upload at [hub.evenrealities.com](https://hub.evenrealities.com)
3. **Switch the build to the Beta track.** Uploads default to Private, and a
   Private build reports "test version expired" to invited testers with no
   indication that the track is why. This has caught us every single cycle.
4. Install from the Even Realities phone app → Even Hub

`pack.sh` substitutes `VOX_DOMAIN` into `app.json`'s network permission
whitelist at build time, so the live domain stays out of git. The whitelist
is enforced by the phone app on device and **bypassed in the simulator** —
a network call that works in the simulator can still be blocked on hardware.

---

## Permissions

| Permission | Declared reason |
|---|---|
| `g2-microphone` | Capture audio from the glasses mic for voice-driven messaging |
| `network` | Reach the VOX server; whitelist contains exactly one origin |

---

## Capabilities available but not adopted

Tracked as O-001…O-005 in [ISSUES.md](../ISSUES.md).

| Capability | Status |
|---|---|
| `LONG_PRESS_EVENT` (0.0.14) | Not used. Would enable hold-to-talk — no manifest change needed. |
| OS contextual menus (0.0.14) | Not used. Needs firmware + app 2.2.9, so `min_app_version` would have to rise. |
| `textColor` 0–4 (0.0.14) | Not used. Would give real hierarchy; note the range is 0–4, not the 0–15 our palette assumes. |
| `zOrderIndex` | Not used. Overlays without a rebuild. All-or-none, unique per page. |
| `ImageContainerProperty` | Not used. Byte format for 4-bit green is undocumented (I-009). |
