import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { compose } from '../compose.js';
import { transcribe } from '../audio/stt.js';
import { LlmError } from '../llm/provider.js';
import { log } from '../log.js';
import { rateLimit } from '../rate-limit.js';

export const composeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB ≈ ~13 min of 16k mono PCM — plenty for the 60s recording cap
});

/**
 * POST /api/stt
 *
 * Multipart upload of audio for transcription. Accepts either:
 *   - field "audio" with a WAV/MP3/M4A file (set is_raw_pcm=false), or
 *   - field "audio" with raw 16kHz mono 16-bit LE PCM (set is_raw_pcm=true,
 *     default for HUD streams)
 *
 * Returns: { text, language, duration_seconds, latency_ms }
 */
composeRouter.post('/api/stt', requireAuth, rateLimit({ bucket: 'stt', limit: 60 }), upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'audio_missing', message: 'POST a multipart form with field "audio"' });
    return;
  }
  const isRawPcm = req.body?.is_raw_pcm !== 'false'; // default true
  const language = typeof req.body?.language === 'string' && req.body.language ? req.body.language : undefined;
  try {
    const result = await transcribe(req.user!.id, { audio: req.file.buffer, isRawPcm, language });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

/**
 * POST /api/compose
 *
 * The hot path. Either:
 *   - multipart with field "audio" (HUD voice flow), or
 *   - JSON body with { transcription: "..." } (text-only flow / tests)
 *
 * Fires STT (if audio) → intent parse + 6 rewrites + 1 identity (original)
 * in parallel against the user's configured LLM. Returns all 7 variants
 * pre-cached.
 */
composeRouter.post(
  '/api/compose',
  requireAuth,
  rateLimit({ bucket: 'rewrite', limit: 1200 }),
  // multer is conditional — accept either multipart or JSON
  (req, res, next) => {
    const ct = req.headers['content-type'] ?? '';
    if (ct.startsWith('multipart/')) return upload.single('audio')(req, res, next);
    return next();
  },
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const ct = req.headers['content-type'] ?? '';
      let audio: Buffer | undefined;
      let isRawPcm = true;
      let transcriptionOverride: string | undefined;

      if (ct.startsWith('multipart/')) {
        if (!req.file) {
          res.status(400).json({ error: 'audio_missing' });
          return;
        }
        audio = req.file.buffer;
        isRawPcm = req.body?.is_raw_pcm !== 'false';
      } else {
        const body = z
          .object({ transcription: z.string().min(1).max(8000) })
          .safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'invalid_body', issues: body.error.issues });
          return;
        }
        transcriptionOverride = body.data.transcription;
      }

      const result = await compose({
        userId,
        audio,
        isRawPcm,
        transcriptionOverride,
      });
      res.json(result);
    } catch (err) {
      handleErr(err, res);
    }
  },
);

/**
 * POST /api/parse
 *
 * Text-only intent parse (no STT, no rewrites). Lighter-weight than /api/compose;
 * used when the HUD already has a transcription and only needs structure.
 */
composeRouter.post('/api/parse', requireAuth, async (req, res) => {
  const body = z.object({ transcription: z.string().min(1).max(8000) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'invalid_body', issues: body.error.issues });
    return;
  }
  try {
    const result = await compose({
      userId: req.user!.id,
      transcriptionOverride: body.data.transcription,
    });
    res.json({
      transcription: result.transcription,
      intent: result.intent,
      total_latency_ms: result.total_latency_ms,
    });
  } catch (err) {
    handleErr(err, res);
  }
});

/**
 * POST /api/rewrite
 *
 * Single-tone rewrite for re-runs / manual edits (e.g. user picks a tone
 * after-the-fact and we re-fire one variant).
 */
composeRouter.post('/api/rewrite', requireAuth, async (req, res) => {
  const Body = z.object({
    text: z.string().min(1).max(8000),
    tone: z.enum(['casual', 'professional', 'friendly', 'formal', 'sarcastic', 'grammar']),
    channel: z.enum(['sms', 'email']).default('sms'),
    language: z.string().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  try {
    const { createProvider } = await import('../llm/factory.js');
    const { buildRewriteSystemPrompt } = await import('../prompts.js');
    const { getDb } = await import('../db.js');
    const prefs = getDb()
      .prepare('SELECT rewrite_provider, rewrite_model FROM preferences WHERE user_id = ?')
      .get(req.user!.id) as { rewrite_provider: string; rewrite_model: string };
    const provider = createProvider(prefs.rewrite_provider as 'anthropic' | 'openai' | 'openrouter' | 'ollama-cloud', req.user!.id);
    const result = await provider.complete({
      systemPrompt: buildRewriteSystemPrompt({
        tone: parsed.data.tone,
        channel: parsed.data.channel,
        language: parsed.data.language,
      }),
      userMessage: parsed.data.text,
      model: prefs.rewrite_model,
      maxTokens: 400,
      temperature: parsed.data.tone === 'grammar' ? 0.1 : 0.7,
      cacheSystemPrompt: true,
    });
    res.json({
      tone: parsed.data.tone,
      text: result.text.trim(),
      latency_ms: result.latency_ms,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
    });
  } catch (err) {
    handleErr(err, res);
  }
});

function handleErr(err: unknown, res: import('express').Response): void {
  if (err instanceof LlmError) {
    log.warn({ err }, 'llm error in compose route');
    const status =
      err.code === 'missing_credentials' ? 400 : err.code === 'unauthorized' ? 401 : err.code === 'rate_limited' ? 429 : 502;
    res.status(status).json({
      error: err.code,
      provider: err.provider,
      model: err.model,
      message: err.message,
      upstream_status: err.httpStatus,
    });
    return;
  }
  if (err instanceof Error) {
    log.error({ err }, 'compose route error');
    res.status(500).json({ error: 'internal_error', message: err.message });
    return;
  }
  log.error({ err }, 'compose route unknown error');
  res.status(500).json({ error: 'internal_error' });
}
