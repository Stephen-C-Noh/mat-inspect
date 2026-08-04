// Package entry for @mat-inspect/db. Re-exports the Drizzle schema so consumers
// import via the package name and resolve to the emitted output, not a deep
// relative path into this project (DEV-28).
export * from './schema/equipment.js';
export * from './schema/users.js';
export * from './schema/checklist-templates.js';
export * from './schema/inspections.js';
export * from './schema/outbox.js';
export * from './schema/idempotency-keys.js';
export * from './schema/defects.js';
export * from './schema/notification-dismissals.js';
