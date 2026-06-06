import { drizzle } from 'drizzle-orm/node-postgres';
import { equipment } from '../../../../db/schema/equipment.js';

const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  throw new Error('DATABASE_URL or CORE_API_DB_URL must be set');
}

export const db = drizzle(rawUrl);
export { equipment };
