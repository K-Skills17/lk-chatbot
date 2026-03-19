import path from 'path';
import fs from 'fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { logger } from './utils/logger';
import { registerTenantRoutes } from './modules/tenant/tenant.routes';
import { registerBookingRoutes } from './modules/booking/booking.routes';
import { registerCampaignRoutes } from './modules/campaign/campaign.routes';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes';
import { registerTrainingRoutes } from './modules/training/training.routes';
import { registerWebhookRoutes } from './modules/whatsapp/webhook.handler';
import { registerFacebookWebhookRoutes } from './modules/facebook/facebook.webhook';
import { registerAuditLeadRoutes } from './modules/whatsapp/audit-lead.handler';
import { registerBillingRoutes } from './modules/billing/billing.routes';
import { registerStripeWebhookRoutes } from './modules/billing/stripe.webhook';
import { registerPortalRoutes } from './modules/portal/portal.routes';
import { registerReviewRoutes } from './modules/review/review.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerContactRoutes } from './modules/contact/contact.routes';
import { registerAdminRoutes } from './modules/admin/admin.routes';
import { registerWebChatRoutes } from './modules/webchat/webchat.routes';
import { env } from './config/env';
import { evolutionConfig } from './config/evolution';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { evolutionClient } from './modules/whatsapp/evolution.client';
import { dashboardHtml } from './views/dashboard';

export async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own pino instance
    trustProxy: true,
  });

  // ─── Allow empty-body JSON requests (e.g. DELETE with Content-Type header) ──
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (
      request.headers['content-type']?.includes('application/json') &&
      request.headers['content-length'] === '0'
    ) {
      request.headers['content-type'] = undefined as any;
    }
    return payload;
  });

  // ─── Plugins ──────────────────────────────────────────────

  // Intercept webchat OPTIONS preflight BEFORE the CORS plugin can reject
  // them. The CORS plugin handles OPTIONS in onRequest, which runs before
  // any child-scope preHandler, so we must handle it here at the root.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/webchat/')) {
      if (request.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        return reply.code(204).send();
      }
    }
  });

  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? [env.WEBHOOK_BASE_URL, `${env.WEBHOOK_BASE_URL}/portal`]
      : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // ─── Admin Dashboard ─────────────────────────────────────

  app.get('/', async (_request, reply) => {
    return reply.type('text/html').send(dashboardHtml());
  });

  // ─── Health Check ─────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};
    const errors: Record<string, string> = {};

    // Database check
    if (env.DATABASE_URL) {
      try {
        await prisma.$queryRawUnsafe('SELECT 1');
        checks.database = 'ok';
      } catch (err: any) {
        checks.database = 'error';
        errors.database = err?.message ?? 'Unknown database error';
      }
    } else {
      checks.database = 'skipped';
    }

    // Redis check — must race against a hard timeout because ioredis has
    // maxRetriesPerRequest:null (required by BullMQ) which means ping()
    // retries forever and never rejects if Redis is unreachable, which would
    // hang this handler forever and make the health grid disappear.
    if (env.REDIS_URL) {
      try {
        await Promise.race([
          redis.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Redis ping timeout (3s) — check REDIS_URL')), 3000),
          ),
        ]);
        checks.redis = 'ok';
      } catch (err: any) {
        checks.redis = 'error';
        const sanitizedUrl = env.REDIS_URL.replace(/\/\/.*@/, '//***@');
        errors.redis = `${err?.message ?? 'Unknown Redis error'} (URL: ${sanitizedUrl})`;
      }
    } else {
      checks.redis = 'skipped';
    }

    // Evolution API check (lightweight — 5s timeout, hits root endpoint)
    if (env.EVOLUTION_API_URL) {
      const evoHealth = await evolutionClient.healthCheck();
      if (evoHealth.ok) {
        checks.evolution = 'ok';
      } else {
        checks.evolution = 'error';
        errors.evolution = `${evoHealth.detail} (URL: ${evolutionConfig.baseUrl})`;
      }
    } else {
      checks.evolution = 'skipped';
    }

    // Database is required; Redis and Evolution are optional services
    const coreOk = checks.database === 'ok' || checks.database === 'skipped';
    const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'skipped');
    const status = !coreOk ? 'degraded' : allOk ? 'ready' : 'ready_with_warnings';

    return reply.code(coreOk ? 200 : 503).send({
      status,
      checks,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
      config: {
        webhookUrl: evolutionConfig.webhookUrl,
        evolutionUrl: evolutionConfig.baseUrl || 'not set',
        evolutionUrlRaw: env.EVOLUTION_API_URL || 'not set',
        redisUrl: env.REDIS_URL ? env.REDIS_URL.replace(/\/\/.*@/, '//***@') : 'not set',
        aiProvider: env.AI_PRIMARY_PROVIDER,
      },
    });
  });

  // ─── Admin password login ────────────────────────────────────────
  app.post('/api/admin/login', async (request, reply) => {
    const { password } = request.body as { password?: string };

    if (!env.ADMIN_PASSWORD) {
      return reply.code(501).send({
        error: 'Admin password not configured',
        message: 'Set ADMIN_PASSWORD in your environment variables.',
      });
    }

    if (!password || password !== env.ADMIN_PASSWORD) {
      return reply.code(401).send({ error: 'Invalid password' });
    }

    // Password valid — return the API key so the dashboard can call protected routes
    return reply.send({ apiKey: env.API_KEY });
  });

  // ─── Routes (each wrapped in register() for hook encapsulation) ───

  app.register(async (instance) => registerWebhookRoutes(instance));
  app.register(async (instance) => registerFacebookWebhookRoutes(instance));
  app.register(async (instance) => registerAuditLeadRoutes(instance));
  app.register(async (instance) => registerTenantRoutes(instance));
  app.register(async (instance) => registerBookingRoutes(instance));
  app.register(async (instance) => registerCampaignRoutes(instance));
  app.register(async (instance) => registerAnalyticsRoutes(instance));
  app.register(async (instance) => registerTrainingRoutes(instance));
  app.register(async (instance) => registerBillingRoutes(instance));
  app.register(async (instance) => registerStripeWebhookRoutes(instance));
  app.register(async (instance) => registerPortalRoutes(instance));
  app.register(async (instance) => registerReviewRoutes(instance));
  app.register(async (instance) => registerAuthRoutes(instance));
  app.register(async (instance) => registerContactRoutes(instance));
  app.register(async (instance) => registerAdminRoutes(instance));

  // Web chat widget — open CORS so any site can embed it.
  // We use an onSend hook (runs AFTER the root @fastify/cors plugin) so we
  // can reliably override the restrictive CORS and CSP headers.  Preflight
  // OPTIONS are already handled by the root onRequest hook above.
  app.register(async (instance) => {
    instance.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type');
      // credentials:true + origin:* is invalid per CORS spec — remove it
      reply.removeHeader('Access-Control-Allow-Credentials');
      // Remove CSP so the widget script can run on any embedding site
      reply.removeHeader('Content-Security-Policy');
      return payload;
    });
    registerWebChatRoutes(instance);
  });

  // ─── Client Portal (React SPA) ─────────────────────────────
  const portalDistDir = path.join(__dirname, '..', 'client', 'dist');

  if (fs.existsSync(portalDistDir)) {
    // Serve static assets from Vite build output.
    // wildcard: false prevents @fastify/static from registering its own
    // catch-all GET /portal/* so we can add an SPA fallback route below.
    const fastifyStatic = await import('@fastify/static');
    await app.register(fastifyStatic.default, {
      root: portalDistDir,
      prefix: '/portal/',
      decorateReply: false,
      wildcard: false,
    });

    const serveIndex = async (_request: any, reply: any) => {
      const indexPath = path.join(portalDistDir, 'index.html');
      const html = fs.readFileSync(indexPath, 'utf-8');
      return reply.type('text/html').send(html);
    };

    // SPA fallback — serve index.html for all /portal/* routes not matching a file
    app.get('/portal/*', serveIndex);

    // Also handle exact /portal route
    app.get('/portal', serveIndex);
  }

  // ─── Error Handler ────────────────────────────────────────

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    logger.error({ err: error, url: request.url, method: request.method }, 'Request error');

    if (error.validation) {
      return reply.code(400).send({ error: 'Validation error', details: error.message });
    }

    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : error.message,
    });
  });

  // ─── Not Found Handler ────────────────────────────────────

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Route not found', path: request.url });
  });

  return app;
}
