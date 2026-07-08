import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { defectSchema, listDefectsQuerySchema } from '@mat-inspect/shared-schemas';
import { db, defects } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeDefect } from './serialize.js';

// Backs the PWA lockout tag (equipmentId + status=OPEN) and the dashboard defect inbox
// (status filter). The fleet is about 10 machines, so the filtered set fits one response;
// cursor pagination is deferred with the rest of the list endpoints.
export const listDefectsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/defects',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: {
        querystring: listDefectsQuerySchema,
        response: { 200: z.array(defectSchema) },
      },
    },
    async (req, reply) => {
      const query = listDefectsQuerySchema.parse(req.query);

      const filters: SQL[] = [];
      if (query.equipmentId) filters.push(eq(defects.equipmentId, query.equipmentId));
      if (query.status) filters.push(eq(defects.status, query.status));

      const rows = await db
        .select()
        .from(defects)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(defects.openedAt));

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'defects list fetched',
      );

      return reply.code(200).send(rows.map(serializeDefect));
    },
  );
};
