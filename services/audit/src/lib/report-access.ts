import type { UserRole } from '@mat-inspect/shared-types';

// Auditor and manager exports, per DEV-38's ticket description; supervisor and admin included too
// (API_REFERENCE.md's documented icon and the general "who manages compliance" set). operator is
// deliberately excluded - an operator has no reason to pull a compliance export (least privilege,
// same reasoning as ai/transcribe.ts restricting the reverse case to operator only).
//
// Shared by every /reports route so a role added here cannot drift out of sync between routes the
// way it did before this file existed: auditor was present on these but missing from core-api's
// inspection/equipment read routes (DEV-113), and this codebase has no centralized permission
// matrix (ADR 0021's own stated risk) to catch that structurally.
export const REPORT_ROLES = ['supervisor', 'manager', 'auditor', 'admin'] as const;

// Roles that may view or download any job, not only their own - a manager/auditor/admin auditing
// what exports have been run needs this; supervisor does not (it can start an export but not
// inspect anyone else's).
const VIEW_ANY_JOB_ROLES: readonly UserRole[] = ['manager', 'auditor', 'admin'];

export const canViewAnyReportJob = (roles: UserRole[]): boolean =>
  roles.some((role) => VIEW_ANY_JOB_ROLES.includes(role));
