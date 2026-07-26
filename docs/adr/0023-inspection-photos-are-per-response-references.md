# ADR 0023: Inspection photos are per-response references sealed into the content hash

- Status: Accepted
- Date: 2026-07-24
- Deciders: Stephen Noh
- Related: ADR 0004 (Azure Blob Storage), ADR 0008 (transactional outbox and content digest), ADR 0019 (the PWA reaches the AI Service through core-api), ADR 0020 (Caddy is the single front door), DEV-32, DEV-33, DEV-38, DEV-104

## Context

The photo pipeline was unwired end to end. The PWA captures a photo for a failed
checklist item and uploads it to the Media Service (DEV-32, DEV-33), which stores the
blob and returns a `photoId`. The submit endpoint then dropped that id: no
`inspection_responses` row and no `defects` row ever stored it. The result was
orphaned blobs on SAIT storage and a fleet drilldown (DEV-37) with no photo to show.

Two questions had to be answered together: where the reference is stored, and whether
it is part of the content the Audit Chain seals.

## Decision

A photo is per-item evidence. It is stored as a per-response reference:
`inspection_responses.photo_ids uuid[] NOT NULL DEFAULT '{}'`, an array of Media blob
ids. The array is sealed into the inspection content hash (ADR 0008), so a swapped or
removed reference is tamper-evident like any other answer content.

The submit endpoint stores whatever references the client sends. It does not enforce
that a failed `BOOLEAN_PHOTO_ON_FAIL` item carries a photo, does not verify that each
id resolves to a real blob, and does not reject references on other item types. Those
are separate policy decisions that also need the PWA to guarantee capture, so they are
deferred. Comments in `media/upload.ts` and `media/blob-storage.ts` that claimed submit
already enforces the photo-on-fail rule were wrong and are corrected. The array is
capped at 10 entries per response.

### Storage: per-response, not on the Defect

Storing on `defects` is lossy and was rejected. `BOOLEAN_PHOTO_ON_FAIL` is an item
type, orthogonal to `failSeverity`: a warning-severity photo-on-fail item that fails
opens no Defect, so its photo would have nowhere to live. And several blocking failures
collapse into one aggregate Defect (`buildBlockingDefect`), so per-item photos would
be merged and mis-attributed. The `defects.photo_ids` column already exists but was
never populated, and it cannot faithfully carry this evidence. Per-response storage
matches where the evidence belongs.

### Retrieval: served by Media, not proxied through core-api

core-api and audit only ever handle the UUID references, never the photo bytes. The
retrieval path that returns the bytes for the dashboard is served by the Media Service
directly through the existing `@media` gateway route, not proxied through core-api.
ADR 0020's publishing rule decides this: a service may be published at the gateway if
it validates Entra tokens itself, and Media does (shared verifier, DEV-98). ADR 0019
keeps the AI Service behind core-api only because the AI Service authenticates nothing;
that reasoning does not extend to Media. core-api therefore gains no blob client, and
the blob readers stay at two (Media, audit), not three. Building that retrieval route
is a separate ticket; this ADR only fixes where the reference is stored and sealed.

## Consequences

The content-hash input changes, so both sides of ADR 0008 change together. core-api
seals `photo_ids` at submit; audit recomputes with `photo_ids` when it verifies a
report (`chain-segment.ts`), reading them from core-api's `reports-data` response. That
response already carries a `photoIds` field per response (DEV-38 left the room), so no
second schema change is needed; it returns the real column now instead of an empty
array. The array's element order is preserved by Postgres and is identical on the seal
side and the verify side, so it is not sorted; the responses are still sorted by
`itemKey` for the separate reason that a multi-row SELECT has no guaranteed order.

Backward compatibility is a clean re-seed of dev and dev-staging. There is no
production data. Existing inspections were hashed without `photo_ids` and would fail
verification against the new input; re-seeding removes them rather than versioning the
hash or omitting the field when empty. The re-seed is coordinated so it does not
disturb report testing that runs against the shared database.

`photo_ids` is set once at INSERT. The existing UPDATE/DELETE-blocking trigger on
`inspection_responses` still applies, so the row, including its photo references, stays
immutable after submission.
