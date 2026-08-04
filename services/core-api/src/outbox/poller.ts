import { asc, eq, isNull } from 'drizzle-orm';
import { db, outbox } from '../db/index.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

// "A simple interval loop" (ADR 0008): no per-row retry count, backoff, or dead-letter queue.
// Every unprocessed row is retried every tick, and delivery is at-least-once because the audit
// chain dedupes by source_event_id on its side — a redelivered row is a safe no-op there. A
// single poller process needs no row claiming (FOR UPDATE / SKIP LOCKED); if this ever runs with
// more than one core-api instance, the worst case is a duplicate delivery attempt, which the
// idempotent receiver already absorbs.
const BATCH_SIZE = 50;

type OutboxRow = typeof outbox.$inferSelect;

// INSPECTION_SUBMITTED, DEFECT_OPENED, and EQUIPMENT_STATUS_CHANGED/BLOCKING_INSPECTION_FAILURE
// (all three producers in inspections/submit.ts) share the operatorId/inspectionId shape below.
// Two other producers use different fields, so this must branch instead of assuming that shape
// for every event type (DEV-142: both retried forever and never reached audit_events, since
// actorId/resourceId came out undefined and the Audit Service's ingest schema requires both as
// non-optional UUIDs):
//   - return-to-service.ts's EQUIPMENT_STATUS_CHANGED/RETURN_TO_SERVICE payload has approvedBy
//     and equipmentId, no operatorId or inspectionId.
//   - defects/resolve.ts's DEFECT_RESOLVED payload has resolvedBy instead of operatorId (it does
//     have inspectionId, so resourceType/resourceId stay the default).
const buildIngestBody = (row: OutboxRow): Record<string, unknown> => {
  const payload = row.payload as Record<string, unknown>;

  let actorId: unknown = payload['operatorId'];
  let resourceType = 'INSPECTION';
  let resourceId: unknown = payload['inspectionId'];

  if (row.eventType === 'DEFECT_RESOLVED') {
    actorId = payload['resolvedBy'];
  } else if (
    row.eventType === 'EQUIPMENT_STATUS_CHANGED' &&
    payload['reason'] === 'RETURN_TO_SERVICE'
  ) {
    actorId = payload['approvedBy'];
    resourceType = 'EQUIPMENT';
    resourceId = payload['equipmentId'];
  }

  return {
    sourceEventId: row.id,
    action: row.eventType,
    actorId,
    resourceType,
    resourceId,
    // The outbox row commits in the same transaction as the source-of-truth row, so its
    // createdAt is effectively the event time; the outbox payload deliberately stays minimal
    // (DEV-18) rather than duplicating a timestamp column onto every event.
    occurredAt: row.createdAt.toISOString(),
    payloadSummary: payload,
  };
};

const deliver = async (
  row: OutboxRow,
  cfg: { auditServiceUrl: string | undefined; auditIngestToken: string | undefined },
): Promise<boolean> => {
  try {
    const res = await fetch(`${cfg.auditServiceUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.auditIngestToken}`,
      },
      body: JSON.stringify(buildIngestBody(row)),
    });
    if (!res.ok) {
      logger.warn(
        { outboxId: row.id, status: res.status },
        'outbox delivery rejected by audit service',
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ outboxId: row.id, err }, 'outbox delivery failed; will retry next tick');
    return false;
  }
};

export const runOutboxPollTick = async (): Promise<void> => {
  const cfg = config();
  const rows = await db
    .select()
    .from(outbox)
    .where(isNull(outbox.processedAt))
    .orderBy(asc(outbox.createdAt))
    .limit(BATCH_SIZE);

  if (rows.length > 0) {
    // Outbox lag: how stale the oldest undelivered row is. ARCHITECTURE.md calls out that a
    // stalled poller must be noticed; this is the observable signal for that (Pino -> Azure
    // Monitor), without building a separate alerting pipeline. Escalating to warn past the
    // threshold (DEV-40 AC3) is what actually makes a stalled poller noticed, rather than just
    // logged alongside every routine tick.
    const oldestLagMs = Date.now() - rows[0]!.createdAt.getTime();
    const fields = { unprocessed: rows.length, oldestLagMs };
    if (oldestLagMs > cfg.outboxLagWarnMs) {
      logger.warn(fields, 'outbox backlog exceeds lag threshold');
    } else {
      logger.info(fields, 'outbox poll tick');
    }
  }

  for (const row of rows) {
    const delivered = await deliver(row, cfg);
    if (delivered) {
      await db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.id, row.id));
    }
  }
};

export const startOutboxPoller = (): { stop: () => void } => {
  const intervalMs = config().outboxPollIntervalMs;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Recursive setTimeout, not setInterval: a slow tick (e.g. the audit service is unreachable
  // and every fetch times out) cannot overlap with the next one.
  const run = (): void => {
    void runOutboxPollTick()
      .catch((err: unknown) => logger.error({ err }, 'outbox poll tick failed'))
      .finally(() => {
        if (!stopped) timer = setTimeout(run, intervalMs);
      });
  };

  run();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
