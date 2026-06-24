import { drizzle } from 'drizzle-orm/node-postgres';
import {
  equipment,
  checklistTemplates,
  inspections,
  inspectionResponses,
  outbox,
  idempotencyKeys,
} from '@mat-inspect/db';
import { config } from '../lib/config.js';

// Connection string is resolved and validated centrally (postgres:// shape, docker host
// rewrite). See config.ts and ADR 0015.
export const db = drizzle(config().databaseUrl);
export { equipment, checklistTemplates, inspections, inspectionResponses, outbox, idempotencyKeys };
