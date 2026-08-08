import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// DB_HOST_LOCAL: set to localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack)
// when running from the host machine, where the "postgres" hostname used inside the container
// network does not resolve. Must stay unset for in-container runs (compose does not set it):
// "@postgres:" is already the correct, resolvable host there, and defaulting this rewrite to
// localhost breaks the in-container migrate path with a misleading ECONNREFUSED (DEV-149).
const localHost = process.env['DB_HOST_LOCAL'];
const rewriteHost = (url: string | undefined) =>
  localHost && url ? url.replace('@postgres:', `@${localHost}:`) : url;
// CORE_MIGRATOR_DB_URL runs as core_api_migrator (DDL only), a role separate from the
// core_api_writer connection the running service uses (DEV-146, mirrors
// services/audit/db/migrate.ts's AUDIT_MIGRATOR_DB_URL / audit_migrator split). DATABASE_URL and
// CORE_API_DB_URL remain as fallbacks for testcontainers-based integration tests and any other
// setup that only has a single admin connection string, not a scoped migrator role.
const rawUrl =
  rewriteHost(process.env['CORE_MIGRATOR_DB_URL']) ??
  process.env['DATABASE_URL'] ??
  rewriteHost(process.env['CORE_API_DB_URL']);

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
  // A permission-denied error here almost always means this ran with core_api_writer's
  // connection (DATABASE_URL/CORE_API_DB_URL fallback) instead of core_api_migrator's. Say so
  // instead of leaving a raw Postgres error as the only clue (ADR 0015's fail-fast-with-a-named-
  // var philosophy).
  if (!process.env['CORE_MIGRATOR_DB_URL'] && /permission denied/i.test(String(err))) {
    process.stderr.write(
      'Hint: CORE_MIGRATOR_DB_URL is not set, so this ran as core_api_writer, which cannot ' +
        'run DDL. Set CORE_MIGRATOR_DB_URL to a core_api_migrator connection string.\n',
    );
  }
  process.exitCode = 1;
} finally {
  // Always close the pool so the process can exit cleanly, even on failure.
  await pool.end();
}
