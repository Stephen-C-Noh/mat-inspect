import { canonicalJson, sha256Hex } from '@mat-inspect/shared-crypto';
import type { InspectionResult, NotesSource } from '@mat-inspect/shared-types';

export type ContentHashResponse = {
  itemKey: string;
  value: unknown;
  passed: boolean;
  notes: string | null;
  notesSource: NotesSource | null;
};

export type ContentHashInput = {
  inspectionId: string;
  equipmentId: string;
  operatorId: string;
  templateId: string;
  templateVersion: number;
  result: InspectionResult;
  submittedAt: string;
  responses: ContentHashResponse[];
};

// ADR 0008: content_hash = sha256(canonical_json(inspection + ordered responses + result)).
// Sorting by itemKey makes the hash independent of read/insert order, which matters because a
// later verifier reconstructs this same input by querying inspection_responses fresh (Postgres
// makes no order guarantee on a plain SELECT). Sealed once at submit time into the outbox
// payload; a later edit to any response is impossible (the immutability triggers block it), but
// recomputing this function from core_db and comparing to the sealed value is how a bypass of
// those triggers would be detected.
export const computeInspectionContentHash = (input: ContentHashInput): string => {
  const orderedResponses = [...input.responses].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  return sha256Hex(canonicalJson({ ...input, responses: orderedResponses }));
};
