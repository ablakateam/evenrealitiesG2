import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';

export const configRouter = Router();

const PreferencesUpdate = z
  .object({
    default_channel: z.enum(['sms', 'email', 'smart']),
    default_tone: z.enum(['casual', 'professional', 'friendly', 'formal', 'sarcastic', 'grammar', 'original']),
    always_grammar_fix: z.boolean(),
    rewrite_provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama-cloud']),
    rewrite_model: z.string().min(1),
    voice_language: z.string().min(1),
    confirm_before_send: z.boolean(),
    smart_channel_inference: z.boolean(),
    smart_idle: z.boolean(),
    smart_pause: z.boolean(),
    tone_memory_per_contact: z.boolean(),
    long_press_send_last: z.boolean(),
    always_on_voice: z.boolean(),
    max_recording_seconds: z.number().int().min(10).max(300),
    silence_autostop_seconds: z.number().int().min(0).max(30),
    notify_on_sms: z.boolean(),
    notify_on_email: z.boolean(),
    quiet_hours_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    quiet_hours_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    sender_filter: z.enum(['anyone', 'contacts', 'favorites']),
    daily_sms_limit: z.number().int().min(0),
    daily_email_limit: z.number().int().min(0),
    daily_token_limit: z.number().int().min(0),
  })
  .partial();

configRouter.get('/api/config', requireAuth, (req, res) => {
  const db = getDb();
  const prefs = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(req.user!.id);
  if (!prefs) {
    res.status(404).json({ error: 'preferences_missing' });
    return;
  }
  res.json({ user_id: req.user!.id, preferences: normalize(prefs as Record<string, unknown>) });
});

configRouter.put('/api/config', requireAuth, (req, res) => {
  const parsed = PreferencesUpdate.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const fields = parsed.data;
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    res.status(400).json({ error: 'empty_update' });
    return;
  }
  const db = getDb();
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = { ...fields, user_id: req.user!.id };
  for (const k of keys) {
    const v = (fields as Record<string, unknown>)[k];
    if (typeof v === 'boolean') params[k] = v ? 1 : 0;
  }
  db.prepare(`UPDATE preferences SET ${setClause}, updated_at = datetime('now') WHERE user_id = @user_id`).run(
    params,
  );
  const updated = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(req.user!.id);
  res.json({ user_id: req.user!.id, preferences: normalize(updated as Record<string, unknown>) });
});

/** Convert SQLite 0/1 integers back to JS booleans for the response. */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const boolFields = new Set([
    'always_grammar_fix',
    'confirm_before_send',
    'smart_channel_inference',
    'smart_idle',
    'smart_pause',
    'tone_memory_per_contact',
    'long_press_send_last',
    'always_on_voice',
    'notify_on_sms',
    'notify_on_email',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = boolFields.has(k) ? Boolean(v) : v;
  }
  return out;
}
