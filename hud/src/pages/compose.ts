import { AudioInputSource } from '@evenrealities/even_hub_sdk';
import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, updateText, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { AudioRecorder, formatElapsed } from '../audio.js';
import { hudApi, apiPostAudio, HudApiError, type ComposeResult } from '../api.js';
import { setDraftFromCompose } from '../draft.js';
import { getPrefs } from '../prefs.js';
import { ConfirmPage } from './confirm.js';
import { makeStubPage } from './stub.js';

/**
 * Compose — capture voice, transcribe + parse + rewrite via /api/compose,
 * hand off to the Confirm screen.
 *
 * State machine:
 *   recording    — mic open, live RMS meter + timer, tap stops
 *   transcribing — POST in flight, "one sec" copy
 *   error        — failed; tap to retry
 *
 * Layout matches the Voice page (title + capture-surface body + chrome
 * footer hint). The meter is patched in place via textContainerUpgrade at
 * 4 Hz — flicker-free.
 *
 * Headless-simulator note: the sim has no mic; if `recorder.isEmpty` when
 * we stop, we fall back to the JSON path of /api/compose with a stock
 * transcription so the rest of the flow remains exercisable.
 */

const TITLE_ID = 2;
const METER_ID = 3;

const TICK_MS = 250;

const SIM_FALLBACK_TRANSCRIPTION =
  'send a text to alex saying running about ten minutes late, sorry';

type State = 'recording' | 'transcribing' | 'error';

let state: State = 'recording';
let recorder = new AudioRecorder();
let tick: ReturnType<typeof setInterval> | null = null;
let errorMsg = '';

export const ComposePage: Page = {
  id: 'compose',

  async mount(ctx: PageContext): Promise<void> {
    // Retry path calls mount() without an intervening unmount.
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    state = 'recording';
    recorder = new AudioRecorder();
    recorder.start();
    errorMsg = '';

    await render(ctx);

    try {
      // Name the input explicitly. The source argument is optional and we
      // used to omit it, which left the choice of glasses-vs-phone mic to
      // the host's default — if that default is ever the phone, the wearer
      // speaks into the temple and we capture silence, then quietly fall
      // back to a canned transcription (see transcribe()). Being explicit
      // removes a whole class of "it heard nothing" hardware reports.
      await ctx.bridge.audioControl(true, AudioInputSource.Glasses);
    } catch (err) {
      console.warn('[compose] audioControl(true) failed:', err);
    }

    const { max_recording_seconds: maxSecs, silence_autostop_seconds: silenceSecs } = getPrefs();
    tick = setInterval(() => {
      if (state !== 'recording') return;
      // Live meter patch — only updates the meter container.
      void updateText(ctx.bridge, METER_ID, meterContent());
      if (recorder.elapsedSeconds >= maxSecs) {
        void stopAndTranscribe(ctx);
      } else if (silenceSecs > 0 && !recorder.isEmpty && recorder.silenceSeconds >= silenceSecs) {
        void stopAndTranscribe(ctx);
      }
    }, TICK_MS);
  },

  async onEvent(event: NormalizedEvent, ctx: PageContext): Promise<void> {
    if (event.kind === 'audio') {
      recorder.addChunk(event.pcm);
      return;
    }
    // The capture container on this page is a text box, so a tap arrives as
    // 'tap'; keep 'list-select' too because the chrome pad adds a list and
    // some firmware builds attribute the touch to it.
    if (event.kind === 'tap' || event.kind === 'list-select') {
      if (state === 'recording') {
        await stopAndTranscribe(ctx);
      } else if (state === 'error') {
        await ComposePage.mount(ctx); // retry
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
    hint = 'tap to stop   ·   2x to cancel';
  } else if (state === 'transcribing') {
    title = 'one sec...';
    body = center('\n\nreading your voice');
    hint = '';
  } else {
    title = 'hmm';
    body = center(`\ncouldn't catch that.\n${errorMsg ? errorMsg.slice(0, 60) : ''}`);
    hint = 'tap to retry   ·   2x to cancel';
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
        content: center(title),
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

async function stopAndTranscribe(ctx: PageContext): Promise<void> {
  if (state !== 'recording') return;
  state = 'transcribing';
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  try {
    await ctx.bridge.audioControl(false);
  } catch (err) {
    console.warn('[compose] audioControl(false) failed:', err);
  }
  await render(ctx);

  try {
    const result = await transcribe();
    const draft = setDraftFromCompose(result);
    if (!draft) {
      await ctx.router.push(
        makeStubPage(
          'compose-empty',
          'Hmm.',
          `Couldn't read that as a message.\n"${result.transcription.slice(0, 80)}"`,
        ),
      );
      return;
    }
    await ctx.router.push(ConfirmPage);
  } catch (err) {
    console.error('[compose] transcribe failed:', err);
    state = 'error';
    errorMsg =
      err instanceof HudApiError
        ? err.code === 'silent_audio'
          ? "I didn't hear anything."
          : err.message
        : err instanceof Error
          ? err.message
          : 'transcription failed';
    await render(ctx);
  }
}

/** Under ~125 ms of 16 kHz mono 16-bit PCM — nothing Whisper can use. */
const MIN_PCM_BYTES = 2048;

async function transcribe(): Promise<ComposeResult> {
  if (recorder.isEmpty || recorder.byteLength < MIN_PCM_BYTES) {
    // In a PACKED build this must be a hard error. The stock transcription
    // below composes a complete, plausible message ("running about ten
    // minutes late") addressed to a real contact — if the glasses mic ever
    // returns nothing on hardware, the silent fallback would walk the wearer
    // into confirming and sending words they never said. Dev builds keep it
    // so the simulator can still exercise the flow end to end.
    if (!import.meta.env.DEV) {
      throw new Error(
        recorder.isEmpty ? 'no audio from the mic' : 'that was too short to hear',
      );
    }
    console.warn(`[compose] only ${recorder.byteLength}B captured — DEV fallback transcription`);
    return hudApi<ComposeResult>('/api/compose', {
      method: 'POST',
      body: { transcription: SIM_FALLBACK_TRANSCRIPTION },
    });
  }
  return apiPostAudio<ComposeResult>('/api/compose', recorder.toBuffer(), { is_raw_pcm: 'true' });
}
