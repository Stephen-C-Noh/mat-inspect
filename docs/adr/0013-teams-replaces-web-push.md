# ADR 0013: Notification Delivery, Revised (Teams Replaces Web Push)

Date: 2026-06-10
Status: Accepted (supersedes ADR-0010)

## Context

ADR 0010 sends a failed-inspection alert over Email (SMTP), Web Push, and a persistent
dashboard queue, to all active Supervisors. This ADR keeps that shape but replaces Web Push
with a Microsoft Teams message.

Two facts drive the change.

First, Web Push has high adoption friction in this deployment. It requires the user to install
the PWA, grant push permission, and keep a valid subscription. iOS Safari web push is limited
and breaks easily. A channel that many users never enable is a weak fast-nudge channel, and
ADR 0010 already records that Web Push gives no delivery guarantee.

Second, SAIT runs on Microsoft 365. Supervisors already use Teams during work hours (see
Basis). A Teams message is likely to be seen faster and more often than a Web Push, without
any per-user install or permission step.

This does not change the delivery tier. Teams, like Web Push, is a push channel with no
end-to-end receipt: the system learns that a message was posted, not that a person saw it. A
bare channel post is easy to miss without an @mention or routing. The not-missed guarantee
still rests on the pull-based dashboard queue, not on any transport.

## Decision

1. **Recipients: all active Supervisors.** Unchanged from ADR 0010. The lab is small (10
   pieces of equipment), so fan-out to every active Supervisor is cheap, and ADR 0006 removed
   the shift model, so "on-shift" is not definable.

2. **Three P0 delivery paths:**
   - **Email (SMTP).** The minimum guaranteed channel. "The alert was sent" means the SMTP
     relay accepted the message.
   - **Microsoft Teams.** Best-effort speed, replacing Web Push. The Core API posts an
     Adaptive Card to a designated Supervisors channel through an outbound webhook (Power
     Automate Workflows). A Teams post failure never blocks the event.
   - **Persistent dashboard queue.** An unresolved-failure list that does not clear until a
     Supervisor acts on it. This is the not-missed guarantee, because it is pull-based and
     does not depend on any transport reaching a device.

3. **Teams transport choice.** Use a Power Automate Workflows webhook, not a legacy Office
   365 incoming-webhook connector (Microsoft is retiring connectors). Microsoft Graph
   activity-feed notifications are a stronger but heavier option (admin-consented app
   permissions, per-user routing); defer Graph unless a shared-channel post proves too easy to
   miss.

4. **PII and FOIP.** The Teams message carries the equipment asset tag, the Defect ID, the
   severity, and a deep link into the dashboard. It carries no operator name, no transcript
   text, and no photo. This matches the email content rule.

5. **Delivery semantics.** Email and Teams are independent: one failing does not stop the
   other. The guarantee that a safety alert is never lost rests on the dashboard queue. Email
   and Teams are the fast nudge; the queue is the backstop.

## Addendum: email recipient resolution (DEV-81, 2026-07-01)

DEV-81 wires the email channel into the inspection-submit route. "All active Supervisors" (point 1)
cannot be resolved from core_db: supervisor roles live in the Entra ID token, not in a database
table. Three options were considered.

- **Microsoft Graph group lookup.** Query the Supervisors group members at send time. Most faithful
  to "all active supervisors", but it needs an admin-consented application permission and cannot run
  in local dev without that tenant setup. Deferred for the same reason Graph activity-feed
  notifications were deferred for Teams (Decision point 3).
- **A supervisor-email table in core_db.** Full control, but it duplicates role data whose source of
  truth is Entra and drifts as staff change. Rejected.
- **A configured distribution list (chosen).** `SUPERVISOR_ALERT_EMAILS` holds the supervisor
  recipient address(es), managed alongside the Entra Supervisors group. This mirrors the Teams
  channel: the email alert targets a designated Supervisors destination rather than enumerating
  individuals. When the value is unset the notifier logs and skips; the dashboard queue remains the
  not-missed backstop, so a missing list never loses a safety alert.

Reconsider a Graph lookup if per-supervisor addressing (rather than a shared distribution list)
becomes a requirement, on the same trigger as the Teams Graph reconsideration.

## Consequences

Positive: the load-bearing Web Push infrastructure is dropped. No VAPID keys, no push
subscription store, no service worker sender. The fast-nudge channel now reaches users where
they already work, with no per-user install or permission step. Total notification surface is
smaller than building Web Push, not larger.

Negative: the system gains a dependency on the Microsoft 365 tenant and a Power Automate flow
that lives outside the codebase. The flow is harder to version-control and test than in-repo
code, and SAIT IT must reprovision it (or a Graph app registration) in their own tenant at
handover. Teams still gives no receipt, and a shared-channel post can be missed without an
@mention. If the Basis no longer holds (Supervisors stop using Teams at work), this regresses
against Web Push.

## Basis (sponsor-confirmed)

The sponsor confirmed on 2026-06-10 that Supervisors use Microsoft Teams during working hours
and will see a channel message within minutes. All Supervisors carry SAIT-issued phones. The
ranked communication channels during work are: Teams first, email second, other messenger
apps third (only between people who know each other personally). This makes Teams the strongest
practical fast-nudge channel and email the minimum guaranteed channel.

## Alternatives Considered

**Keep Web Push (ADR 0010).** Rejected for adoption friction and weak iOS support, and because
the sponsor confirmed Teams is the primary channel Supervisors watch during work.

**Add Teams in addition to Web Push.** Rejected. Two best-effort push channels at the same
tier add code and handover surface without strengthening the guarantee, which already lives in
the dashboard queue.

**Microsoft Graph activity-feed notification now.** Rejected for the capstone. It needs
admin-consented application permissions and per-user routing, which is more build and a heavier
handover than a single Workflows webhook buys at this scale. Reconsider if the shared-channel
post is missed in the Sprint 5 pilot.

**SMS or a closed-loop guaranteed channel now.** Deferred. A real delivery guarantee needs
acknowledgement plus escalation and a paid provider; that is its own ADR (see Appendix).

## Appendix: Deferred Extensions (P1, P2)

Recorded so a later expansion can pick them up. Neither ships for the capstone. The key idea:
guaranteed delivery is a property of a closed loop (acknowledgement plus escalation), not of
any single transport.

**P1: Delivery acknowledgement.** With Web Push dropped, the push-receipt callback from ADR
0010 no longer applies. The equivalent for Teams is an Adaptive Card action button
("Acknowledge") that calls an authenticated endpoint and clears the dashboard queue item. Its
safety value is low on its own, because the dashboard queue already covers "never missed". Its
real value is as the signal for P2.

**P2: Escalation on no-acknowledgement.** If no channel is acknowledged within a set time,
escalate to a stronger channel (SMS, then a person). SMS needs a paid provider (Twilio or
Azure Communication Services), which is new infrastructure and warrants its own ADR. This is
the piece that turns best-effort into a real delivery guarantee.
