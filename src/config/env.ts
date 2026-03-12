import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_KEY: z.string().min(1).default('not-set'),
  ADMIN_PASSWORD: z.string().optional(),

  DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),

  EVOLUTION_API_URL: z.string().default(''),
  EVOLUTION_API_KEY: z.string().default(''),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_PRIMARY_PROVIDER: z.enum(['claude', 'openai']).default('claude'),
  AI_PRIMARY_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  AI_QUALIFICATION_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Google Sheets (Service Account — simpler than OAuth)
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional(),

  WEBHOOK_BASE_URL: z.string().default('http://localhost:3000'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.warn('Environment variable warnings:', parsed.error.flatten().fieldErrors);
    // Return defaults so the app can still boot for health checks
    return envSchema.parse({});
  }

  const data = parsed.data;

  // Warn about missing critical vars without crashing
  if (!data.DATABASE_URL) console.warn('DATABASE_URL not set — database features disabled');
  if (!data.EVOLUTION_API_URL) console.warn('EVOLUTION_API_URL not set — WhatsApp features disabled');
  if (data.API_KEY === 'not-set') console.warn('API_KEY not set — using placeholder');

  return data;
}

export const env = loadEnv();
