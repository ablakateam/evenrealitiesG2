import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { CATALOG, validateModel } from '../llm/models.js';
import { configuredProviders, createProvider } from '../llm/factory.js';
import { LlmError, type ProviderName } from '../llm/provider.js';
import { log } from '../log.js';

export const llmRouter = Router();

/**
 * GET /api/llm/models
 *
 * Returns the curated provider+model catalog plus which providers are
 * actually configured server-side. Used by the dashboard's Voice & AI
 * picker to render the dropdown.
 */
llmRouter.get('/api/llm/models', requireAuth, (_req, res) => {
  res.json({
    catalog: CATALOG,
    configured_providers: configuredProviders(),
  });
});

/**
 * POST /api/llm/test
 *
 * Drives a real round-trip call against the named provider+model with the
 * supplied prompt. Used by the dashboard's "Test with sample" button.
 * Returns the completion text, latency, and token counts so the user can
 * compare providers head-to-head before committing in Preferences.
 */
const TestBody = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama-cloud']),
  model: z.string().min(1),
  system_prompt: z.string().min(1).default('You are a helpful assistant. Keep responses brief and natural.'),
  user_message: z.string().min(1).default('In one short sentence, suggest a casual way to tell a friend I will be running ten minutes late.'),
  max_tokens: z.number().int().min(1).max(2048).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
  cache_system_prompt: z.boolean().default(false),
});

llmRouter.post('/api/llm/test', requireAuth, async (req, res) => {
  const parsed = TestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const modelError = validateModel(body.provider, body.model);
  if (modelError) {
    res.status(400).json({ error: 'invalid_model', message: modelError });
    return;
  }
  try {
    const provider = createProvider(body.provider as ProviderName);
    const result = await provider.complete({
      systemPrompt: body.system_prompt,
      userMessage: body.user_message,
      model: body.model,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      cacheSystemPrompt: body.cache_system_prompt,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      log.warn({ err }, 'llm test failed');
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
    log.error({ err }, 'llm test unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
});
