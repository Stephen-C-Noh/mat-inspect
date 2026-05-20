# CODING_STANDARDS.md

## MAT-Inspect: Code Style and Conventions

This document is the human-readable guide to writing code in this repo. The companion file `CLAUDE.md` in the repo root is the same information packaged for AI assistants; keep both in sync.

---

## General Rules

- **TypeScript everywhere on Node services and frontend.** No `any` without a comment justifying it. Python is used only in the AI Service.
- **No commented-out code in commits.** Delete it. Use git if you need to recover it.
- **No magic numbers.** Use named constants in `constants.ts` per service.
- **Fail loudly.** Throw errors with a known code. Do not silently return null and move on.
- **DRY but not too dry.** Two repetitions: tolerate. Three: extract. Do not over-abstract.
- **Format on save.** Prettier on TypeScript, Ruff on Python. CI rejects unformatted code.
- **No em dashes (—) or en dashes (–) in code, comments, or documentation.** Use colons, semicolons, commas, or parentheses.

---

## Naming Conventions

| Thing                        | Convention                              | Example                              |
| ---------------------------- | --------------------------------------- | ------------------------------------ |
| Variables and functions      | camelCase                               | `submitInspection`                   |
| React components             | PascalCase                              | `ChecklistItem`                      |
| Types and interfaces         | PascalCase                              | `Inspection`, `EquipmentStatus`      |
| Enums and enum values        | PascalCase enum, SCREAMING_SNAKE values | `EquipmentStatus.OUT_OF_SERVICE`     |
| Constants                    | SCREAMING_SNAKE                         | `MAX_VOICE_CLIP_SECONDS`             |
| Drizzle table objects        | camelCase plural                        | `inspections`, `equipment`           |
| Drizzle column names in DB   | snake_case                              | `submitted_at`, `operator_id`        |
| File names: TS modules       | kebab-case                              | `inspection-service.ts`              |
| File names: React components | PascalCase                              | `ChecklistItemView.tsx`              |
| Folders                      | kebab-case                              | `services/core-api/`                 |
| Env variables                | SCREAMING_SNAKE                         | `ENTRA_TENANT_ID`, `WHISPER_MODEL_PATH` |
| API endpoints                | kebab-case in path; resources plural    | `/api/v1/inspections/:id`            |

---

## Repo Structure

This is an npm-workspaces monorepo.

```
mat-inspect/
├── apps/
│   ├── pwa/                   # Next.js operator PWA
│   └── dashboard/             # Next.js manager dashboard
├── services/
│   ├── core-api/              # Node.js + Fastify, main business logic
│   ├── media/                 # Node.js + Fastify, MinIO uploads
│   ├── audit/                 # Node.js + Fastify, hash-chained audit + PDF reports
│   └── ai/                    # Python + FastAPI, Whisper transcription
├── packages/
│   ├── shared-schemas/        # Zod schemas shared between client and server
│   ├── shared-types/          # Pure TS types shared across services
│   └── shared-utils/          # Pure utility functions (no I/O)
├── db/
│   ├── schema/                # Drizzle schema files
│   └── migrations/            # Generated migration files
├── infra/
│   ├── caddy/                 # Caddyfile
│   └── docker/                # Compose files
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRD.md
│   ├── FRS.md
│   ├── API_REFERENCE.md
│   ├── CODING_STANDARDS.md
│   ├── CONTRIBUTING.md
│   ├── AI_USAGE_GUIDE.md
│   └── adr/
├── .github/workflows/
├── CLAUDE.md
└── README.md
```

### Layering Within a Service

```
services/core-api/src/
├── routes/             # Fastify route registration; URL mapping only
├── handlers/           # Request handlers; thin glue calling use-cases
├── use-cases/          # Business logic; pure functions where possible
├── repositories/       # Database access via Drizzle
├── domain/             # Domain types and pure logic (state machines, etc.)
├── middleware/         # Fastify hooks: auth, validation, error handling
├── schemas/            # Zod schemas (often re-exports from packages/shared-schemas)
├── lib/                # App-specific utilities: logger, error helpers, hmac
├── config/             # Loads env into a typed config object
└── index.ts            # Entry point
```

Routes call handlers. Handlers call use-cases. Use-cases call repositories. Repositories call Drizzle. Do not skip layers. Do not call Drizzle from handlers.

---

## TypeScript Patterns

### Strict mode is on; honor it

```ts
// Good
function classifyResult(passed: boolean[], severities: Severity[]): InspectionResult {
  if (passed.every((p) => p)) return 'PASS';
  const anyBlocking = passed.some((p, i) => !p && severities[i] === 'BLOCKING');
  return anyBlocking ? 'FAIL_BLOCKING' : 'FAIL_WARNING';
}

// Bad: no types, returns string
function classifyResult(passed, severities) {
  // ...
}
```

### Prefer `unknown` over `any`

```ts
// Good
async function parseSubmission(body: unknown): Promise<Submission> {
  return submissionSchema.parse(body);
}

// Bad
async function parseSubmission(body: any): Promise<Submission> {
  return body;
}
```

### Use enums via union types of string literals

Avoid TypeScript `enum` keyword. It generates extra runtime code and does not match Drizzle pg-enums cleanly.

```ts
// Good
export type EquipmentStatus = 'READY' | 'AWAITING_INSPECTION' | 'OUT_OF_SERVICE' | 'RETIRED';

export const EquipmentStatus = {
  READY: 'READY',
  AWAITING_INSPECTION: 'AWAITING_INSPECTION',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
  RETIRED: 'RETIRED',
} as const satisfies Record<string, EquipmentStatus>;
```

### Interface for object shapes, type alias for unions

```ts
// Object shape
export interface Inspection {
  id: string;
  equipmentId: string;
  operatorId: string;
  result: InspectionResult;
}

// Union
export type InspectionResult = 'PASS' | 'FAIL_WARNING' | 'FAIL_BLOCKING';
```

---

## Backend Patterns (Fastify + Drizzle)

### Routes: mapping only

```ts
// services/core-api/src/routes/inspections.ts
import { FastifyPluginAsync } from 'fastify';
import { submitInspectionHandler } from '../handlers/inspections/submit';
import { listInspectionsHandler } from '../handlers/inspections/list';
import { requireRole } from '../middleware/auth';
import { submitInspectionSchema, listInspectionsQuerySchema } from '../schemas/inspection';

export const inspectionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/inspections',
    {
      preHandler: [requireRole('operator')],
      schema: { body: submitInspectionSchema },
    },
    submitInspectionHandler,
  );

  app.get(
    '/inspections',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin', 'auditor')],
      schema: { querystring: listInspectionsQuerySchema },
    },
    listInspectionsHandler,
  );
};
```

### Handlers: thin glue

```ts
// services/core-api/src/handlers/inspections/submit.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { submitInspection } from '../../use-cases/submit-inspection';
import { logger } from '../../lib/logger';

export async function submitInspectionHandler(req: FastifyRequest, reply: FastifyReply) {
  const result = await submitInspection({
    body: req.body as SubmitInspectionInput,
    operatorId: req.user.id,
    idempotencyKey: req.headers['idempotency-key'] as string,
  });
  logger.info({ inspectionId: result.id, operatorId: req.user.id }, 'inspection submitted');
  return reply.code(201).send(result);
}
```

### Use-cases: business logic, no Fastify or HTTP

```ts
// services/core-api/src/use-cases/submit-inspection.ts
import { inspectionRepo } from '../repositories/inspection-repo';
import { equipmentRepo } from '../repositories/equipment-repo';
import { auditClient } from '../lib/audit-client';
import { computeResult, evaluateStatus } from '../domain/inspection';
import { verifyHmac } from '../lib/hmac';
import { httpError } from '../lib/errors';

export async function submitInspection(input: SubmitInspectionInput) {
  // 1. Validate operator certification
  // 2. Verify HMAC
  // 3. Compute result via pure domain function
  // 4. Persist Inspection + Responses + status change in a transaction
  // 5. Emit audit event
  // 6. Return result
}
```

### Repositories: Drizzle only, no business logic

```ts
// services/core-api/src/repositories/inspection-repo.ts
import { db } from '../db';
import { inspections, inspectionResponses } from '@/db/schema/inspections';
import { eq } from 'drizzle-orm';

export const inspectionRepo = {
  async create(input: NewInspection): Promise<Inspection> {
    const [row] = await db.insert(inspections).values(input).returning();
    return row;
  },

  async findById(id: string): Promise<Inspection | null> {
    const rows = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);
    return rows[0] ?? null;
  },
};
```

### Error handling: RFC 7807 via httpError helper

```ts
// services/core-api/src/lib/errors.ts
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public title: string,
    public detail: string,
    public extras?: Record<string, unknown>,
  ) {
    super(`${code}: ${detail}`);
  }
}

export function httpError(
  status: number,
  code: string,
  detail: string,
  extras?: Record<string, unknown>,
) {
  const title = code.toLowerCase().replace(/_/g, ' ');
  return new HttpError(status, code, title, detail, extras);
}

// Usage
throw httpError(403, 'CERT_EXPIRED', `Your forklift certification expired on ${expiry}.`, {
  certificationType: 'FORKLIFT',
  expiredAt: expiry,
});
```

The global error handler in Fastify converts `HttpError` to RFC 7807 JSON.

### Validation: Zod everywhere

```ts
// packages/shared-schemas/inspection.ts
import { z } from 'zod';

export const submitInspectionSchema = z.object({
  equipmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  templateVersion: z.number().int().positive(),
  startedAt: z.string().datetime(),
  responses: z
    .array(
      z.object({
        itemKey: z.string().min(1),
        value: z.unknown(),
        passed: z.boolean(),
        notes: z.string().max(500).optional(),
        notesSource: z.enum(['TYPED', 'VOICE_TRANSCRIBED', 'VOICE_EDITED']).optional(),
        voiceClipId: z.string().uuid().optional(),
        photoIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1),
  signatureHmac: z.string().min(1),
});

export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;
```

### Database: Drizzle schema-first

```ts
// db/schema/inspections.ts
import { pgTable, uuid, timestamp, pgEnum, integer, text } from 'drizzle-orm/pg-core';
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
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  result: inspectionResultEnum('result').notNull(),
  signatureHmac: text('signature_hmac').notNull(),
});
```

Migrations are generated via `npm run db:generate`. Never hand-edit migration SQL except to add `IF NOT EXISTS` guards.

### Logging: Pino, structured, no PII

```ts
// services/core-api/src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.password', '*.token', '*.jwt', '*.secret'],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Usage
logger.info({ inspectionId, operatorId }, 'inspection submitted');
logger.error({ err, requestId }, 'submission failed');
```

Never `console.log` in service code. Never log full user names; use user IDs. Never log voice transcript content; the audit log holds the structured event reference.

---

## Frontend Patterns (Next.js + React)

### Components: UI only, no API calls

```tsx
// apps/pwa/src/components/checklist-item-view.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ChecklistItem } from '@shared/types';

type Props = {
  item: ChecklistItem;
  onChange: (response: ResponseValue) => void;
};

export function ChecklistItemView({ item, onChange }: Props) {
  const [passed, setPassed] = useState<boolean | null>(null);
  // ... render based on item.type
  return <div>{/* ... */}</div>;
}
```

### Pages: compose components and call hooks

```tsx
// apps/pwa/src/app/equipment/[assetTag]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useEquipment, useActiveChecklist, useSubmitInspection } from '@/hooks';
import { ChecklistView } from '@/components/checklist-view';

export default function EquipmentInspectionPage() {
  const { assetTag } = useParams<{ assetTag: string }>();
  const { data: equipment, isLoading } = useEquipment(assetTag);
  const { data: checklist } = useActiveChecklist(equipment?.type);
  const { mutate: submit } = useSubmitInspection();

  if (isLoading) return <Skeleton />;
  if (!equipment) return <NotFound />;
  if (!checklist) return <ChecklistMissing />;

  return <ChecklistView equipment={equipment} checklist={checklist} onSubmit={submit} />;
}
```

### Hooks: data fetching via TanStack Query

```ts
// apps/pwa/src/hooks/use-equipment.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Equipment } from '@shared/types';

export function useEquipment(assetTag: string | undefined) {
  return useQuery({
    queryKey: ['equipment', assetTag],
    queryFn: () => api.get<Equipment>(`/equipment/${assetTag}`),
    enabled: !!assetTag,
  });
}
```

### State: Zustand for cross-component state, hooks for local

```ts
// apps/pwa/src/store/session.ts
import { create } from 'zustand';

interface SessionState {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: () => boolean;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  isAuthenticated: () => get().user !== null,
}));
```

### API client: a single fetch wrapper, no Axios

```ts
// apps/pwa/src/lib/api.ts
const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const problem = await res.json();
    throw new ApiError(res.status, problem);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, idempotencyKey?: string) =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }),
  // ...
};
```

---

## Tailwind and shadcn/ui

- Use Tailwind utility classes for everything. No CSS files except `globals.css` for resets.
- Use shadcn/ui base components (Button, Input, Dialog, Card). Do not roll your own when a shadcn equivalent exists.
- Mobile-first responsive: base classes target mobile (under 640 px), use `md:` and `lg:` for larger screens.
- Touch targets: minimum 44 by 44 px on the PWA. Reusable utility: `min-h-touch` (defined in `tailwind.config.ts`).

```tsx
// Good: utility classes, mobile-first, touch-sized
<button className="min-h-touch w-full rounded-lg bg-red-600 px-4 py-3 text-white font-semibold hover:bg-red-700">
  Submit
</button>

// Bad: inline styles, fixed pixel font that does not scale
<button style={{ height: '32px', fontSize: '12px' }}>Submit</button>
```

---

## Python (AI Service Only)

The AI Service is Python. Same principles, different tooling.

- Python 3.12, type hints required on all public functions
- Validation via Pydantic v2
- HTTP via FastAPI
- Linting: Ruff
- Format: Ruff format (or Black)
- Type check: mypy strict

```python
# services/ai/src/routes/transcribe.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..use_cases.transcribe import transcribe_clip
from ..middleware.auth import require_authenticated

router = APIRouter()

class TranscribeRequest(BaseModel):
    voice_clip_id: str

class TranscribeResponse(BaseModel):
    transcript: str
    language: str
    confidence: float
    low_confidence: bool
    processing_ms: int

@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    body: TranscribeRequest,
    user=Depends(require_authenticated),
) -> TranscribeResponse:
    return await transcribe_clip(body.voice_clip_id, user.id)
```

---

## Constants

Per-service `constants.ts`:

```ts
// services/core-api/src/constants.ts
export const MAX_VOICE_CLIP_SECONDS = 30;
export const MAX_VOICE_CLIP_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_NOTES_LENGTH = 500;
export const ACCESS_TOKEN_TTL_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const ACCOUNT_LOCKOUT_THRESHOLD = 5;
export const ACCOUNT_LOCKOUT_DURATION_MINUTES = 30;
export const SHIFT_WINDOW_HOURS = 8;
export const VOICE_AUDIO_RETENTION_DAYS = 90;
export const INSPECTION_RETENTION_YEARS = 7;
export const HMAC_HEADER_NAME = 'X-Signature-Hmac';
```

---

## Linting and Formatting

```bash
# Whole repo, from root
npm run lint
npm run lint:fix
npm run format
npm run type-check

# Single service
npm run lint -w services/core-api
```

Do not disable lint rules with `// eslint-disable` comments without a PR comment explaining why. If a rule is consistently wrong for this project, change the rule in `.eslintrc.js`.

---

## Anti-Patterns (Will Be Rejected in Review)

```ts
// No any
function process(data: any) {
  /* ... */
}

// No console.log in service code
console.log('user logged in', user); // use logger

// No string SQL
const q = `SELECT * FROM inspections WHERE id = '${id}'`; // SQL injection; use Drizzle

// No raw error throws from handlers
throw new Error('something broke'); // use httpError

// No skipping Zod validation
const body = req.body as SubmitInspectionInput; // unsafe cast; use Zod parse

// No localStorage tokens
localStorage.setItem('token', jwt); // use memory + httpOnly cookies via MSAL

// No business logic in handlers
async function handler(req, reply) {
  const eq = await db.select().from(equipment); // belongs in repository
  // ...
}

// No direct equipment status writes
await db.update(equipment).set({ status: 'READY' }); // bypass state machine

// No fake AI passing
if (transcript.includes('looks good')) return { result: 'PASS' }; // AI cannot pass inspections
```

---

## Writing Style for Comments and Docs

- Subject-verb-object sentences. No marketing language.
- No em dashes (—) or en dashes (–). Use commas, colons, semicolons, parentheses.
- Comments explain _why_, not _what_. The code shows what.
- Doc comments on public exports use TSDoc syntax (`/** ... */`).

```ts
// Good
/**
 * Computes the inspection result from individual responses.
 * Returns FAIL_BLOCKING if any required item failed with BLOCKING severity.
 */
export function computeResult(/* ... */) {
  /* ... */
}

// Bad
/**
 * This comprehensive function leverages cutting-edge logic to seamlessly
 * determine the optimal inspection outcome based on response analysis.
 */
```

---

_See `CLAUDE.md` for the same information packaged for AI tools. See `CONTRIBUTING.md` for git workflow. See `ARCHITECTURE.md` for system design._
