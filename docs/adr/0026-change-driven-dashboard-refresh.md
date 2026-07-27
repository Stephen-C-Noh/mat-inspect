# ADR 0026: The manager dashboard refreshes from a change signal, not from polling every query

- Status: Accepted
- Date: 2026-07-27
- Deciders: Stephen Noh
- Related: ADR 0008 (transactional outbox and content digest), ADR 0019 (the PWA reaches other services through core-api), DEV-127, DEV-128, FRS AC 6.1.3

## Context

The dashboard did no background refetching at all. No query configured a
`refetchInterval`, and the only query default was a 30 second `staleTime`. Data
therefore refreshed on mount, on the manual Refresh control in the Failure Queue, or
when a stale query revalidated after the window regained focus. Nothing updated the
screen while a manager was simply watching it.

This was found during CPRG305 A3 test execution on dev-staging on 2026-07-26, executing
TC048 (DEV-127). An operator submitted an inspection, the POST returned 201, and the
dashboard still showed the previous state more than 35 seconds later. A reload showed
the new inspection at once, so the data had been on the server the whole time. The case
had never been executable before DEV-123 corrected the operator submit path, so the gap
had gone unnoticed since the dashboard was built.

The documented behaviour it violates is specific. FRS acceptance criterion 6.1.3
requires that "new inspection submissions appear within 5 seconds via polling (no
websocket in MVP)". `docs/PRD.md` contrasts "Manager visibility: none during shift"
with a delivered "Real-time dashboard", and `docs/ARCHITECTURE.md` lists the real-time
dashboard as the control for the risk "Managers cannot verify completion". A dashboard
that only updates when someone reloads it does not answer that risk. The exposure is
worst for a blocking defect: the Failure Queue entry is the supervisor's signal to take
a machine out of service.

The notification bell in the top bar was a decorative icon with no handler and no
state, so a manager who stepped away had no way to see what they had missed.

## Decision

The dashboard polls one endpoint, `GET /api/v1/activity`, and refetches its real
queries only when that endpoint reports something.

The endpoint answers one question: which inspections were submitted after a given
instant. It returns the server's own clock as `serverTime` plus an array of new
inspections carrying the machine's asset tag and name and the operator's display name.
The common answer is an empty array.

The client holds a cursor and sends it back as `since` on the next poll. The cursor is
always a `serverTime` from a previous response, never the browser's clock: a manager's
laptop can be minutes off the mini-PC, and a fast clock would silently skip every
inspection submitted inside the difference. A poll with no `since` establishes the
cursor and deliberately reports nothing, so opening the dashboard does not announce the
day's backlog as new.

When a poll returns inspections, the client does two things. It appends them to the
notification bell's unread list, which is now a real expandable panel showing the
machine, the operator, the result and the time. It also invalidates the equipment,
defects and inspections queries, so all three refetch once. One submit can change a
machine's status and raise a blocking defect as well as add a history row, so all three
are refreshed rather than guessing which moved.

The poll interval is 2 seconds. Only the fleet query keeps a timer of its own, at 60
seconds, because equipment status can change with no inspection behind it (a supervisor
returning a machine to service from another session) and the signal reports inspections
only. The manual Refresh control stays as a fallback.

The role gate is supervisor, manager and admin. The feed is fleet-wide, and an operator
may only read their own inspections.

The route is served by core-api and reaches the browser through Caddy, consistent with
ADR 0019 and ADR 0020. A `submitted_at` index was added to `inspections`; the existing
index leads with `equipment_id` and does not serve a fleet-wide scan by time.

## Alternatives considered

**Polling every query on a 3 to 5 second timer.** This is what DEV-127 suggested and it
was implemented first. It meets AC 6.1.3, and it is three or four times the work: every
few seconds it re-reads the whole fleet with its last-inspection join, the whole defect
list, and a machine's whole inspection history, in order to learn that nothing happened.
The mini-PC is the deployment target (ADR 0016) and every open dashboard multiplies that
load. It also cannot reach TC048's 1 second target at any affordable interval, and it
gives the notification bell nothing, because no query knows which of its rows are new.

**WebSocket or server-sent events.** FRS 6.1.3 rules out a websocket for the MVP in the
criterion itself. It would also add a connection to keep alive through Caddy and a
second delivery path to reason about next to the outbox (ADR 0008), for a feature whose
budget is 5 seconds. Reconsider if the fleet or the user count grows enough that a 2
second poll per open dashboard becomes the cost driver.

**An ETag or Last-Modified on the existing list endpoints.** This would cut the response
size on quiet polls but not the query count: each endpoint would still run its query to
decide whether it had changed. It also gives no per-item "this is new" information, so
the bell would still have nothing to show.

**Reporting defect changes in the feed as well.** Not needed yet. A blocking defect is
raised by an inspection submit, so an inspection event already implies a possible defect
change and the invalidation covers it. Defect transitions driven from the dashboard
itself (acknowledge, start repair, resolve) already invalidate on their mutation. Add a
defect signal only if a defect starts changing from a source that is neither.

## Consequences

New inspections, status changes and failure queue entries appear within about 2 seconds
with no user interaction, which satisfies AC 6.1.3 and lands inside TC048's intent.

Quiet time costs one small request per open dashboard every 2 seconds, and nothing else.
On a fleet of about 10 machines this is an indexed read returning an empty array.

The notification bell reports what arrived since the dashboard was opened. The unread
list is session state and is not persisted: reloading clears it, and it is not shared
between a manager's phone and their desktop. This was chosen over storing a per-user
last-seen timestamp because "new since you opened this" is the question a manager
watching a shift is actually asking. Revisit if managers start treating the bell as an
inbox they work through.

A notification entry cannot link to its own machine. Fleet selection is component state
with no URL behind it, which is DEV-128. Until that lands, the panel links to Fleet.

The activity route is logged at debug, not info. At one request every 2 seconds per open
dashboard, an info line per poll would bury the rest of the service log.

An operator's PWA does not use this endpoint and is refused by it. Operator-side
freshness is unchanged.
