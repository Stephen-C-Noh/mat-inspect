import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { equipment } from './schema/equipment';

const { Pool } = pg;

const EQUIPMENT_RECORDS = [
  {
    assetTag: 'MAT-OC-001',
    name: 'Overhead Crane 1',
    type: 'OVERHEAD_CRANE' as const,
    location: 'MAT Bay A',
  },
  {
    assetTag: 'MAT-OC-002',
    name: 'Overhead Crane 2',
    type: 'OVERHEAD_CRANE' as const,
    location: 'MAT Bay A',
  },
  {
    assetTag: 'MAT-OC-003',
    name: 'Overhead Crane 3',
    type: 'OVERHEAD_CRANE' as const,
    location: 'MAT Bay B',
  },
  {
    assetTag: 'MAT-OC-004',
    name: 'Overhead Crane 4',
    type: 'OVERHEAD_CRANE' as const,
    location: 'MAT Bay B',
  },
  {
    assetTag: 'MAT-TR-001',
    name: 'Truck 1',
    type: 'TRUCK' as const,
    location: 'MAT Yard',
  },
  {
    assetTag: 'MAT-TR-002',
    name: 'Truck 2',
    type: 'TRUCK' as const,
    location: 'MAT Yard',
  },
  {
    assetTag: 'MAT-PJ-001',
    name: 'Electric Pallet Jack 1',
    type: 'PALLET_JACK' as const,
    location: 'MAT Warehouse',
  },
  {
    assetTag: 'MAT-FL-001',
    name: 'Forklift 1',
    type: 'FORKLIFT' as const,
    location: 'MAT Warehouse',
  },
  {
    assetTag: 'MAT-FL-002',
    name: 'Forklift 2',
    type: 'FORKLIFT' as const,
    location: 'MAT Warehouse',
  },
  {
    assetTag: 'MAT-FL-003',
    name: 'Forklift 3',
    type: 'FORKLIFT' as const,
    location: 'MAT Yard',
  },
  // as const narrows type fields to literals so Drizzle's insert accepts them as enum values.
] as const;

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('DATABASE_URL or CORE_API_DB_URL must be set\n');
  process.exit(1);
}

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);

const seed = async () => {
  process.stdout.write('Seeding equipment records...\n');

  await db
    .insert(equipment)
    .values(EQUIPMENT_RECORDS.map((r) => ({ ...r })))
    .onConflictDoNothing({ target: equipment.assetTag });

  process.stdout.write(`Inserted ${EQUIPMENT_RECORDS.length} equipment records.\n`);
  await pool.end();
};

seed().catch((err) => {
  process.stderr.write(`Seed failed: ${String(err)}\n`);
  process.exit(1);
});
