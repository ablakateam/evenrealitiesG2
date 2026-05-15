import type { Page, PageContext } from '../router.js';
import type { NormalizedEvent } from '../bridge.js';
import { showPage } from '../render.js';
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

const TITLE_ID = 1;
const LIST_ID = 2;
const FOOTER_ID = 3;

const MAX_RECORDING_SECONDS = 30;
const SILENCE_AUTOSTOP_SECONDS = 3;
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
      await ctx.bridge.audioControl(true);
    } catch (err) {
      console.warn('[voice] audioControl(true) failed:', err);
    }

    tick = setInterval(() => {
      if (state !== 'recording') return;
      const label = formatElapsed(recorder.elapsedSeconds);
      if (label !== lastTimerLabel) {
        lastTimerLabel = label;
        void render(ctx);
      }
      if (recorder.elapsedSeconds >= MAX_RECORDING_SECONDS) {
        void stopAndDispatch(ctx);
      } else if (!recorder.isEmpty && recorder.silenceSeconds >= SILENCE_AUTOSTOP_SECONDS) {
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

async function render(ctx: PageContext): Promise<void> {
  let title: string;
  let items: string[];
  let footer: string;
  if (state === 'recording') {
    title = `SPEAK  ${formatElapsed(recorder.elapsedSeconds)}`;
    items = ['Try: "open inbox"', '"send dan running late"', '"save 415-555-0142 as mom"'];
    footer = '[TAP] stop   [X2] cancel';
  } else if (state === 'thinking') {
    title = 'thinking';
    items = ['picking the right words...'];
    footer = '[X2] cancel';
  } else if (state === 'done') {
    title = 'done';
    items = ['ok'];
    footer = '[X2] back';
  } else {
    title = 'Hmm.';
    items = [
      "Didn't quite catch that.",
      'Try again or get more specific.',
      errorMsg ? `(${errorMsg.slice(0, 60)})` : '',
    ].filter(Boolean);
    footer = '[TAP] retry  [X2] back';
  }
  await showPage(ctx.bridge, {
    texts: [
      { id: TITLE_ID, x: 0, y: 0, w: 576, h: 44, capture: false, content: title },
      { id: FOOTER_ID, x: 0, y: 236, w: 576, h: 48, capture: false, content: footer },
    ],
    lists: [{ id: LIST_ID, x: 0, y: 48, w: 576, h: 184, capture: true, items }],
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
    console.warn('[voice] no audio captured — using sim fallback utterance');
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
      else await ctx.router.go(makeStubPage('voice-nav', 'TODO', `'${action.params.target}' coming in P17.`));
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
          'TODO',
          `Reply by-name needs P17 polish.\nName: ${action.params.to_name ?? '?'}`,
        ),
      );
      return;
    case 'search':
      await ctx.router.go(
        makeStubPage(
          'voice-search-stub',
          'TODO',
          `Search ships in P17.\nQuery: ${action.params.query}\nScope: ${action.params.scope}`,
        ),
      );
      return;
    case 'settings':
      await ctx.router.go(
        makeStubPage(
          'voice-settings-stub',
          'TODO',
          `Settings change ships in P17.\n${action.params.key} = ${action.params.value}`,
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
