# ADR 0001: Monorepo with npm Workspaces; Microservices at Runtime

Date: 2026-05-18
Status: Accepted

## Context

Capstone team of 5, 13 weeks, building a system with four custom services (Core API,
Media, Audit, AI) and two frontend apps (operator PWA, manager dashboard). Services
share Zod schemas and TypeScript types. The team is small and cross-service changes
are frequent during early sprints.

## Decision

Use a single Git repository (monorepo) with npm workspaces. At runtime, build and
deploy as separate Docker containers (microservices).

Shared code lives in packages/shared-schemas and packages/shared-types. Services
import only from packages/, never from each other directly.

## Consequences

Positive: atomic cross-service changes in a single PR; shared schemas with no
publishing overhead; single CI config; one handover artifact for SAIT IT at project
end; simpler onboarding for a team that is new to microservices.

Negative: clone size grows as the project matures; discipline required to keep service
boundaries clean (lint rules will enforce no cross-service imports).

## Alternatives Considered

Polyrepo per service: rejected because cross-service changes are common in this
project and the team is small enough that the coordination overhead (separate PRs,
version pinning, publish steps) exceeds any benefit.
