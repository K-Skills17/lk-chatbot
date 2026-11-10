import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuthMiddleware } from '../../middleware/jwt-auth';
import { prisma } from '../../config/database';

function superadminOnly(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const user = (request as any).jwtUser;
  if (user?.role !== 'superadmin') {
    reply.code(403).send({ error: 'Superadmin access required' });
    return;
  }
  done();
}

export function registerPortalAdminRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', jwtAuthMiddleware);
  app.addHook('preHandler', superadminOnly);

  // ─── List all tenants with portal users ─────────────────────
  app.get('/api/portal-admin/tenants', async (_request, reply) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        businessName: true,
        whatsappNumber: true,
        status: true,
        plan: true,
        aiConfig: true,
        createdAt: true,
        users: {
          select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
        },
      },
    });
    return reply.send({ tenants });
  });

  // ─── Create tenant + portal user ────────────────────────────
  app.post('/api/portal-admin/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      businessName?: string;
      whatsappNumber?: string;
      portalEmail?: string;
      portalPassword?: string;
      plan?: string;
      businessType?: string;
    };

    if (!body.businessName || !body.whatsappNumber || !body.portalEmail || !body.portalPassword) {
      return reply.code(400).send({ error: 'Missing required fields: businessName, whatsappNumber, portalEmail, portalPassword' });
    }

    if (body.portalPassword.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }

    // Check for duplicate
    const existing = await prisma.tenant.findFirst({
      where: {
        OR: [
          { businessName: body.businessName },
          { whatsappNumber: body.whatsappNumber },
        ],
      },
    });
    if (existing) {
      return reply.code(409).send({ error: `Tenant already exists: "${existing.businessName}"` });
    }

    const instanceName = `${body.businessName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const tenant = await prisma.tenant.create({
      data: {
        businessName: body.businessName,
        whatsappNumber: body.whatsappNumber,
        evolutionInstanceId: instanceName,
        timezone: 'America/Sao_Paulo',
        businessHours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
        aiConfig: {
          model: 'claude',
          temperature: 0.7,
          tone: 'friendly',
          businessDescription: `Assistente virtual de ${body.businessName}.`,
          greeting: `Olá! Bem-vindo ao ${body.businessName}. Como posso ajudar?`,
          ...(body.businessType ? { businessType: body.businessType } : {}),
        },
        plan: body.plan ?? 'starter',
        status: 'active',
      },
    });

    const passwordHash = await bcrypt.hash(body.portalPassword, 12);
    const user = await prisma.tenantUser.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        email: body.portalEmail,
        passwordHash,
        name: body.businessName,
        role: 'owner',
      },
    });

    return reply.code(201).send({
      tenant,
      portalUser: { id: user.id, email: user.email, role: user.role },
    });
  });

  // ─── Update tenant config ────────────────────────────────────
  app.patch(
    '/api/portal-admin/tenants/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const body = request.body as {
        status?: string;
        plan?: string;
        businessType?: string;
        whatsappNumber?: string;
      };

      const tenant = await prisma.tenant.findUnique({ where: { id: request.params.tenantId } });
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const updateData: Record<string, any> = {};
      if (body.status) updateData.status = body.status;
      if (body.plan) updateData.plan = body.plan;
      if (body.whatsappNumber) updateData.whatsappNumber = body.whatsappNumber;

      if (body.businessType !== undefined) {
        const currentConfig = (tenant.aiConfig as Record<string, any>) ?? {};
        updateData.aiConfig = {
          ...currentConfig,
          ...(body.businessType ? { businessType: body.businessType } : { businessType: null }),
        };
      }

      const updated = await prisma.tenant.update({
        where: { id: request.params.tenantId },
        data: updateData,
      });

      return reply.send(updated);
    },
  );

  // ─── Create or reset portal user for a tenant ───────────────
  app.post(
    '/api/portal-admin/tenants/:tenantId/portal-user',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const body = request.body as { email?: string; password?: string; name?: string };

      if (!body.email || !body.password) {
        return reply.code(400).send({ error: 'Missing required fields: email, password' });
      }

      if (body.password.length < 8) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters' });
      }

      const tenant = await prisma.tenant.findUnique({ where: { id: request.params.tenantId } });
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const passwordHash = await bcrypt.hash(body.password, 12);
      const existing = await prisma.tenantUser.findUnique({ where: { email: body.email } });

      if (existing) {
        const updated = await prisma.tenantUser.update({
          where: { email: body.email },
          data: { passwordHash, ...(body.name ? { name: body.name } : {}) },
          select: { id: true, email: true, role: true },
        });
        return reply.send({ updated: true, user: updated });
      }

      const user = await prisma.tenantUser.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: request.params.tenantId,
          email: body.email,
          passwordHash,
          name: body.name ?? tenant.businessName,
          role: 'owner',
        },
        select: { id: true, email: true, role: true },
      });

      return reply.code(201).send({ created: true, user });
    },
  );
}
