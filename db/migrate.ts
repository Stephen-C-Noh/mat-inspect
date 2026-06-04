import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// CORE_API_DB_URL uses the Docker internal hostname; replace it with localhost
// when the script runs outside the container (local drizzle tooling, CI seed step).
const rawUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', '@localhost:');

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
