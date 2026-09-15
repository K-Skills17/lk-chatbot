import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerPortalRoutes(app: FastifyInstance): void {
  // Redirect old HTML portal URLs to the React SPA login page
  app.get(
    '/portal/:tenantId',
    async (_request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      return reply.redirect('/portal/login', 301);
    },
  );
}