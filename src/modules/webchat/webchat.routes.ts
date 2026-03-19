import { FastifyInstance } from 'fastify';
import { getOrCreateSession, processWebMessage, getMessages } from './webchat.service';
import { getWidgetScript } from './widget';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { prisma } from '../../config/database';

export function registerWebChatRoutes(app: FastifyInstance): void {

  // ── Embeddable widget script ──────────────────────────────
  app.get('/api/webchat/:tenantId/widget.js', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    // Derive base URL from the actual request when WEBHOOK_BASE_URL is the default localhost
    const baseUrl = env.WEBHOOK_BASE_URL && !env.WEBHOOK_BASE_URL.includes('localhost')
      ? env.WEBHOOK_BASE_URL
      : `${request.protocol}://${request.hostname}`;
    const script = getWidgetScript(tenantId, baseUrl);
    return reply
      .type('application/javascript')
      .header('Cache-Control', 'public, max-age=300')
      .send(script);
  });

  // ── Widget config (public, no auth) ──────────────────────────
  // Reads branding from aiConfig.widgetConfig so no extra DB column is needed.
  app.get('/api/webchat/:tenantId/config', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          businessName: true,
          aiConfig: true,
        },
      });

      if (!tenant) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const aiConfig = (tenant.aiConfig ?? {}) as Record<string, any>;
      const widget = (aiConfig.widgetConfig ?? {}) as Record<string, any>;

      return reply.send({
        primaryColor: widget.primaryColor ?? '#2563eb',
        headerTitle: widget.headerTitle ?? tenant.businessName,
        welcomeMessage: widget.welcomeMessage ?? aiConfig.greeting ?? null,
        position: widget.position ?? 'bottom-right',
        avatarUrl: widget.avatarUrl ?? null,
        bubbleIcon: widget.bubbleIcon ?? 'chat',
      });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Failed to load widget config');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // ── Start or resume a chat session ────────────────────────
  app.post('/api/webchat/:tenantId/session', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { sessionId } = (request.body ?? {}) as { sessionId?: string };

    try {
      const session = await getOrCreateSession(tenantId, sessionId);
      return reply.send({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
      });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Failed to create web chat session');
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Send a message and get AI response ────────────────────
  app.post('/api/webchat/:tenantId/message', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { sessionId, text } = request.body as { sessionId: string; text: string };

    if (!sessionId || !text?.trim()) {
      return reply.code(400).send({ error: 'sessionId and text are required' });
    }

    try {
      const session = await getOrCreateSession(tenantId, sessionId);
      const result = await processWebMessage(session, text.trim());
      return reply.send({
        reply: result.reply,
        sessionId: result.sessionId,
      });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Failed to process web chat message');
      return reply.code(500).send({ error: 'Failed to process message' });
    }
  });

  // ── Get message history for a session ─────────────────────
  app.get('/api/webchat/:tenantId/messages/:sessionId', async (request, reply) => {
    const { tenantId, sessionId } = request.params as { tenantId: string; sessionId: string };

    try {
      const messages = await getMessages(sessionId, tenantId);
      return reply.send({ messages });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Failed to load web chat messages');
      return reply.code(500).send({ error: 'Failed to load messages' });
    }
  });
}
