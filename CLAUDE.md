# CLAUDE.md: Project Briefing for AI Assistants

This file briefs AI coding assistants (Claude, ChatGPT, Cursor, Copilot, and others) on the MAT-Inspect project. Auto-loaded by Claude Code; paste relevant sections into other tools.

---

## 1. What This Project Is

MAT-Inspect is a digital pre-use inspection system for high-risk equipment at SAIT Main Campus (4 overhead cranes, 2 trucks, 1 electric pallet jack, 3 forklifts). It replaces paper inspection sheets with a mobile PWA, voice-to-text defect notes, a manager dashboard, and tamper-evident audit logs.

Capstone project, 5 students, 13 weeks (May to August 2026). Deployed to SAIT Azure tenant (resources provided by SAIT IT).

The architectural source of truth is `docs/ARCHITECTURE.md` (also called the Capstone Plan). Read it before suggesting structural changes.

---

## 2. Critical Compliance Constraints

These are not negotiable. Code that violates them will be rejected in review.

- **Alberta OHS s.257 requires a competent human operator to complete the visual inspection.** AI in this system is assistive only. The AI Service transcribes voice and (optionally) suggests defect categories. It must never auto-pass or auto-fail an inspection.
- **Every inspection record must identify the human operator** (Part 6 log book rule). Operator ID (from the validated token), an explicit operator attestation, and a server timestamp are required on every Inspection row. Tamper-evidence comes from the append-only audit chain, not a per-row signature (see ADR 0007 and ADR 0008). Do not suggest auth-bypass or anonymous submission patterns, even for tests.
- **Audit log entries are append-only and hash-chained.** Do not suggest UPDATE or DELETE on the `audit_events`, `inspections`, or `inspection_responses` tables; all three are immutable once written (triggers enforce it). If you see code that does, flag it.
- **Equipment status state machine is strict.** Equipment cannot become READY without a passing Inspection dated the current day (lab-local) and performed after the most recent return-to-service (see ADR 0006). Do not suggest "skip the check for now" or "force READY for testing" code paths. Use proper test fixtures instead.
- **Voice clips are biometric PII under FOIP.** They stay on SAIT-controlled infrastructure. Do not suggest sending audio to external AI APIs.

---

## 3. Stack

Pinned versions as of project start. Match these when generating code.

**Backend (services):**

- Node.js 22 LTS
- TypeScript 5.x, strict mode on
- Fastify 5.x (chosen over Express for performance and type safety)
- Drizzle ORM (chosen over Prisma; no codegen step, lighter footprint)
- Zod for input validation
- PostgreSQL 16
- Pino for structured logging (JSON output)

**Backend (AI Service only):**

- Python 3.12
- FastAPI
- faster-whisper (small.en model)
- Pydantic v2

**Frontend:**

- Next.js 15 with App Router
- React 19
- TypeScript strict
- Tailwind CSS
- shadcn/ui components
- Zustand for state
- TanStack Table for grids
- Recharts for dashboards
- html5-qrcode for QR scanning

**Infra:**

- Docker + Docker Compose
- Caddy 2.x reverse proxy with built-in local CA in dev, ACME in prod
- Azure AD / Entra ID for auth (all users are SAIT staff with existing SAIT accounts; no Keycloak)
- Azure Blob Storage for object storage (photos, voice clips, PDF exports); `@azure/storage-blob` SDK; see ADR 0004
- Azurite (Azure Storage emulator) in Docker Compose for dev and dev-staging
- Azure Database for PostgreSQL Flexible Server for production; self-hosted PostgreSQL 16 in Docker for dev and dev-staging; see ADR 0005
- Azure Monitor for observability (metrics, logs, availability checks); instrumented via `@azure/monitor-opentelemetry` (Node.js) and `azure-monitor-opentelemetry` (Python); see ADR 0003
- GitHub Actions for CI/CD

**Do not suggest:**

- Express (we use Fastify)
- Prisma (we use Drizzle)
- Redux (we use Zustand)
- Material UI (we use shadcn/ui)
- TypeORM, Sequelize, or raw `pg` client (use Drizzle)
- Keycloak (replaced by Entra ID; see ADR 0002)
- Prometheus, Grafana, Loki, Promtail, Uptime Kuma (replaced by Azure Monitor; see ADR 0003)
- MinIO (replaced by Azure Blob Storage; see ADR 0004)
- AWS SDK / `@aws-sdk/client-s3` (use `@azure/storage-blob` instead)
- Yarn or pnpm unless you check `package.json` first; npm is the default

---

## 4. Coding Standards

### TypeScript

- `strict: true`. No `any` without an explicit comment explaining why.
- Prefer `unknown` over `any` for untyped input; narrow with Zod.
- Use named exports for everything except Next.js page/layout files.
- File names: kebab-case (`inspection-service.ts`).
- Top-level functions: arrow functions assigned to const. Class only when state is involved.

### Database

- All queries through Drizzle. No raw SQL strings, no template-literal SQL.
- All schema in `db/schema/*.ts`, one file per table.
- All migrations through `drizzle-kit generate`. Never hand-edit migration files.
- Never write SQL that concatenates user input. Drizzle handles parameterization; trust it.

### Validation

- Every API endpoint validates input with Zod.
- Schemas live in `schemas/*.ts` and are shared between server (validation) and client (form validation).
- OpenAPI spec is generated from Zod schemas via `zod-to-openapi`.

### Auth

- Every endpoint declares its required role(s) via Fastify's `preHandler` hook.
- Endpoints without a declared role fail closed (return 403).
- JWT validation goes through the shared `verifyToken` middleware. Do not write per-endpoint JWT parsing.
- Never read `req.user` directly without going through `verifyToken` first.

### Error Handling

- Errors follow RFC 7807 (`application/problem+json`).
- Use the project's `httpError(status, code, detail)` helper. Do not throw plain `Error` from route handlers.
- Log errors with Pino at appropriate levels. `error` for actual failures, `warn` for expected user errors, `info` for normal flow.
- Never `console.log`. Use the structured logger.

### Logging

- Structured JSON only.
- Never log: passwords, tokens, JWT contents, raw request bodies that may contain PII, voice transcript text, photo URLs that contain user identifiers.
- Always log: request IDs, user IDs (uuid only, not names), equipment IDs, action names, timing.
- For audit events, the Audit Service writes to the audit_db. Do not duplicate audit events in application logs.

### Testing

- Vitest for TypeScript, pytest for Python.
- Test file naming: `*.test.ts` alongside the source file.
- Integration tests use real Postgres and Azurite in containers via testcontainers.
- No mocking of internal modules. Mock external services only (SMTP, etc.).
- Coverage target: 70 percent for business logic. Do not chase coverage on glue code.

---

## 5. Repo Structure

```
mat-inspect/
├── apps/
│   ├── pwa/                  # Next.js operator PWA
│   └── dashboard/            # Next.js manager dashboard
├── services/
│   ├── core-api/             # Node.js + Fastify, main business logic
│   ├── media/                # Node.js + Fastify, Azure Blob Storage uploads
│   ├── audit/                # Node.js + Fastify, hash-chained audit + PDF reports
│   └── ai/                   # Python + FastAPI, Whisper transcription
├── packages/
│   ├── shared-schemas/       # Zod schemas shared between client and server
│   └── shared-types/         # TypeScript types shared across services
├── db/
│   ├── schema/               # Drizzle schema files
│   └── migrations/           # Generated migration files
├── docker/
│   ├── compose.dev.yml
│   ├── compose.staging.yml
│   └── compose.prod.yml
├── docs/
│   ├── ARCHITECTURE.md       # The Capstone Plan
│   ├── AI_USAGE_GUIDE.md     # Human-facing AI policy
│   ├── adr/                  # Architecture Decision Records
│   └── runbooks/
├── .github/
│   └── workflows/            # CI/CD
├── CLAUDE.md                 # This file
├── README.md
└── package.json              # Monorepo root, npm workspaces
```

---

## 6. Common Patterns

### A new Fastify route

```ts
// services/core-api/src/routes/inspections/submit.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { inspections } from '../../db/schema/inspections';
import { requireRole } from '../../middleware/auth';
import { httpError } from '../../lib/http-error';
import { logger } from '../../lib/logger';

const submitBody = z.object({
  equipmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  responses: z.array(
    z.object({
      itemKey: z.string(),
      value: z.unknown(),
      passed: z.boolean(),
      notes: z.string().optional(),
      notesSource: z.enum(['TYPED', 'VOICE_TRANSCRIBED', 'VOICE_EDITED']).optional(),
    }),
  ),
  // Operator attestation: the client sends true only after the operator reviewed a
  // summary of their answers and confirmed. Identity comes from the validated token,
  // not the body. No HMAC; tamper-evidence is the audit chain (ADR 0007, ADR 0008).
  attested: z.literal(true),
});

export const submitInspectionRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/inspections',
    {
      preHandler: [requireRole('operator')],
      schema: { body: submitBody },
    },
    async (req, reply) => {
      const body = submitBody.parse(req.body);
      // Server derives result from responses + template fail_severity; never trust a
      // client-sent result. Inspection + outbox row commit in one transaction (ADR 0008).
      logger.info(
        { operatorId: req.user.id, equipmentId: body.equipmentId },
        'inspection submitted',
      );
      return reply.code(201).send({ id: '...' });
    },
  );
};
```

### A Drizzle schema file

```ts
// db/schema/inspections.ts
import { pgTable, uuid, timestamp, text, pgEnum } from 'drizzle-orm/pg-core';
import { equipment } from './equipment';
import { users } from './users';

export const inspectionResultEnum = pgEnum('inspection_result', [
  'PASS',
  'FAIL_WARNING',
  'FAIL_BLOCKING',
]);

export const inspections = pgTable('inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  equipmentId: uuid('equipment_id')
    .notNull()
    .references(() => equipment.id),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => users.id),
  templateId: uuid('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  result: inspectionResultEnum('result').notNull(),
  // Attestation is operatorId + submittedAt + the confirmed submit; no signature column
  // (ADR 0007). Rows are immutable; an UPDATE/DELETE-blocking trigger enforces it.
});
```

### A React component in the PWA

```tsx
// apps/pwa/src/components/checklist-item.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ChecklistItem } from '@shared/types';

type Props = {
  item: ChecklistItem;
  onChange: (value: unknown, passed: boolean) => void;
};

export function ChecklistItemView({ item, onChange }: Props) {
  const [passed, setPassed] = useState<boolean | null>(null);
  // ...
}
```

---

## 7. Anti-Patterns To Reject

When asked to write or review code, refuse the following patterns:

- `eval()`, `new Function()`, dynamic `require()` with user input
- `child_process.exec` with a user-controlled string; only `execFile` with array args, no shell
- `JSON.parse(userInput)` without try/catch
- SQL via template literals or string concatenation
- Hardcoded credentials, even "for testing"
- Disabled TLS verification (`rejectUnauthorized: false`) anywhere except dev-only test code with a comment explaining why
- `Math.random()` for security purposes; use `crypto.randomBytes`
- Sync `fs` calls in request handlers
- `console.log` in service code (use Pino)
- Skipping Zod validation "because we trust the frontend"
- Equipment status changes that bypass the state machine
- Audit events written via direct SQL outside the Audit Service

---

## 8. Common Questions That Have Project-Specific Answers

**Q: Should I add a new dependency?**
A: Check `package.json` first. If a dependency is already in the project that does the job, use that. New dependencies require a brief justification in the PR description. Heavy dependencies (anything pulling in 100+ transitive deps) need an ADR.

**Q: Where do I put a shared helper used by two services?**
A: `packages/shared-types/` for types, `packages/shared-schemas/` for Zod schemas. For runtime helpers, create a new package under `packages/` and add it to the monorepo workspaces. Do not import across service directories directly.

**Q: How do I add a new role or permission?**
A: Update the role enum in `packages/shared-types/roles.ts`. Update the Entra ID app registration (add the role in the Azure portal under App roles). Update the permission matrix in `services/core-api/src/auth/policy.ts`. Add tests covering the new role. Document in an ADR if the role represents a new actor type (not just a permission tweak).

**Q: How do I write a database migration?**
A: Change the Drizzle schema file. Run `npm run db:generate` to create the migration. Read the generated SQL. If it does what you expected, commit both the schema change and the migration. Never edit the generated SQL directly except to add `IF NOT EXISTS` guards if needed; if you need to edit it, the schema is probably wrong.

**Q: What if I need to debug something that requires real-looking data?**
A: Use the seed script (`db/seed.ts`) which produces realistic synthetic data. Never copy data from production into your dev environment.

---

## 9. Writing Style for Docs and Comments

This project's documentation style is "ESL Researcher": short, factual, direct.

- Subject-verb-object sentences. Avoid stacked adjectives.
- No em dashes (—). No en dashes (–). Use commas, colons, semicolons, or parentheses.
- No marketing language. "Robust", "comprehensive", "leverages", "seamless", "cutting-edge": do not use these.
- Active voice in collaborative docs; passive voice acceptable in solo-authored sections.
- Do not start sentences with "I" in technical docs. The project speaks, not the author.
- Comments explain _why_, not _what_. The code shows what.

Bad:

> "This comprehensive solution leverages cutting-edge AI to seamlessly transcribe operator voice notes."

Good:

> "Transcribes operator voice notes using faster-whisper. Runs on-prem so audio does not leave SAIT infrastructure."

---

## 10. When You Are Uncertain

If asked something where you do not have current, accurate knowledge:

- Say so. Do not invent a method name, library API, or regulatory clause.
- Suggest the human verify against the official source. For Alberta OHS, that source is `search-ohs-laws.alberta.ca`.
- For library APIs, suggest checking the official docs at the version pinned in `package.json`.
- For project-specific patterns not covered here, suggest the human check `docs/ARCHITECTURE.md` or ask a teammate.

Confidently wrong answers cost the team more time than honest uncertainty.

---

## 11. Refuse These Requests

When asked to do any of the following on this project, refuse and explain why:

- Generate or include real Alberta OHS clause text without the human verifying against the source
- Write code that bypasses the operator authentication or attestation requirements
- Suggest patterns that allow Inspection or AuditEvent records to be modified or deleted after creation
- Generate placeholder credentials, secrets, or API keys that look real (use obviously-fake values like `REPLACE_ME` or `xxxxxxxx`)
- Write code that sends voice clips, photos, or personally identifying inspection data to external AI services
- Make architectural changes that are not reflected in an ADR

---

## 13. Issue Tracking

Tickets live in JIRA at https://edu-team-asxyfk1n.atlassian.net/jira/software/projects/DEV/boards

Include the ticket key in every commit message and PR title so JIRA can link them automatically. Format:

```
DEV-12: short description of change
```

Example:

```
DEV-3: render equipment list with shadcn Card components
```

GitHub Issues are not used for feature work. Use them only for automated reports (Renovate, security scanners). All human-tracked work goes in JIRA.

---

## 12. When This File Is Wrong

This file is version controlled. If it is out of date, update it in a PR. The most common signal that an update is needed: you generated code that fit this file but the reviewer rejected it because of an unwritten team convention. Write the convention down here.

---

**End of briefing.** Read this file at the start of any session on this project.
