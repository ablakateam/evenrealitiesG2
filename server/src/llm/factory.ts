import { env } from '../env.js';
import { AnthropicProvider } from './anthropic.js';
import { createOllamaCloud, createOpenAI, createOpenRouter } from './openai-compatible.js';
import { LlmError, type LlmProvider, type ProviderName } from './provider.js';

/**
 * Resolve a provider instance for the named provider.
 * Throws LlmError("missing_credentials") if the corresponding API key env var is unset.
 */
export function createProvider(provider: ProviderName): LlmProvider {
  switch (provider) {
    case 'anthropic': {
      if (!env.ANTHROPIC_KEY) {
        throw new LlmError(provider, '?', 'missing_credentials', 'ANTHROPIC_KEY env var is not set');
      }
      return new AnthropicProvider(env.ANTHROPIC_KEY);
    }
    case 'openai': {
      if (!env.OPENAI_KEY) {
        throw new LlmError(provider, '?', 'missing_credentials', 'OPENAI_KEY env var is not set');
      }
      return createOpenAI(env.OPENAI_KEY);
    }
    case 'openrouter': {
      if (!env.OPENROUTER_KEY) {
        throw new LlmError(provider, '?', 'missing_credentials', 'OPENROUTER_KEY env var is not set');
      }
      return createOpenRouter(env.OPENROUTER_KEY, env.OPENROUTER_BASE_URL);
    }
    case 'ollama-cloud': {
      if (!env.OLLAMA_CLOUD_KEY) {
        throw new LlmError(provider, '?', 'missing_credentials', 'OLLAMA_CLOUD_KEY env var is not set');
      }
      return createOllamaCloud(env.OLLAMA_CLOUD_KEY, env.OLLAMA_CLOUD_BASE_URL);
    }
  }
}

/** Which providers have credentials configured right now. */
export function configuredProviders(): ProviderName[] {
  const out: ProviderName[] = [];
  if (env.ANTHROPIC_KEY) out.push('anthropic');
  if (env.OPENAI_KEY) out.push('openai');
  if (env.OPENROUTER_KEY) out.push('openrouter');
  if (env.OLLAMA_CLOUD_KEY) out.push('ollama-cloud');
  return out;
}
