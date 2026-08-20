import { AudioInputSource } from '@evenrealities/even_hub_sdk';
import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, updateText } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { AudioRecorder, formatElapsed } from '../audio.js';
import {
  apiPost,
  apiPostAudio,
  hudApi,
  HudApiError,
  type ComposeResult,
  type SttResult,
  type VoiceCommandResult,
  type VoiceAction,
} from '../api.js';
import { setDraftFromCompose } from '../draft.js';
import { getPrefs } from '../prefs.js';
import { ConfirmPage } from './confirm.js';
import { ComposePage } from './compose.js';
import { InboxPage } from './inbox.js';
import { IdlePage } from './idle.js';
import { makeStubPage } from './stub.js';

/**
 * Voice page — the universal-voice entry point.
 *
 * Records → STT → /api/voice-command classifier → dispatches to:
 *   - compose       → re-run /api/compose with the transcription, push Confirm
 *   - reply         → P16 stub (resolve by to_name TBD)
 *   - navigate      → router.go(target page)
 *   - search        → P16 stub
 *   - save_contact  → POST /api/contacts, render result
 *   - settings      → P16 stub
 *   - cancel        → go to Idle
 *   - unknown       → "didn't catch that" with re-record action
 *
 * Layout: same 3-container shape as the rest of the app. Recording state
 * is rendered as a list (greeting, blank, timer) so we don't break the
 * shape-invariant from P13/§LESSONSLEARNED.
 */

const TITLE_ID = 2;
const METER_ID = 3;

const TICK_MS = 250;
const SIM_FALLBACK_UTTERANCE = 'open inbox';

type State = 'recording' | 'thinking' | 'done' | 'error';

let state: State = 'recording';
let recorder = new AudioRecorder();
let tick: ReturnType<typeof setInterval> | null = null;
let errorMsg = '';
let lastTimerLabel = '';

export const VoicePage: Page = {
  id: 'voice',

  async mount(ctx: PageContext): Promise<void> {
    // Retries call mount() directly without an intervening unmount,
    // so clear any prior tick before scheduling a new one.
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    state = 'recording';
    recorder = new AudioRecorder();
    recorder.start();
    errorMsg = '';
    lastTimerLabel = formatElapsed(0);

    await render(ctx);

    try {
      await ctx.bridge.audioControl(true, AudioInputSource.Glasses);
    } catch (err) {
      console.warn('[voice] audioControl(true) failed:', err);
    }

    const maxSecs = Math.min(30, getPrefs().max_recording_seconds);
    const silenceSecs = getPrefs().silence_autostop_seconds;
    tick = setInterval(() => {
      if (state !== 'recording') return;
      // Live-patch the meter container every tick — flicker-free since it's
      // a textContainerUpgrade, not a full rebuild.
      void updateText(ctx.bridge, METER_ID, meterContent());
      const label = formatElapsed(recorder.elapsedSeconds);
      if (label !== lastTimerLabel) {
        lastTimerLabel = label;
      }
      if (recorder.elapsedSeconds >= maxSecs) {
        void stopAndDispatch(ctx);
      } else if (silenceSecs > 0 && !recorder.isEmpty && recorder.silenceSeconds >= silenceSecs) {
        void stopAndDispatch(ctx);
      }
    }, TICK_MS);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'audio') {
      recorder.addChunk(event.pcm);
      return;
    }
    if (event.kind === 'tap' || event.kind === 'list-select') {
      if (state === 'recording') {
        await stopAndDispatch(ctx);
      } else if (state === 'error') {
        await VoicePage.mount(ctx); // retry
      }
    }
  },

  unmount(): void {
    if (tick) clearInterval(tick);
    tick = null;
  },
};

function meterContent(): string {
  // Centre within the ~100-"char" body line (matches center() in render.ts —
  // leading-space units, not visible characters). The trace is multi-line
  // now, so EVERY row needs the indent; padding only the string once left
  // the first row centred and the rest hugging the left edge.
  const CHAR_WIDTH = 100;
  const pad = (line: string): string =>
    ' '.repeat(Math.max(0, Math.floor((CHAR_WIDTH - line.length) / 2))) + line;
  const trace = recorder.meter().split('\n').map(pad).join('\n');
  const timer = formatElapsed(recorder.elapsedSeconds);
  return `${trace}\n${pad(timer)}`;
}


async function render(ctx: PageContext): Promise<void> {
  let title: string;
  let body: string;
  let hint: string;
  if (state === 'recording') {
    title = 'listening';
    body = meterContent();
    hint = 'tap to stop';
  } else if (state === 'thinking') {
    title = 'thinking';
    body = '\n\n        one sec...';
    hint = '';
  } else if (state === 'done') {
    title = 'got it';
    body = '\n\n        ok';
    hint = '';
  } else {
    title = 'hmm';
    body = `\n   didn't quite catch that.\n   ${errorMsg ? errorMsg.slice(0, 60) : ''}`;
    hint = 'tap to retry';
  }
  await showPage(ctx.bridge, {
    texts: [
      {
        id: TITLE_ID,
        x: 0,
        y: BODY_TOP,
        w: 576,
        h: 48,
        border: 0,
        padding: 4,
        capture: false,
        content: `        ${title}`,
      },
      {
        id: METER_ID,
        x: 0,
        y: BODY_TOP + 56,
        w: 576,
        h: BODY_BOTTOM - (BODY_TOP + 56),
        border: 0,
        padding: 8,
        capture: true,
        content: body,
      },
    ],
    chrome: { hint },
  });
}

async function stopAndDispatch(ctx: PageContext): Promise<void> {
  if (state !== 'recording') return;
  state = 'thinking';
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  try {
    await ctx.bridge.audioControl(false);
  } catch (err) {
    console.warn('[voice] audioControl(false) failed:', err);
  }
  await render(ctx);

  try {
    const transcription = await getTranscription();
    const cmd = await hudApi<VoiceCommandResult>('/api/voice-command', {
      method: 'POST',
      body: { transcription },
    });
    await dispatch(ctx, cmd.action, transcription);
  } catch (err) {
    state = 'error';
    errorMsg =
      err instanceof HudApiError ? err.message : err instanceof Error ? err.message : 'classifier failed';
    await render(ctx);
  }
}

async function getTranscription(): Promise<string> {
  if (recorder.isEmpty) {
    // Packed builds must not invent an utterance — see the matching note in
    // compose.ts. A fabricated command is worse than an honest error.
    if (!import.meta.env.DEV) throw new Error('no audio from the mic');
    console.warn('[voice] no audio captured — DEV fallback utterance');
    return SIM_FALLBACK_UTTERANCE;
  }
  const stt = await apiPostAudio<SttResult>('/api/stt', recorder.toBuffer(), { is_raw_pcm: 'true' });
  return stt.text;
}

async function dispatch(ctx: PageContext, action: VoiceAction, transcription: string): Promise<void> {
  switch (action.kind) {
    case 'compose': {
      // Re-run /api/compose with the same transcription to get intent +
      // variants, then route through the existing confirm flow.
      const result = await hudApi<ComposeResult>('/api/compose', {
        method: 'POST',
        body: { transcription },
      });
      const draft = setDraftFromCompose(result);
      if (!draft) {
        await ctx.router.go(makeStubPage('voice-err', 'Hmm.', "Couldn't read that as a message."));
        return;
      }
      await ctx.router.go(ConfirmPage);
      return;
    }
    case 'navigate': {
      const page = pageFor(action.params.target);
      if (page) await ctx.router.go(page);
      else await ctx.router.go(makeStubPage('voice-nav', 'On the phone.', `'${action.params.target}' lives on the phone dashboard.`));
      return;
    }
    case 'cancel':
      await ctx.router.go(IdlePage);
      return;
    case 'save_contact': {
      const { name, phone, email } = action.params;
      if (!name || (!phone && !email)) {
        await ctx.router.go(
          makeStubPage('voice-contact-err', 'Hmm.', 'Need a name plus a phone or email.'),
        );
        return;
      }
      try {
        await apiPost('/api/contacts', { name, phone_e164: phone ?? null, email: email ?? null });
        await ctx.router.go(
          makeStubPage(
            'voice-contact-ok',
            'Saved.',
            `${name}\n${phone ?? ''}${email ? `\n${email}` : ''}\n[X2] back`,
          ),
        );
      } catch (err) {
        const msg = err instanceof HudApiError ? err.message : 'save failed';
        await ctx.router.go(makeStubPage('voice-contact-err', 'Hmm.', msg));
      }
      return;
    }
    case 'reply':
      await ctx.router.go(
        makeStubPage(
          'voice-reply-stub',
          'Not yet.',
          `Open Inbox and tap reply.\nHeard: ${action.params.to_name ?? 'no name'}`,
        ),
      );
      return;
    case 'search':
      await ctx.router.go(
        makeStubPage(
          'voice-search-stub',
          'Not yet.',
          `Search isn't on the glasses yet.\nQuery: ${action.params.query}`,
        ),
      );
      return;
    case 'settings':
      await ctx.router.go(
        makeStubPage(
          'voice-settings-stub',
          'On the phone.',
          `Change this on the phone dashboard.\n${action.params.key} = ${action.params.value}`,
        ),
      );
      return;
    case 'unknown':
    default:
      state = 'error';
      errorMsg = action.params.reason ?? 'unknown command';
      await render(ctx);
      return;
  }
}

function pageFor(target: string): Page | null {
  switch (target) {
    case 'idle':
      return IdlePage;
    case 'inbox':
      return InboxPage;
    case 'compose':
      return ComposePage;
    case 'contacts':
    case 'history':
    case 'templates':
      return null; // dedicated pages ship after the hardware test
    default:
      return null;
  }
}
