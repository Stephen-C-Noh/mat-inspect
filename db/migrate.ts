import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('DATABASE_URL or CORE_API_DB_URL must be set\n');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: rawUrl });
const db = drizzle(pool);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
process.stdout.write('Migrations applied\n');
await pool.end();
