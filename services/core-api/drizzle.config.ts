import { defineConfig } from 'drizzle-kit';

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';

// Fallback URL is safe for db:generate, which reads schema files and never connects.
const dbUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`) ??
  `postgresql://${localHost}/core_db`;

export default defineConfig({
  dialect: 'postgresql',
  schema: '../../db/schema/*.ts',
  out: '../../db/migrations',
  dbCredentials: { url: dbUrl },
});
