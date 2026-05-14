import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().nonnegative().default(3000),
  DB_PATH: z.string().min(1).default('./data/vox.db'),
  MASTER_KEY: z
    .string()
    .min(1, 'MASTER_KEY required — generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'),
  BOOTSTRAP_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // LLM provider API keys (all optional; only required if that provider is used)
  ANTHROPIC_KEY: z.string().optional(),
  OPENAI_KEY: z.string().optional(),
  OPENROUTER_KEY: z.string().optional(),
  OLLAMA_CLOUD_KEY: z.string().optional(),
  // Allow overriding base URLs for OpenAI-compatible providers (rarely needed)
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OLLAMA_CLOUD_BASE_URL: z.string().url().default('https://ollama.com/v1'),

  // Twilio SMS
  TWILIO_SID: z.string().optional(),
  TWILIO_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(), // E.164 format, e.g. +14155550100
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(), // preferred over FROM when set
  // Public origin of this server — used to build webhook URLs for Twilio
  // signature verification. Must match the deployment's real domain.
  TWILIO_WEBHOOK_BASE_URL: z.string().url(),

  // Public origin used for outbound attribution headers (e.g. OpenRouter
  // HTTP-Referer). Falls back to TWILIO_WEBHOOK_BASE_URL when unset.
  PUBLIC_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
