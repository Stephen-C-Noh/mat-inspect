import type { Equipment } from '@mat-inspect/shared-schemas';
import type { equipment } from '../../db/index.js';

type EquipmentRow = typeof equipment.$inferSelect;

// Maps a Drizzle equipment row to the shared client contract. Postgres timestamp columns
// arrive as Date objects; the equipmentSchema response is JSON, so dates become ISO strings.
export const serializeEquipment = (row: EquipmentRow): Equipment => ({
  id: row.id,
  assetTag: row.assetTag,
  name: row.name,
  type: row.type,
  make: row.make,
  model: row.model,
  serialNumber: row.serialNumber,
  location: row.location,
  status: row.status,
  currentStatusSince: row.currentStatusSince.toISOString(),
  manufacturerSpecsUrl: row.manufacturerSpecsUrl,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
