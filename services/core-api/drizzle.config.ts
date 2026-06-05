import { defineConfig } from 'drizzle-kit';

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';

// Fallback uses port 0 so it is intentionally non-connectable: db:generate only
// reads schema files and never connects, while db:migrate and db:push require a
// real DATABASE_URL or CORE_API_DB_URL and should fail fast rather than touch a
// local database that happens to be listening on the default port.
const dbUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`) ??
  'postgresql://localhost:0/unused';

export default defineConfig({
  dialect: 'postgresql',
  schema: '../../db/schema/*.ts',
  out: '../../db/migrations',
  dbCredentials: { url: dbUrl },
});
