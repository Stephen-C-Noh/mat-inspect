import { randomUUID } from 'node:crypto';
import { asc, desc, eq, lte, sql } from 'drizzle-orm';
import { canonicalJson, sha256Hex, toCanonicalTimestamp } from '@mat-inspect/shared-crypto';
import type { AuditAction } from '@mat-inspect/shared-schemas';
import { db, auditEvents } from '../db/index.js';
import { isUniqueViolation } from './db-errors.js';

// Documented genesis marker for the first row's prev_hash: a string the same length as a
// SHA-256 hex digest, chosen so the genesis row is structurally indistinguishable from any
// other row when verified (no special-cased "first row" branch in verifyChain).
export const GENESIS_HASH = '0'.repeat(64);

// The Postgres advisory lock key is a fixed string hashed into a lock id; one lock per chain,
// shared by every appendAuditEvent caller (ARCHITECTURE.md 8.4 rule 5).
const CHAIN_LOCK_KEY = 'audit_chain_v1';

type HashInputFields = {
  id: string;
  occurredAt: Date;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payloadSummary: unknown;
  prevHash: string;
};

// ARCHITECTURE.md 8.4 rule 3: the hash input is exactly these eight fields, nothing else. No
// seq, no source_event_id, no created_at — those are not part of the conceptual record this
// system attests to, and seq/created_at can vary with how a row is read or stored.
const computeThisHash = (fields: HashInputFields): string =>
  sha256Hex(
    canonicalJson({
      id: fields.id,
      timestamp: toCanonicalTimestamp(fields.occurredAt),
      actorId: fields.actorId,
      action: fields.action,
      resourceType: fields.resourceType,
      resourceId: fields.resourceId,
      payloadSummary: fields.payloadSummary,
      prevHash: fields.prevHash,
    }),
  );

export type AppendAuditEventInput = {
  sourceEventId: string;
  action: AuditAction;
  actorId: string;
  resourceType: string;
  resourceId: string;
  occurredAt: Date;
  payloadSummary: Record<string, string | number | boolean | null>;
};

export type AppendedAuditEvent = {
  id: string;
  seq: number;
};

const findBySourceEventId = async (
  sourceEventId: string,
): Promise<AppendedAuditEvent | undefined> => {
  const [existing] = await db
    .select({ id: auditEvents.id, seq: auditEvents.seq })
    .from(auditEvents)
    .where(eq(auditEvents.sourceEventId, sourceEventId))
    .limit(1);
  return existing;
};

// Appends one event to the chain, or no-ops if sourceEventId was already recorded (at-least-once
// delivery from the outbox poller; the chain dedupes by event id, ADR 0008). Chain extension
// (reading the tail, computing this_hash, inserting) is serialized by a Postgres advisory lock
// held for the transaction's lifetime, so concurrent callers cannot both read the same prev_hash
// and fork the chain.
export const appendAuditEvent = async (
  input: AppendAuditEventInput,
): Promise<{ deduped: boolean; event: AppendedAuditEvent }> => {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${CHAIN_LOCK_KEY}))`);

      const [existing] = await tx
        .select({ id: auditEvents.id, seq: auditEvents.seq })
        .from(auditEvents)
        .where(eq(auditEvents.sourceEventId, input.sourceEventId))
        .limit(1);
      if (existing) {
        return { deduped: true, event: existing };
      }

      const [tail] = await tx
        .select({ thisHash: auditEvents.thisHash })
        .from(auditEvents)
        .orderBy(desc(auditEvents.seq))
        .limit(1);
      const prevHash = tail?.thisHash ?? GENESIS_HASH;

      const id = randomUUID();
      const thisHash = computeThisHash({
        id,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payloadSummary: input.payloadSummary,
        prevHash,
      });

      const [row] = await tx
        .insert(auditEvents)
        .values({
          id,
          sourceEventId: input.sourceEventId,
          prevHash,
          thisHash,
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          payloadSummary: input.payloadSummary,
        })
        .returning({ id: auditEvents.id, seq: auditEvents.seq });

      return { deduped: false, event: row! };
    });
  } catch (err) {
    // Race fallback: the advisory lock should make this unreachable, but the unique constraint
    // on source_event_id is the backstop if two redeliveries land in overlapping transactions.
    if (isUniqueViolation(err)) {
      const existing = await findBySourceEventId(input.sourceEventId);
      if (existing) return { deduped: true, event: existing };
    }
    throw err;
  }
};

export type ChainVerificationResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAtSeq: number; reason: string };

export type AuditEventRow = typeof auditEvents.$inferSelect;

export type ChainSegmentVerification =
  | { ok: true; checked: number; rows: AuditEventRow[] }
  | { ok: false; checked: number; brokenAtSeq: number; reason: string; rows: AuditEventRow[] };

// Genesis-to-uptoSeq walk (or the full table when uptoSeq is omitted), recomputing each row's
// this_hash from its stored fields and checking it both matches what's stored and chains to the
// previous row's this_hash. Shared by verifyChain (startup, full table) and the report export
// path (DEV-38, bounded by the newest relevant event's seq): both need the same walk, and the
// report path additionally needs the rows themselves to embed as an independently verifiable
// segment, which a filtered-by-resource-id query could not give without breaking the
// prevHash/thisHash linkage (unrelated interleaved events would be missing from that view).
export const verifyChainSegment = async (uptoSeq?: number): Promise<ChainSegmentVerification> => {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(uptoSeq !== undefined ? lte(auditEvents.seq, uptoSeq) : undefined)
    .orderBy(asc(auditEvents.seq));

  let expectedPrevHash = GENESIS_HASH;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.prevHash !== expectedPrevHash) {
      return {
        ok: false,
        checked: i,
        brokenAtSeq: row.seq,
        reason: `prev_hash mismatch at seq ${row.seq}: expected ${expectedPrevHash}, found ${row.prevHash}`,
        rows,
      };
    }

    const recomputed = computeThisHash({
      id: row.id,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      payloadSummary: row.payloadSummary,
      prevHash: row.prevHash,
    });
    if (recomputed !== row.thisHash) {
      return {
        ok: false,
        checked: i,
        brokenAtSeq: row.seq,
        reason: `this_hash at seq ${row.seq} does not match the recomputed hash`,
        rows,
      };
    }

    expectedPrevHash = row.thisHash;
  }

  return { ok: true, checked: rows.length, rows };
};

// Full table walk. Run at startup (server.ts); ARCHITECTURE.md 8.4 rule 7 calls for verifying the
// last 1000 events on startup and a nightly full-chain job. This does a full walk every time
// instead: the dataset is capstone-scale (the AC's own integrity test targets 10,000 events,
// milliseconds to walk), and no scheduler exists in this codebase for a separate nightly job.
export const verifyChain = async (): Promise<ChainVerificationResult> => {
  const result = await verifyChainSegment();
  return result.ok
    ? { ok: true, checked: result.checked }
    : {
        ok: false,
        checked: result.checked,
        brokenAtSeq: result.brokenAtSeq,
        reason: result.reason,
      };
};
