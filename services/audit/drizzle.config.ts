import { defineConfig } from 'drizzle-kit';

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';

// Migrations run as audit_migrator (DDL only; see infra/docker/postgres-init.sh), a separate
// role from the audit_writer connection the running service uses. Fallback uses port 0 so it is
// intentionally non-connectable: db:generate only reads schema files and never connects.
const dbUrl =
  process.env['AUDIT_MIGRATOR_DB_URL']?.replace('@postgres:', `@${localHost}:`) ??
  'postgresql://localhost:0/unused';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/*.ts',
  out: './db/migrations',
  dbCredentials: { url: dbUrl },
});
