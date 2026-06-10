# ADR 0009: Idempotency-Key Store in core_db, Bound by Request Digest

Date: 2026-06-09
Status: Accepted

## Context

Write endpoints accept an `Idempotency-Key` header so the offline-queue retry path does
not create duplicate submissions. The PWA generates the key when the operator taps Submit
and replays it on every retry (FRS 9.1). Two things were undefined.

First, where the key and its cached result live. The header is documented across the API
reference, FRS, and PRD, but no store was specified.

Second, what binds the key to a single logical write. The original design bound the key to
the per-record HMAC. ADR 0007 dropped the HMAC, so that binding no longer exists. Without
a replacement, the server cannot tell a genuine retry (same write, replay the cached
response) from key reuse with a different body (a client bug, must be rejected).

## Decision

Store idempotency results in a core_db table, not a separate cache.

1. **core_db table, same transaction.** An `idempotency_keys` row is inserted in the same
   transaction that writes the Inspection, its responses, and the outbox row (ADR 0008).
   The commit is atomic: the work and its idempotency record land together or not at all.
   There is no window where a row exists without its key, or a key without its row.

2. **Scope and binding.** The lookup key is `(operatorId, idempotencyKey)`, scoped to the
   authenticated operator so a client-generated UUID cannot collide across operators. The
   stored `requestDigest = sha256(canonical_json(body))` replaces the HMAC as the binding:
   a repeat of the same key with a matching digest returns the cached response; a repeat
   with a different digest returns `IDEMPOTENCY_MISMATCH` (409).

3. **Stored fields.** `key`, `operatorId`, `requestDigest`, `responseStatus`,
   `responseBody`, `createdAt`. The 24-hour replay window is read from `createdAt`.

## Consequences

Positive: no new infrastructure. The store reuses core_db and the existing ADR 0008
transaction, so idempotency cannot drift out of sync with the write it guards. The
HMAC-shaped hole left by ADR 0007 is closed by the request digest.

Negative: expired rows are not auto-evicted the way a TTL cache would evict them. At ten
pieces of Equipment and a few dozen submissions a day, the table grows by a few thousand
rows a year, so cleanup is optional and can be a periodic delete added later, not a launch
requirement.

## Alternatives Considered

Redis with native TTL: the standard idempotency-cache pattern. Rejected. Redis is not in
the stack; adding it means a container in three compose files plus a paid Azure Cache for
Redis in production, a new client dependency, and a new failure mode. Most importantly, an
idempotency record in Redis cannot share the core_db transaction, reopening the dual-write
gap ADR 0008 just closed. The TTL convenience does not justify that at this data volume.
