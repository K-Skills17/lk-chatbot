import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_KEY: z.string().min(1).default('not-set'),
  ADMIN_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(1).default('lk-chatbot-jwt-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),

  // SMTP (optional — for email notifications)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  EVOLUTION_API_URL: z.string().default(''),
  EVOLUTION_API_KEY: z.string().default(''),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_PRIMARY_PROVIDER: z.enum(['claude', 'openai']).default('claude'),
  AI_PRIMARY_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  AI_QUALIFICATION_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  // Facebook Lead Ads
  FACEBOOK_VERIFY_TOKEN: z.string().default('lk-chatbot-fb-verify-2024'),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Stripe billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_STARTER_PRICE_ID: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_ENTERPRISE_PRICE_ID: z.string().optional(),

  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Diagnostic tool integration
  DIAGNOSTIC_WEBHOOK_SECRET: z.string().optional(),

  WEBHOOK_BASE_URL: z.string().default('http://localhost:3000'),

  // Concierge debounce & webhook auth
  DEBOUNCE_MS: z.coerce.number().default(10000),
  WEBHOOK_SHARED_SECRET: z.string().optional(),
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
  if (data.JWT_SECRET === 'lk-chatbot-jwt-secret-change-me') {
    if (data.NODE_ENV === 'production') {
      console.error('CRITICAL: JWT_SECRET is using the default value in production! Set a strong random secret.');
    } else {
      console.warn('JWT_SECRET using default value — set a strong secret before deploying');
    }
  }

  return data;
}

export const env = loadEnv();
