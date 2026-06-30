import type { Equipment } from '@mat-inspect/shared-schemas';
import type { EquipmentStatus } from '@mat-inspect/shared-types';
import type { equipment } from '../../db/index.js';

type EquipmentRow = typeof equipment.$inferSelect;

// Maps a Drizzle equipment row to the shared client contract. Postgres timestamp columns
// arrive as Date objects; the equipmentSchema response is JSON, so dates become ISO strings.
// `status` is the computed value from computeReadiness (ADR 0006), not row.status directly:
// READY/AWAITING_INSPECTION are never stored, only OUT_OF_SERVICE/RETIRED are sticky overrides.
export const serializeEquipment = (row: EquipmentRow, status: EquipmentStatus): Equipment => ({
  id: row.id,
  assetTag: row.assetTag,
  name: row.name,
  type: row.type,
  make: row.make,
  model: row.model,
  serialNumber: row.serialNumber,
  location: row.location,
  status,
  currentStatusSince: row.currentStatusSince.toISOString(),
  manufacturerSpecsUrl: row.manufacturerSpecsUrl,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
