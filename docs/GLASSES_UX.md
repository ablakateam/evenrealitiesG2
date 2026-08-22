# The glasses interface

Every screen, every interaction, in text. No screenshots required.

---

## The interaction model

The G2 has one touch surface on the temple. Three gestures:

| Gesture | Effect |
|---|---|
| **Scroll** — slide along the temple | Move the highlight up or down a list |
| **Tap** | Activate the highlighted row |
| **Double tap** | Go back to home — or, *on* home, leave VOX |

Every screen states its available actions along the bottom edge, so nothing
has to be memorised.

Input is ignored for **700 ms after any screen appears.** This is
deliberate: the tap that launches the app is delivered to the first page
that mounts, and without the guard it activated whatever happened to be
highlighted.

---

## Launch

Cold start renders a first-run card once:

```
                    welcome to VOX
┌──────────────────────────────────────────┐
│   Hi. I help you message                 │
│   without taking out your phone.         │
│                                          │
│   Scroll the menu, tap to pick.          │
│   Start with "Speak a message":          │
│     "text dan running late"              │
└──────────────────────────────────────────┘
 tap to open the menu
```

Dismissed with a tap, and never shown again — the flag persists in the SDK
key-value store, which survives app restarts (browser `localStorage` does
not).

If the app has no server configured, every launch shows:

```
   VOX runs on a server you host,
   so this app ships with no
   credentials of its own.

   On your phone: open VOX and
   paste your pairing link.
```

---

## Home

```
 VOX    TWL *  MAIL *  BAT 100%    4:41 PM      ← status bar
              ( ( ● ) )                          ← breathing signal
┌──────────────────────────────────────────┐
│ Speak a message                          │
│ Inbox                     3 new          │
│ Voice command                            │
│ Style: Casual                            │
└──────────────────────────────────────────┘
 SMS to Alex - 2m ago  ·  2x to exit
```

**Status bar.** `TWL` and `MAIL` show `*` when configured, `o` when not.
`BAT` is read from the device. All of it comes from a single
`/api/idle-suggestions` call — one round trip for the whole screen, because
cold start over BLE has a latency budget.

**The signal** is concentric rings pulsing outward from a core, on a 420 ms
loop. It means "awake and connected". Every frame is the same character
width so the core never appears to slide.

**Footer** shows the last outbound message and always states that a double
tap exits — this is the one screen where that leaves the app.

---

## Speaking a message

```
                 listening
              -  --
          --    -  -   --
        --  ....  -  --
       .          --
                  0:03
 tap to stop  ·  2x to cancel
```

The microphone opens on entry, explicitly on the **glasses** input source.
The trace is a four-row oscilloscope: one dash per column plotted at that
moment's amplitude, smoothed so it flows rather than strobes. Amplitude uses
a square-root curve, so ordinary speech occupies the middle of the range
rather than hugging the baseline.

Recording ends when you tap, when you stop talking for a few seconds, or at
the maximum length. Both timings come from your saved preferences.

```
                one sec...
             reading your voice
```

Audio goes to the server, which transcribes it, works out the recipient and
channel, and generates seven rewrites — all in a single round trip.

**If the microphone captured nothing**, VOX says so:

```
                    hmm
            couldn't catch that.
           I didn't hear anything.
 tap to retry  ·  2x to cancel
```

It does not invent a message. Speech models produce confident, plausible
text from silence — often in the wrong language — so the server refuses
below an amplitude floor rather than passing a hallucination on to you.

---

## Reviewing before sending

```
      Alex Chen  ·  SMS  ·  +15555550142
 Hey, just a heads up, I'm running
 like 10 mins late. Sorry about that!

┌──────────────────────────────────────────┐
│ ──── SEND ────                           │
│ Style: Casual                 >          │
└──────────────────────────────────────────┘
 tap SEND  ·  scroll for style  ·  2x cancel
```

One header line answers the three things you must verify: **who**, **how**,
and **the actual address**. The body shows up to three wrapped lines.

The action list is exactly two rows, and both always render — the height is
derived from the row count rather than hand-picked, because a list too short
for its items silently omits the surplus rather than scrolling.

**If VOX could not tell who you meant** it asks rather than guessing:

```
             pick a recipient
┌──────────────────────────────────────────┐
│ pick recipient                           │
│ cancel                                   │
└──────────────────────────────────────────┘
 no recipient — pick one
```

Choosing it lists your contacts with what each can receive — `both`,
`phone`, or `email`.

---

## Changing the message style

Scroll to the Style row and tap:

```
        message style  ·  now: Casual
┌──────────────────────────────────────────┐
│ ──── back ────                           │
│ > Casual                                 │
│   Professional                           │
│   Friendly                               │
└──────────────────────────────────────────┘
 scroll to browse  ·  tap to apply
```

Seven styles, the active one marked `>`:

| Style | What it does |
|---|---|
| Casual | Relaxed, contractions |
| Professional | Clear, businesslike |
| Friendly | Warm, a little extra |
| Formal | Full sentences, no contractions |
| Sarcastic | Light and playful |
| Grammar | Your words, cleaned up |
| Original | Your words, untouched |

All seven were generated while you were reading the first one, so applying
one is instant and costs no round trip. If the recipient has both a phone
number and an email address, this menu also offers to switch channel.

Only styles that actually returned usable text are listed — a rewrite that
failed is not offered.

---

## Sending

```
                sending...
              Off to Alex Chen
              +15555550142
 one moment...
```

Then:

```
                    ->
            Off to Alex Chen.
                SMS - sent
 tap for another  ·  2x to head home
```

The glyph reflects the channel: `->` SMS, `>>>` email, `-->` both. The
screen stays for 30 seconds, then returns home on its own; tapping starts
another message.

Every send carries a client-generated UUID as an idempotency key, so a retry
after a stalled request returns the original result instead of sending twice.

Failures are explicit rather than silent:

```
                    Hmm.
              Couldn't send.
       That contact has no phone —
       pick a different channel.
```

---

## Inbox

```
           inbox  ·  3 unread
┌──────────────────────────────────────────┐
│ alex@example.com          2h  *          │
│ +15555550142             14h             │
│ team@newsletter.example   1d  *          │
└──────────────────────────────────────────┘
 tap to open  ·  2x for home
```

`*` marks unread. Times are relative. The full sender address is shown
rather than just a name — a bare "support" is useless; `support@vendor.com`
is not.

Opening one:

```
        SMS  +15555550142
┌──────────────────────────────────────────┐
│ ──── reply ────                          │
│ Are we still on for 3pm?                 │
│                                          │
└──────────────────────────────────────────┘
 tap reply  ·  scroll to read  ·  2x for home
```

Reply is the **first** row, not a trailing one — it is the only action here,
and you should not have to scroll a long message to find it. Tapping it
starts a message with the recipient and channel already locked to the
sender, so you only have to speak.

The item is marked read in the background on open.

---

## Voice command

Say what you want instead of navigating:

| You say | What happens |
|---|---|
| "send Alex I'm running late" | Runs the full compose flow |
| "open inbox" / "go home" | Navigates |
| "save 415 555 0142 as Mom" | Creates the contact |
| "cancel" / "never mind" | Returns home |

Search and settings are recognised but direct you to the phone dashboard —
neither is implemented on the glasses.

---

## Default style

Home → `Style: …`:

```
              message style
┌──────────────────────────────────────────┐
│   Casual       relaxed                   │
│ > Professional businesslike              │
│   Friendly     warm                      │
│   Formal       no contractions           │
└──────────────────────────────────────────┘
 tap to set  ·  2x to go back
```

This sets the style **new messages start in**, saved to your server. Change
it here and the phone dashboard shows the same value; change it there and
the glasses pick it up. Per-message overrides happen on the review screen
and do not change this default.

---

## Error and connectivity states

| Situation | What you see |
|---|---|
| No credential yet | The *not paired yet* card. A tap re-checks storage and, once the phone has paired, continues to the home screen. |
| Server unreachable | Status bar shows `TWL o  MAIL o`; the failing screen states the error |
| Microphone captured nothing | "I didn't hear anything." — retry on tap |
| Speech not parseable as a message | "Couldn't read that as a message" with what was heard |
| No recipient identified | Recipient picker, rather than a guess |
| Send failed | The provider's reason, plus a way back |
| Rate limited | "Take a breath — you're going fast. Try again in N min." |

Every error screen offers a way forward. Nothing dead-ends; a double tap
always returns home, and home always exits.

Uncaught client errors are reported to `/api/telemetry/error` on a
best-effort basis and stored in `client_errors` for later review. That
reporting never blocks or interrupts what you were doing.
