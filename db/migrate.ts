import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
// CORE_MIGRATOR_DB_URL runs as core_api_migrator (DDL only), a role separate from the
// core_api_writer connection the running service uses (DEV-146, mirrors
// services/audit/db/migrate.ts's AUDIT_MIGRATOR_DB_URL / audit_migrator split). DATABASE_URL and
// CORE_API_DB_URL remain as fallbacks for testcontainers-based integration tests and any other
// setup that only has a single admin connection string, not a scoped migrator role.
const rawUrl =
  process.env['CORE_MIGRATOR_DB_URL']?.replace('@postgres:', `@${localHost}:`) ??
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('CORE_MIGRATOR_DB_URL, DATABASE_URL, or CORE_API_DB_URL must be set\n');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: rawUrl });
const db = drizzle(pool);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  process.stdout.write('Migrations applied\n');
} catch (err) {
  process.stderr.write(`Migration failed: ${String(err)}\n`);
  process.exitCode = 1;
} finally {
  // Always close the pool so the process can exit cleanly, even on failure.
  await pool.end();
}
