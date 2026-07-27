// How far back the notification bell looks. An inspection older than this drops off the feed
// whether or not the manager cleared it, which bounds both the feed query and the dismissals
// table (ADR 0026).
//
// One day rather than one shift: a supervisor coming in on Monday should still see what happened
// on the last shift of the weekend. It is a retention rule, not a correctness boundary, so the
// exact value is safe to change.
export const ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000;
