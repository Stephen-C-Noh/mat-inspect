import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const equipmentTypeEnum = pgEnum('equipment_type', [
  'OVERHEAD_CRANE',
  'TRUCK',
  'ELECTRIC_PALLET_JACK',
  'FORKLIFT',
]);

export const equipmentStatusEnum = pgEnum('equipment_status', [
  'READY',
  'AWAITING_INSPECTION',
  'OUT_OF_SERVICE',
  'RETIRED',
]);

export const equipment = pgTable('equipment', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetTag: text('asset_tag').notNull().unique(),
  // name is a human-friendly label shown in the dashboard and PWA (e.g. "Overhead Crane 1").
  name: text('name').notNull(),
  type: equipmentTypeEnum('type').notNull(),
  make: text('make'),
  model: text('model'),
  serialNumber: text('serial_number'),
  manufacturerSpecsUrl: text('manufacturer_specs_url'),
  // New equipment requires a passing inspection before it can become READY (OHS s.257).
  status: equipmentStatusEnum('status').notNull().default('AWAITING_INSPECTION'),
  // Tracks when status last changed; the dashboard shows "current status, since when".
  currentStatusSince: timestamp('current_status_since', { withTimezone: true })
    .notNull()
    .defaultNow(),
  location: text('location'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
