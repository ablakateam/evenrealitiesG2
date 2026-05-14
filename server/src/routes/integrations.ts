import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  ALL_INTEGRATION_PROVIDERS,
  deleteIntegration,
  getAllIntegrationViews,
  getIntegrationView,
  setIntegration,
  setIntegrationStatus,
  type IntegrationProvider,
} from '../integrations.js';
import { sendSms } from '../sms/twilio-client.js';
import { createProvider } from '../llm/factory.js';
import { LlmError } from '../llm/provider.js';
import { CATALOG } from '../llm/models.js';
import { log } from '../log.js';

export const integrationsRouter = Router();

/** GET /api/integrations — masked status of every provider. */
integrationsRouter.get('/api/integrations', requireAuth, (req, res) => {
  res.json({ integrations: getAllIntegrationViews(req.user!.id) });
});

/** GET /api/integrations/:provider — single provider view. */
integrationsRouter.get('/api/integrations/:provider', requireAuth, (req, res) => {
  const provider = req.params.provider as IntegrationProvider;
  if (!ALL_INTEGRATION_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'unknown_provider' });
    return;
  }
  res.json(getIntegrationView(req.user!.id, provider));
});

const TwilioBody = z.object({
  provider: z.literal('twilio'),
  sid: z.string().min(10),
  token: z.string().min(10),
  from_number: z.string().optional(),
  messaging_service_sid: z.string().optional(),
});
const ApiKeyBody = z.object({
  provider: z.enum(['openai', 'anthropic', 'openrouter', 'ollama-cloud']),
  api_key: z.string().min(10),
});
const PutBody = z.discriminatedUnion('provider', [TwilioBody, ApiKeyBody]);

/** PUT /api/integrations — set credentials for a provider (encrypted at rest). */
integrationsRouter.put('/api/integrations', requireAuth, (req, res) => {
  const parsed = PutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  const data = parsed.data;
  if (data.provider === 'twilio') {
    if (!data.from_number && !data.messaging_service_sid) {
      res.status(400).json({ error: 'twilio_no_sender', message: 'from_number or messaging_service_sid required' });
      return;
    }
    setIntegration(userId, 'twilio', {
      sid: data.sid,
      token: data.token,
      from_number: data.from_number,
      messaging_service_sid: data.messaging_service_sid,
    });
  } else {
    setIntegration(userId, data.provider, { api_key: data.api_key });
  }
  res.json(getIntegrationView(userId, data.provider));
});

/** DELETE /api/integrations/:provider */
integrationsRouter.delete('/api/integrations/:provider', requireAuth, (req, res) => {
  const provider = req.params.provider as IntegrationProvider;
  if (!ALL_INTEGRATION_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'unknown_provider' });
    return;
  }
  deleteIntegration(req.user!.id, provider);
  res.json({ ok: true });
});

/**
 * POST /api/integrations/:provider/test
 *
 * Fires a real round-trip against the stored credentials. For Twilio it
 * optionally sends a test SMS when `?to=` is given; otherwise it just
 * validates the account by listing the Messaging Service / number. For LLM
 * providers it runs a tiny completion.
 */
const TwilioTestBody = z.object({ to: z.string().optional() });

integrationsRouter.post('/api/integrations/twilio/test', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const parsed = TwilioTestBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const to = parsed.data.to;
  if (!to) {
    // No destination — we can't do a no-op Twilio call cheaply, so just
    // confirm credentials exist. A real send requires `to`.
    const view = getIntegrationView(userId, 'twilio');
    if (!view.configured) {
      res.status(400).json({ error: 'not_configured' });
      return;
    }
    res.json({ ok: true, note: 'credentials present; pass `to` for a live send test' });
    return;
  }
  try {
    const result = await sendSms(userId, { to, body: 'VOX · Twilio test — SMS is working.' });
    setIntegrationStatus(userId, 'twilio', 'configured');
    res.json({ ok: true, message_sid: result.message_sid, status: result.status, latency_ms: result.latency_ms });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setIntegrationStatus(userId, 'twilio', 'error', msg);
    log.warn({ err }, 'twilio integration test failed');
    res.status(502).json({ error: 'twilio_test_failed', message: msg });
  }
});

integrationsRouter.post('/api/integrations/:provider/test', requireAuth, async (req, res) => {
  const provider = req.params.provider as IntegrationProvider;
  if (provider === 'twilio' || !ALL_INTEGRATION_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'unknown_provider' });
    return;
  }
  const userId = req.user!.id;
  const model = CATALOG[provider].default;
  try {
    const llm = createProvider(provider, userId);
    const result = await llm.complete({
      systemPrompt: 'You are a test probe. Reply with exactly: OK',
      userMessage: 'ping',
      model,
      maxTokens: 8,
      temperature: 0,
    });
    setIntegrationStatus(userId, provider, 'configured');
    res.json({ ok: true, provider, model, latency_ms: result.latency_ms, sample: result.text.trim() });
  } catch (err) {
    const msg = err instanceof LlmError ? err.message : err instanceof Error ? err.message : String(err);
    setIntegrationStatus(userId, provider, 'error', msg);
    log.warn({ err, provider }, 'llm integration test failed');
    const status = err instanceof LlmError && err.code === 'missing_credentials' ? 400 : 502;
    res.status(status).json({ error: 'llm_test_failed', provider, message: msg });
  }
});
