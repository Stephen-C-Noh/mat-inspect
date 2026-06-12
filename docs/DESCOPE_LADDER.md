# Descope Ladder

This document is decided in advance, while the team is calm, so that schedule pressure
is met with a plan instead of a panic. When the project falls behind and the buffer week
is gone, scope is shed in the order below, top first. The order is fixed here so that the
loudest voice at the end of a long day does not get to choose what gets cut.

Drafted 2026-06-09, pending team ratification at the next weekly planning. Once
ratified, changes to this order require a team decision at weekly planning, not a
mid-sprint call.

## The Spine (never cut)

Cutting any of these means the system is no longer a compliant OHS inspection system.
They are not negotiable under any schedule pressure.

- Inspection submission with server-derived result
- Equipment status state machine (computed readiness, ADR 0006)
- Operator attestation (ADR 0007)
- Audit chain with transactional outbox and content digest (ADR 0008)
- Signed PDF export
- Entra ID authentication

## The Ladder (cut in this order, top first)

1. **CSV export.** The signed PDF is the legal artifact. CSV is analyst convenience.
   Cheapest cut, no compliance impact.
2. **Dashboard charts (Recharts).** Keep the compliance grid, which is the must-have.
   Charts are decoration on top of the grid.
3. **Advanced dashboard filters.** Keep the default today grid. Defer operator and
   date-range filtering.
4. **Defect photo richness.** Keep one photo on a blocking failure. Drop multi-photo
   galleries and extra capture flows.
5. **Voice-to-text polish.** Trim the waveform and confidence-warning chrome. Never cut
   the feature itself: the dictate, edit, confirm path stays, because the sponsor
   required AI and voice-to-text is how the project satisfies that requirement.

## Already cut

- **AI photo defect classification.** Dropped entirely (was a Sprint 3 stretch). A model
  reliable enough to assist a safety inspection cannot be built with the time and
  hardware available. The AI requirement is satisfied by voice-to-text.
