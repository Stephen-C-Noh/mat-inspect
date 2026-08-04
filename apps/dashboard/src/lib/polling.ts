// How often the dashboard asks the server whether anything changed. FRS acceptance criterion 6.1.3
// requires a new inspection submission to appear within 5 seconds by polling (no websocket in the
// MVP), and test case TC048 sets a 1 second target from the business need. Two seconds meets the
// FRS with margin and lands within TC048's intent, which is affordable only because the request
// being repeated is the activity feed alone: one indexed read that usually returns an empty array
// (ADR 0026). Nothing else on the dashboard is on a timer.
export const ACTIVITY_POLL_INTERVAL_MS = 2_000;

// The activity feed reports inspections, so a change with no inspection behind it would otherwise
// sit unseen until someone reloaded. Two such changes exist and both come from another session:
// a supervisor returning a machine to service, and a manager acknowledging or resolving a defect
// (the mutation hooks invalidate only the client that performed it, so a second dashboard never
// hears about it). Two supervisors dispatched to the same machine is the failure this prevents.
// A slow background read covers both without putting either query back on a fast timer.
export const CROSS_SESSION_SAFETY_POLL_INTERVAL_MS = 60_000;
