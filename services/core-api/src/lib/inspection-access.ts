import type { UserRole } from '@mat-inspect/shared-types';

// Roles that may read every operator's inspections (the dashboard audience: fleet grid, drilldown,
// audit). An operator without one of these is scoped to their own records only: the inspection
// list can enumerate any operator by operatorId, and a detail carries VOICE_TRANSCRIBED notes,
// which are biometric-derived PII under FOIP (CLAUDE.md). Roles are not hierarchical (ADR/DEV-30),
// so this is an explicit membership test, not a rank comparison.
const ALL_INSPECTIONS_READ_ROLES: readonly UserRole[] = ['supervisor', 'manager', 'admin'];

// True when the caller may read inspections belonging to any operator. False for an operator-only
// caller, who must be restricted to their own operatorId.
export const canReadAllInspections = (roles: UserRole[]): boolean =>
  roles.some((role) => ALL_INSPECTIONS_READ_ROLES.includes(role));
