import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { InspectionResult, NotesSource } from '@mat-inspect/shared-types';

// RFC 8785 (JSON Canonicalization Scheme): fixed key order, fixed number formatting, no
// whitespace. The same logical record always produces the same byte sequence, which is what
// lets two different processes (core-api sealing a content digest, the audit service writing
// and later re-verifying a chain link) hash the same data to the same value (ADR 0008,
// ARCHITECTURE.md 8.4 rule 2). `canonicalize` returns undefined for values that are not valid
// JSON (e.g. containing `undefined` or a function); that case is a caller bug, not a recoverable
// situation, so it throws rather than silently hashing the string "undefined".
export const canonicalJson = (value: unknown): string => {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error('canonicalJson: value is not representable as JSON');
  }
  return result;
};

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

// ARCHITECTURE.md 8.4 rule 4: all timestamps in the hash input are UTC, ISO 8601, with
// microsecond precision, generated once on the writer side and never recomputed differently.
// Date only carries millisecond resolution; this pads to 6 fractional digits so the format is
// fixed regardless of resolution, which is what determinism actually requires here.
export const toCanonicalTimestamp = (date: Date): string =>
  `${date.toISOString().slice(0, -1)}000Z`;

export type ContentHashResponse = {
  itemKey: string;
  value: unknown;
  passed: boolean;
  notes: string | null;
  notesSource: NotesSource | null;
  // Media blob references for this item (ADR 0023). Kept in the array order the operator
  // captured them; Postgres preserves that order in the uuid[] column, so the seal side
  // (submit) and the verify side (audit, reading it back) hash the same bytes. Not sorted, for
  // the same reason value/notes are not: only the multi-row response set needs itemKey sorting.
  photoIds: string[];
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
// makes no order guarantee on a plain SELECT). Sealed once at submit time (core-api) into the
// outbox payload; recomputing this same function from core_db data and comparing it to the value
// sealed in the chain (audit service, DEV-38) is how a bypass of the immutability triggers would
// be detected. Lives here, not in one service's lib/, because both core-api (the sealer) and
// audit (the verifier) must run byte-identical logic or the comparison is meaningless.
export const computeInspectionContentHash = (input: ContentHashInput): string => {
  const orderedResponses = [...input.responses].sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  return sha256Hex(canonicalJson({ ...input, responses: orderedResponses }));
};
