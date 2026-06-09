# ADR 0010: Notification Delivery for Safety Alerts

Date: 2026-06-09
Status: Accepted

## Context

A failed inspection must reach a Supervisor quickly. The original design sent the alert to
"on-shift Supervisors" over email and Web Push. Two problems.

First, "on-shift" is no longer definable. ADR 0006 removed the shift model, so the system
has no notion of which Supervisor is on shift at a given moment.

Second, Web Push cannot guarantee delivery. The push services (FCM, Mozilla autopush, and
others) accept a message for delivery but return no end-to-end acknowledgement to the
application server. Subscriptions expire, browsers and operating systems throttle or drop
pushes, and users can revoke permission. Treating Web Push as a guaranteed safety channel
sets an acceptance criterion that cannot be met. Email is more reliable but still only
confirms acceptance by the relay, not receipt by a person.

## Decision

1. **Recipients: all active Supervisors.** Drop "on-shift". The lab is small (10 pieces of
   equipment), so fan-out to every active Supervisor is cheap and removes the need to model
   who is working at any moment.

2. **Three P0 delivery paths, two roles.** A failed inspection triggers all three:
   - **Email (SMTP).** The reliability floor. "The alert was sent" means the SMTP relay
     accepted the message.
   - **Web Push.** Best-effort speed. Sent to every valid subscription. Expired or rejected
     subscriptions are pruned, not retried forever. A push failure never blocks the event.
   - **Persistent dashboard queue.** An unresolved-failure list that does not disappear
     until a Supervisor acts on it. This is the actual not-missed guarantee, because it is
     pull-based: it does not depend on any transport reaching a device. A Supervisor sees it
     whenever they open the dashboard.

3. **Delivery semantics.** Email and Web Push are independent: one failing does not stop the
   other. The guarantee that a safety alert is never lost rests on the dashboard queue, not
   on push or email delivery. Push and email are the fast nudge; the queue is the backstop.

## Consequences

Positive: the safety guarantee is decoupled from unreliable transports. Email or push can
both fail and the alert still reaches a Supervisor through the queue. "On-shift" is gone, so
nothing depends on a removed concept.

Negative: Web Push infrastructure is now load-bearing and must be built: VAPID keys, a push
subscription store, and a sender. Web Push offers no delivery guarantee by design, which must
stay clear in requirements so no acceptance criterion claims one.

## Appendix: Deferred Extensions (P1, P2)

Recorded so a later expansion can pick them up. Neither ships for the capstone. The key idea:
guaranteed delivery is a property of a closed loop (acknowledgement plus escalation), not of
any single transport.

**P1: Push receipt acknowledgement.** The service worker calls the server when it receives a
push, recording a receipt. Absence of a receipt then signals likely non-delivery. Implementation
is light (one service worker callback, one endpoint, one storage column), with one real wrinkle:
the acknowledgement call must be authenticated, so the service worker needs access to a token.
Its safety value is low on its own, because the P0 dashboard queue already covers "never
missed". Its real value is as the prerequisite signal for P2, so build it together with P2, not
before.

**P2: Escalation on no-acknowledgement.** If no channel is acknowledged within a set time,
escalate to a stronger channel (SMS, then a person). SMS needs a paid provider (Twilio or Azure
Communication Services), which is new infrastructure and warrants its own ADR. This is the piece
that turns "best-effort" into a real delivery guarantee.
