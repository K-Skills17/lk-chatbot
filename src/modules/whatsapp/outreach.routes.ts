import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { webhookAuthMiddleware } from '../../middleware/webhook-auth';

interface TagBody {
  instanceName: string;
  phone: string;
}

export function registerOutreachRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', webhookAuthMiddleware);

  /**
   * POST /api/outreach/tag
   * Called by turma1_sender.py after each successful send.
   * Upserts the contact with tags: ['outreach'] so the webhook handler
   * skips AI intake processing for this phone number.
   */
  app.post(
    '/api/outreach/tag',
    async (request: FastifyRequest<{ Body: TagBody }>, reply: FastifyReply) => {
      const { instanceName, phone } = request.body;

      if (!instanceName || !phone) {
        return reply.code(400).send({ error: 'instanceName and phone are required' });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { evolutionInstanceId: instanceName, status: 'active' },
      });

      if (!tenant) {
        logger.warn({ instanceName }, 'Outreach tag: tenant not found');
        return reply.code(404).send({ error: 'Tenant not found' });
      }

      const existing = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId: tenant.id, phone } },
        select: { tags: true },
      });

      const tags = Array.from(new Set([...(existing?.tags ?? []), 'outreach']));

      await prisma.contact.upsert({
        where: { tenantId_phone: { tenantId: tenant.id, phone } },
        update: { tags, lastContactAt: new Date() },
        create: {
          tenantId: tenant.id,
          phone,
          leadStatus: 'outreach',
          tags,
        },
      });

      logger.info({ phone, tenant: tenant.businessName }, 'Contact tagged as outreach');
      return reply.send({ ok: true });
    },
  );
}
