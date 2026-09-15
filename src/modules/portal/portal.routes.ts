import { FastifyInstance } from 'fastify';

// Portal routes are handled by the static file server and SPA fallback in app.ts.
// All /portal/* requests serve the React SPA (client/dist/index.html).
export function registerPortalRoutes(_app: FastifyInstance): void {}
