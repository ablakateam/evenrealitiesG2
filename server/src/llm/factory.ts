import { AnthropicProvider } from './anthropic.js';
import { createOllamaCloud, createOpenAI, createOpenRouter } from './openai-compatible.js';
import { LlmError, type LlmProvider, type ProviderName } from './provider.js';
import { env } from '../env.js';
import {
  getIntegrationCreds,
  credsSource,
  type ApiKeyCreds,
  type IntegrationProvider,
} from '../integrations.js';

/**
 * Resolve an LLM provider instance for a user.
 *
 * Credentials resolve DB-first (the `integrations` table written by the
 * onboarding wizard) with env-var fallback (the bootstrap path).
 * Throws LlmError("missing_credentials") if neither source has a key.
 */
export function createProvider(provider: ProviderName, userId: number): LlmProvider {
  const creds = getIntegrationCreds(userId, provider as IntegrationProvider) as ApiKeyCreds | null;
  if (!creds || !creds.api_key) {
    throw new LlmError(provider, '?', 'missing_credentials', `no API key configured for ${provider}`);
  }
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(creds.api_key);
    case 'openai':
      return createOpenAI(creds.api_key);
    case 'openrouter':
      return createOpenRouter(creds.api_key, env.OPENROUTER_BASE_URL);
    case 'ollama-cloud':
      return createOllamaCloud(creds.api_key, env.OLLAMA_CLOUD_BASE_URL);
  }
}

/** Which providers have credentials configured (DB or env) for this user. */
export function configuredProviders(userId: number): ProviderName[] {
  const all: ProviderName[] = ['anthropic', 'openai', 'openrouter', 'ollama-cloud'];
  return all.filter((p) => credsSource(userId, p as IntegrationProvider) !== 'none');
}
