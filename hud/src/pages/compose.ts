import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
import { AudioRecorder, formatElapsed } from '../audio.js';
import { hudApi, apiPostAudio, HudApiError, type ComposeResult } from '../api.js';
import { makeConfirmPage } from './confirm.js';

/**
 * Compose page — capture voice, transcribe, hand off to the confirm screen.
 *
 * State machine:
 *   recording    — mic open, live RMS meter + timer, tap to stop
 *   transcribing — mic closed, POST to /api/compose, "one sec" copy
 *   error        — couldn't transcribe; tap to retry, double-tap exits
 *
 * Layout: 3 containers (title text c1, list c2 capture, footer text c3),
 * matching Idle and Confirm. We learned the hard way (L:38) that
 * rebuildPageContainer silently returns `false` when it has to introduce
 * container IDs that were dropped by a prior smaller rebuild — so every
 * page in the app keeps the same shape and only swaps content.
 *
 * Tick dedup: the timer label drives rebuilds; we only re-render when the
 * mm:ss string changes (≤1 Hz), not every 250 ms tick.
 *
 * Headless-simulator note: the simulator has no mic, so `audioControl`
 * yields no audioEvents and the recorder stays empty. When that happens we
 * fall back to the JSON path of /api/compose with a sample transcription
 * (gated on `recorder.isEmpty`). On real hardware the mic fills the buffer
 * and the multipart-audio path runs.
 */

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;
const MAX_RECORDING_SECONDS = 60;
const SILENCE_AUTOSTOP_SECONDS = 4;
const TICK_MS = 250;

const TRANSCRIBING_COPY = ['Reading your voice...', 'One sec...', 'Got that down...'];
const SIM_FALLBACK_TRANSCRIPTION =
  'send a text to alex saying running about ten minutes late, sorry';

type State = 'recording' | 'transcribing' | 'error';

let state: State = 'recording';
let recorder = new AudioRecorder();
let tick: ReturnType<typeof setInterval> | null = null;
let errorMsg = '';
let lastTimerLabel = ''; // dedup at second-resolution so we rebuild ≤1 Hz

export const ComposePage: Page = {
  id: 'compose',

  async mount(ctx: PageContext): Promise<void> {
    state = 'recording';
    recorder = new AudioRecorder();
    recorder.start();
    errorMsg = '';
    lastTimerLabel = formatElapsed(0);

    // 3-container layout that matches Idle + Confirm. The SDK can't expand
    // container count via rebuildPageContainer once it has been shrunk, so
    // every page in the app uses (title-text c1, list c2 capture, footer-
    // text c3) and only the content changes between pages.
    await renderRecording(ctx, 'recording');

    // Mic control is awaited (concurrent bridge ops can stall the next
    // rebuild), then the tick takes over.
    try {
      await ctx.bridge.audioControl(true);
    } catch (err) {
      console.warn('[compose] audioControl(true) failed:', err);
    }

    tick = setInterval(() => {
      if (state !== 'recording') return;
      const label = formatElapsed(recorder.elapsedSeconds);
      if (label !== lastTimerLabel) {
        lastTimerLabel = label;
        void renderRecording(ctx, 'recording');
      }
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
    if (event.kind === 'tap') {
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

  await renderRecording(ctx, 'transcribing');

  try {
    const result = await transcribe();
    await ctx.router.go(makeConfirmPage(result));
  } catch (err) {
    console.error('[compose] transcribe failed:', err);
    state = 'error';
    errorMsg =
      err instanceof HudApiError ? err.message : err instanceof Error ? err.message : 'transcription failed';
    await renderRecording(ctx, 'error');
  }
}

async function transcribe(): Promise<ComposeResult> {
  if (recorder.isEmpty) {
    // Dev / headless-simulator fallback — no mic frames were captured, so run
    // the pipeline via the JSON transcription path with a sample utterance.
    console.warn('[compose] no audio captured — using sim fallback transcription');
    return hudApi<ComposeResult>('/api/compose', {
      method: 'POST',
      body: { transcription: SIM_FALLBACK_TRANSCRIPTION },
    });
  }
  return apiPostAudio<ComposeResult>('/api/compose', recorder.toBuffer(), { is_raw_pcm: 'true' });
}

/**
 * Render the 3-container compose page in any of its visual states.
 * Same container shape as Idle and Confirm — keeps the SDK happy.
 */
async function renderRecording(
  ctx: PageContext,
  visual: 'recording' | 'transcribing' | 'error',
): Promise<void> {
  let title: string;
  let items: string[];
  let footer: string;
  if (visual === 'recording') {
    title = `REC  ${formatElapsed(recorder.elapsedSeconds)}`;
    items = ["Go ahead, I'm with you.", '', recorder.meter()];
    footer = '[TAP] stop   [X2] cancel';
  } else if (visual === 'transcribing') {
    const copy = TRANSCRIBING_COPY[Math.floor(Math.random() * TRANSCRIBING_COPY.length)]!;
    title = 'transcribing';
    items = [copy];
    footer = '[X2] cancel';
  } else {
    title = 'Hmm.';
    items = ["Couldn't catch that.", errorMsg];
    footer = '[TAP] retry   [X2] cancel';
  }
  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: title },
      { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: footer },
    ],
    lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items }],
  });
}
