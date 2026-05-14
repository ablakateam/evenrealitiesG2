import type { ProviderName } from './provider.js';

export type Speed = 'fast' | 'balanced' | 'slow';

export interface Model {
  id: string;
  speed: Speed;
  /** Optional short note shown next to the model in the picker. */
  note?: string;
}

export interface ProviderCatalog {
  provider: ProviderName;
  /** Default model id when this provider is selected. Must be in `models`. */
  default: string;
  /** Whether arbitrary user-supplied model IDs are accepted (for OpenRouter / Ollama). */
  allowCustom: boolean;
  models: Model[];
}

/**
 * Curated model menus surfaced in Preferences → Voice & AI.
 * Speed glyphs in the UI: ⚡ fast (<500ms), ⚙ balanced (500ms–1s), 🐢 slower (>1s).
 * "balanced/slow" tags are heuristic; "Test with sample" in the dashboard
 * measures real latency against the user's network.
 */
export const CATALOG: Record<ProviderName, ProviderCatalog> = {
  anthropic: {
    provider: 'anthropic',
    default: 'claude-haiku-4-5',
    allowCustom: false,
    models: [
      { id: 'claude-haiku-4-5', speed: 'fast', note: 'default — fast, cheap' },
      { id: 'claude-sonnet-4-6', speed: 'balanced', note: 'higher quality' },
      { id: 'claude-opus-4-7', speed: 'slow', note: 'premium quality' },
    ],
  },
  openai: {
    provider: 'openai',
    default: 'gpt-4o-mini',
    allowCustom: false,
    models: [
      { id: 'gpt-4o-mini', speed: 'fast', note: 'default — cheapest mainstream' },
      { id: 'gpt-4o', speed: 'balanced', note: 'higher quality' },
      { id: 'gpt-4.1', speed: 'balanced', note: 'latest' },
    ],
  },
  openrouter: {
    provider: 'openrouter',
    default: 'openai/gpt-4o-mini',
    allowCustom: true,
    models: [
      { id: 'openai/gpt-4o-mini', speed: 'fast', note: 'cheap default' },
      { id: 'anthropic/claude-haiku-4-5', speed: 'fast', note: 'Claude via OpenRouter' },
      { id: 'meta-llama/llama-3.3-70b-instruct', speed: 'balanced', note: 'open weights' },
      { id: 'qwen/qwen-2.5-72b-instruct', speed: 'balanced', note: 'open weights, multilingual' },
      { id: 'mistralai/mistral-large', speed: 'balanced' },
      { id: 'deepseek/deepseek-chat', speed: 'fast', note: 'cheap, capable' },
      { id: 'google/gemini-2.0-flash', speed: 'fast' },
    ],
  },
  'ollama-cloud': {
    provider: 'ollama-cloud',
    default: 'llama3.3:70b',
    allowCustom: true,
    models: [
      { id: 'llama3.3:70b', speed: 'balanced', note: 'default — open weights' },
      { id: 'qwen2.5:72b', speed: 'balanced', note: 'multilingual' },
      { id: 'deepseek-v3', speed: 'balanced' },
      { id: 'mistral-large', speed: 'balanced' },
    ],
  },
};

/**
 * Validates that a (provider, model) pair is allowed.
 * Returns null if valid, or an error message string.
 */
export function validateModel(provider: ProviderName, model: string): string | null {
  const cat = CATALOG[provider];
  if (!cat) return `unknown provider: ${provider}`;
  if (cat.allowCustom) return null;
  const found = cat.models.find((m) => m.id === model);
  if (!found) {
    return `model "${model}" not in ${provider} catalog; allowed: ${cat.models.map((m) => m.id).join(', ')}`;
  }
  return null;
}
