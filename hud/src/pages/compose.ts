import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage, updateText, center } from '../render.js';
import { BODY_TOP, BODY_BOTTOM } from '../chrome.js';
import { AudioRecorder, formatElapsed } from '../audio.js';
import { hudApi, apiPostAudio, HudApiError, type ComposeResult } from '../api.js';
import { setDraftFromCompose } from '../draft.js';
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

const MAX_RECORDING_SECONDS = 60;
const SILENCE_AUTOSTOP_SECONDS = 6;
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
      await ctx.bridge.audioControl(true);
    } catch (err) {
      console.warn('[compose] audioControl(true) failed:', err);
    }

    tick = setInterval(() => {
      if (state !== 'recording') return;
      // Live meter patch — only updates the meter container.
      void updateText(ctx.bridge, METER_ID, meterContent());
      if (recorder.elapsedSeconds >= MAX_RECORDING_SECONDS) {
        void stopAndTranscribe(ctx);
      } else if (!recorder.isEmpty && recorder.silenceSeconds >= SILENCE_AUTOSTOP_SECONDS) {
        void stopAndTranscribe(ctx);
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
  // Meter is 16 chars wide; timer is 4 chars (e.g. "0:03"). Both centered
  // within the ~100-"char" body line (matches center() in render.ts —
  // leading-space units, not visible chars).
  const CHAR_WIDTH = 100;
  const meterPad = ' '.repeat(Math.max(0, Math.floor((CHAR_WIDTH - 16) / 2)));
  const timer = formatElapsed(recorder.elapsedSeconds);
  const timerPad = ' '.repeat(Math.max(0, Math.floor((CHAR_WIDTH - timer.length) / 2)));
  return `\n${meterPad}${recorder.meter()}\n\n${timerPad}${timer}`;
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
      err instanceof HudApiError ? err.message : err instanceof Error ? err.message : 'transcription failed';
    await render(ctx);
  }
}

async function transcribe(): Promise<ComposeResult> {
  // Anything under ~2 KB of PCM (~125ms at 16kHz mono 16-bit) is too short
  // for Whisper to do anything useful — happens on the simulator with no
  // mic, or if the user taps stop instantly. Fall back to a stock
  // transcription so the rest of the flow stays exercisable end-to-end.
  const MIN_PCM_BYTES = 2048;
  if (recorder.isEmpty || recorder.byteLength < MIN_PCM_BYTES) {
    console.warn(`[compose] only ${recorder.byteLength}B captured — using fallback transcription`);
    return hudApi<ComposeResult>('/api/compose', {
      method: 'POST',
      body: { transcription: SIM_FALLBACK_TRANSCRIPTION },
    });
  }
  return apiPostAudio<ComposeResult>('/api/compose', recorder.toBuffer(), { is_raw_pcm: 'true' });
}
