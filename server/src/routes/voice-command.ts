import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { getDb } from '../db.js';
import { createProvider } from '../llm/factory.js';
import { LlmError, type ProviderName } from '../llm/provider.js';
import { buildVoiceCommandSystemPrompt } from '../prompts.js';
import { log } from '../log.js';

export const voiceCommandRouter = Router();

const ReqSchema = z.object({
  transcription: z.string().min(1).max(2000),
});

/**
 * Page identifiers the HUD knows how to navigate to. Kept here as the
 * single source of truth so the classifier prompt stays in sync.
 */
const KNOWN_PAGES = ['idle', 'inbox', 'compose', 'contacts', 'history', 'templates'] as const;

export type KnownPage = (typeof KNOWN_PAGES)[number];

export type VoiceAction =
  | { kind: 'compose'; params: Record<string, never>; confidence: 1 | 2 | 3 }
  | { kind: 'reply'; params: { to_name?: string }; confidence: 1 | 2 | 3 }
  | { kind: 'navigate'; params: { target: KnownPage }; confidence: 1 | 2 | 3 }
  | { kind: 'search'; params: { query: string; scope: 'messages' | 'contacts' }; confidence: 1 | 2 | 3 }
  | { kind: 'save_contact'; params: { name: string; phone?: string; email?: string }; confidence: 1 | 2 | 3 }
  | { kind: 'settings'; params: { key: string; value: string }; confidence: 1 | 2 | 3 }
  | { kind: 'cancel'; params: Record<string, never>; confidence: 1 | 2 | 3 }
  | { kind: 'unknown'; params: { reason: string }; confidence: 1 | 2 | 3 };

/**
 * POST /api/voice-command
 *
 * Classifies a transcription into one of the voice-anywhere intent classes.
 * The HUD calls this from its universal voice page; the classifier output
 * tells the HUD which handler to dispatch to.
 *
 * Returns: { transcription, action, latency_ms }
 */
voiceCommandRouter.post('/api/voice-command', requireAuth, rateLimit({ bucket: 'rewrite', limit: 1200 }), async (req, res) => {
  const parsed = ReqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  const db = getDb();

  // Same provider as the compose pipeline — keep the LLM dependency surface
  // small (one preference, not many).
  const prefs = db
    .prepare('SELECT rewrite_provider, rewrite_model FROM preferences WHERE user_id = ?')
    .get(userId) as { rewrite_provider: string; rewrite_model: string } | undefined;
  if (!prefs) {
    res.status(500).json({ error: 'preferences_missing' });
    return;
  }

  const contacts = db
    .prepare('SELECT id, name, phone_e164 as phone, email FROM contacts WHERE user_id = ? LIMIT 50')
    .all(userId) as Array<{ id: number; name: string; phone: string | null; email: string | null }>;

  const t0 = Date.now();
  try {
    const provider = createProvider(prefs.rewrite_provider as ProviderName, userId);
    const r = await provider.complete({
      systemPrompt: buildVoiceCommandSystemPrompt({
        knownPages: [...KNOWN_PAGES],
        contacts,
      }),
      userMessage: parsed.data.transcription,
      model: prefs.rewrite_model,
      maxTokens: 300,
      temperature: 0.1,
      cacheSystemPrompt: false,
    });
    const action = parseAction(r.text);
    res.json({
      transcription: parsed.data.transcription,
      action,
      latency_ms: Date.now() - t0,
    });
  } catch (err) {
    const message = err instanceof LlmError ? err.message : err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'voice-command classify failed');
    res.status(502).json({ error: 'classifier_failed', message });
  }
});

function parseAction(text: string): VoiceAction {
  // Strip code fences if the model wraps JSON in them.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { kind: 'unknown', params: { reason: `non-json: ${text.slice(0, 80)}` }, confidence: 1 };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unknown', params: { reason: 'not-object' }, confidence: 1 };
  }
  const obj = parsed as { kind?: string; params?: unknown; confidence?: number };
  const kind = obj.kind ?? 'unknown';
  const confidence = ([1, 2, 3] as const).includes(obj.confidence as 1 | 2 | 3)
    ? (obj.confidence as 1 | 2 | 3)
    : 2;
  // Trust the model output shape; the classifier prompt enforces it strictly
  // and the HUD has a defensive switch for unexpected kinds.
  return {
    kind: kind as VoiceAction['kind'],
    params: (obj.params ?? {}) as VoiceAction['params'],
    confidence,
  } as VoiceAction;
}
