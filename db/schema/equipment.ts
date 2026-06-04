import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const equipmentTypeEnum = pgEnum('equipment_type', [
  'OVERHEAD_CRANE',
  'TRUCK',
  'PALLET_JACK',
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
  name: text('name').notNull(),
  type: equipmentTypeEnum('type').notNull(),
  // New equipment requires a passing inspection before it can become READY (OHS s.257).
  status: equipmentStatusEnum('status').notNull().default('AWAITING_INSPECTION'),
  location: text('location'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
