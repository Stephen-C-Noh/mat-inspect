# ADR 0008: Transactional Outbox and Content Digest for Audit Delivery

Date: 2026-06-09
Status: Accepted

## Context

The audit design specifies a single writer: only the Audit Service has INSERT privilege
on `audit_events`, and every other service "emits an event over the bus or HTTP." Two
problems follow.

First, there is no message bus in the stack. The services are Caddy, Core API, Media,
Audit, AI, PostgreSQL, and Azurite. "Over the bus or HTTP" is therefore HTTP, an option
the architecture never provisioned a broker for.

Second, an inspection submit writes to two places that cannot share a transaction: the
Inspection rows in core_db, and the audit event in audit_db via the Audit Service. This
is the dual-write problem. If Core API commits the inspection and the audit call then
fails, the inspection has no audit event. If the audit call is synchronous and blocking,
the Audit Service being down blocks operators from submitting inspections, which violates
the principle that safety workflows do not depend on non-critical services.

Dropping the per-record HMAC (ADR 0007) makes the audit chain the sole tamper-evidence
mechanism. A dropped audit event no longer degrades the evidentiary story for a record,
it removes it: the Inspection becomes a plain row that someone could have typed in later.
Delivery is therefore load-bearing, not a robustness nicety.

Separately, the chain hashes a redacted `payload_summary` plus metadata. It proves an
Inspection with a given id was submitted by a given actor at a given time. It does not
prove the answers have not changed, because the answers live in core_db, outside the
chain. With the HMAC gone, content integrity is otherwise unprotected.

## Decision

Three measures.

1. **Transactional outbox.** In the same core_db transaction that inserts the Inspection
   and its responses, Core API inserts a row into an `outbox` table. The transaction
   commits atomically: either both land or neither does. A poller (a simple interval loop)
   reads unprocessed outbox rows and delivers them to the Audit Service, marking each
   done on success. Delivery is at-least-once; the audit chain deduplicates by event id,
   so redelivery is idempotent.

2. **Content digest in the chain.** For `INSPECTION_SUBMITTED`, the event payload includes
   `content_hash = sha256(canonical_json(inspection + ordered responses + result))`,
   serialized with the same RFC 8785 canonicalization the chain already uses. A hash is
   not PII, so it does not violate the no-PII rule for the audit log. To verify later,
   recompute the digest from the core_db row and compare it to the value sealed in the
   chain. A post-hoc edit to any response makes the recomputed digest diverge, which
   detects the tampering.

3. **Defense-in-depth triggers.** Add the UPDATE and DELETE blocking triggers that
   `audit_events` already has to the `inspections` and `inspection_responses` tables.
   The digest detects tampering; the triggers prevent the casual case.

## Consequences

Positive: no dual-write hole, the Inspection and its intent-to-audit commit atomically.
Audit Service downtime does not block operators; outbox rows wait and are delivered on
recovery. Content tampering is both prevented (triggers) and detectable (digest). No
message broker is added.

Negative: eventual consistency. There is a short window after an Inspection commits
before its event is in the chain. For a tamper-evidence log, as opposed to a real-time
enforcement gate, this is acceptable and is stated as such. The team owns and operates a
poller and an outbox table, and must monitor outbox lag so a stalled poller is noticed.

## Alternatives Considered

Synchronous best-effort HTTP with a reconciliation job: call the Audit Service in the
request and reconcile missing events later. Rejected. A single Audit outage permanently
de-evidences every inspection submitted during it, and with the HMAC gone there is no
fallback layer.

Message broker (Redis, RabbitMQ, NATS): a real bus for event delivery. Rejected. The
infrastructure is not provisioned, it adds an operational component to a single-host
deployment, and the outbox achieves the same delivery guarantee with one table and one
loop.

Hashing only the redacted summary (the original design): leaves response-level tampering
undetectable once the HMAC is gone. Rejected as insufficient for a legal record.
