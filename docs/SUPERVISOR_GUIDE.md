# MAT-Inspect Supervisor Guide

For Supervisors handling failed inspections, tracking repairs, and approving
return-to-service on the MAT-Inspect dashboard.

## 1. Getting Notified

When an inspection fails with a blocking defect, MAT-Inspect notifies you three ways:

- **Email**, sent to all active Supervisors.
- **Microsoft Teams** message in the configured channel.
- **In-app bell**, top right of the dashboard. It shows a live count of new inspections
  since you last checked. Click it to see the equipment, result, operator, and time for
  each; **Dismiss** or **Dismiss all** to clear them. Dismissed notifications stay dismissed
  on every device you sign into.

Warning-level failures do not lock equipment out, but still appear in Defects so they can be
tracked and closed.

## 2. The Defects Queue

Go to **Defects** in the dashboard. This page is only visible to Supervisors and Managers.

The list on the left shows every open defect: a short ID, its status, description,
equipment, and the inspection it came from. Filter by **All / Open / Ack'd / In Repair**.
Click a defect to open its detail panel on the right.

The detail panel shows the description, status, and severity; the equipment and its
location; the defect category; the source inspection; and, once resolved, the resolution
notes.

A defect drops off this list once it is fully closed out: resolved for a warning-level
defect, or resolved and returned to service for a blocking one. If you follow a link to a
specific defect (for example from the dashboard's failure summary) and it has already left
the queue, the panel tells you so and offers **Back to queue** rather than showing a stale
record.

## 3. Working a Defect

A defect moves through a fixed sequence. Each step shows exactly one action button, and only
once the defect has reached the stage that button applies to:

1. **Open → Acknowledge.** Click **Acknowledge** to record that you have seen it and
   assigned it.
2. **Acknowledged → Start Repair.** Click **Start Repair** once work begins.
3. **In Repair → Resolve.** Click **Resolve**, type resolution notes (required), then
   **Submit**. **Cancel** backs out without resolving if you clicked Resolve by mistake.
4. **Resolved.**
   - **Warning-severity defects** need nothing further. The panel shows "No further action
     needed."
   - **Blocking-severity defects** need return-to-service approval. See the next section.

You cannot skip a step. The button for a later stage does not appear until the defect has
passed through the stage before it.

## 4. Return-to-Service (Blocking Defects Only)

A resolved blocking defect shows **Approve Return to Service**. This button only becomes
active once every open blocking defect on that piece of equipment is resolved. If the
equipment has more than one open blocking defect, resolve all of them first; the button stays
disabled until the last one clears.

Click it to approve. The button then reads **Return to Service Approved**.

**What this actually does:** approving clears the equipment's lockout and starts a fresh
readiness window. A new passing inspection, submitted after your approval, is required before
the equipment is ready for use again. An inspection completed earlier the same day, even one
that already passed, does not count toward this. This is by design: a repaired machine always
gets a fresh look from an operator before it goes back into service, not a reused pass from
before the repair.

## Trouble

- **"Could not load defects":** the list failed to load. This is not the same as an empty
  queue. Click **Retry**.
- **Equipment names show as IDs, and return-to-service actions are disabled:** equipment
  details failed to load separately from the defect list. This clears itself once that data
  loads again; try refreshing.
- **Approve Return to Service stays greyed out:** check for other open blocking defects on
  the same equipment. All of them need to reach Resolved first.
