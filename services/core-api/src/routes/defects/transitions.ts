import type { DefectStatus } from '@mat-inspect/shared-types';
import { httpError } from '../../lib/http-error.js';

// Defect state machine (DEV-20). The happy path is OPEN -> ACKNOWLEDGED -> IN_REPAIR ->
// RESOLVED; REJECTED is the terminal for a dismissed defect and is reachable from any
// non-terminal state. RESOLVED and REJECTED are terminal. Return-to-service is a separate
// action on the equipment (ADR 0006), not a defect transition, so it is not modelled here.
// Pure logic only (no db import) so it can be unit tested without a database.
export const DEFECT_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'REJECTED'],
  ACKNOWLEDGED: ['IN_REPAIR', 'REJECTED'],
  IN_REPAIR: ['RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

// Throws 409 when the requested move is not in the state machine. Only DEFECT_RESOLVED is
// emitted to the outbox (the audit action enum tracks DEFECT_OPENED and DEFECT_RESOLVED only,
// ARCHITECTURE.md Section 6), so ACKNOWLEDGED/IN_REPAIR/REJECTED are status-only writes.
export const assertCanTransition = (from: DefectStatus, to: DefectStatus): void => {
  if (!DEFECT_TRANSITIONS[from].includes(to)) {
    throw httpError(409, 'DEFECT_INVALID_TRANSITION', `Cannot move defect from ${from} to ${to}`);
  }
};
