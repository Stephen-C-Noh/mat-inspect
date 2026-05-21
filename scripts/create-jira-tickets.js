#!/usr/bin/env node
// Creates Sprint 0 tickets in JIRA via the REST API v3.
// Usage: JIRA_API_TOKEN=<token> node scripts/create-jira-tickets.js

const BASE_URL = 'https://edu-team-asxyfk1n.atlassian.net';
const EMAIL = 'changbeom.noh@edu.sait.ca';
const PROJECT_KEY = 'DEV';
const PROJECT_ID = '10000';
const ISSUE_TYPE_ID = '10003'; // Task

const token = process.env.JIRA_API_TOKEN;
if (!token) {
  console.error('Error: JIRA_API_TOKEN environment variable is not set.');
  process.exit(1);
}

const auth = Buffer.from(`${EMAIL}:${token}`).toString('base64');

const headers = {
  Authorization: `Basic ${auth}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const text = (content) => ({
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: content }],
    },
  ],
});

const tickets = [
  {
    ref: 'T1',
    summary: 'Set up Drizzle ORM and initial schema (equipment + users)',
    description: text(
      'Install Drizzle in services/core-api. Create db/schema/equipment.ts and db/schema/users.ts (shadow table; id matches the Entra ID oid claim). Configure drizzle.config.ts. Run npm run db:generate to produce the first migration. Add db/seed.ts with 10 hardcoded equipment records matching the asset tags in PRD.md.\n\nAcceptance criteria: npm run db:generate produces a valid migration. npm run db:seed inserts 10 equipment rows. Schema matches CLAUDE.md Drizzle examples.',
    ),
    labels: ['backend'],
    priority: 'High',
    blocks: [],
  },
  {
    ref: 'T2',
    summary: 'Implement GET /api/v1/equipment endpoint',
    description: text(
      'In services/core-api, implement GET /api/v1/equipment returning all equipment records from Postgres via Drizzle. Add the Equipment Zod schema to packages/shared-schemas. No auth required yet.\n\nAcceptance criteria: curl http://localhost:8080/api/v1/equipment returns a JSON array of 10 equipment records. Input validated with Zod. Route follows the pattern in CLAUDE.md section 6.',
    ),
    labels: ['backend'],
    priority: 'High',
    blocks: [],
  },
  {
    ref: 'T3',
    summary: 'Build equipment list page in PWA',
    description: text(
      'In apps/pwa, replace the placeholder page with an equipment list. Fetch from /api/v1/equipment using TanStack Query. Render each item as a shadcn/ui Card. No auth required yet.\n\nAcceptance criteria: Page loads and displays all 10 equipment records. Handles loading and error states. No console errors.',
    ),
    labels: ['frontend'],
    priority: 'Medium',
    blocks: [],
  },
  {
    ref: 'T4',
    summary:
      'Configure Entra ID app registration with operator, supervisor, manager, and admin roles',
    description: text(
      'Work with SAIT IT to configure the Entra ID app registration. Define App Roles: operator, supervisor, manager, admin (see packages/shared-types/src/index.ts for the UserRole type). Assign test users to each role. Record the tenant ID and client ID in Bitwarden and in .env.example as ENTRA_TENANT_ID and ENTRA_CLIENT_ID.\n\nAcceptance criteria: All four App Roles exist in the Entra ID registration. A test user for each role can authenticate and the role claim appears in the JWT. ENTRA_TENANT_ID and ENTRA_CLIENT_ID are documented.',
    ),
    labels: ['backend'],
    priority: 'High',
    blocks: [],
  },
  {
    ref: 'T5',
    summary: 'Build login flow in PWA',
    description: text(
      'Wire Entra ID auth into apps/pwa using MSAL (@azure/msal-browser). Redirect unauthenticated users to the Entra ID login page. Store the JWT in memory (not localStorage). Expose req.user via the verifyToken middleware pattern in CLAUDE.md.\n\nAcceptance criteria: Unauthenticated users are redirected to Entra ID. After login, the user is redirected back to the PWA. JWT is validated on each request.',
    ),
    labels: ['frontend'],
    priority: 'High',
    blocks: [],
  },
  {
    ref: 'T6',
    summary: 'Build login flow in dashboard',
    description: text(
      'Wire Entra ID auth into apps/dashboard using MSAL (@azure/msal-browser). Only users with the manager or admin App Role should be able to access the dashboard. Others get a 403 page.\n\nAcceptance criteria: Manager and admin roles can log in and see the dashboard. Operator role is denied with a clear error message.',
    ),
    labels: ['frontend'],
    priority: 'High',
    blocks: [],
  },
  {
    ref: 'T7',
    summary: 'Set up Loki, Promtail, and Grafana observability stack',
    description: text(
      'Verify the Loki, Promtail, and Grafana containers in docker-compose.yml are correctly wired. Confirm Pino JSON logs from core-api appear in Grafana. Create a basic dashboard showing request count and error rate.\n\nAcceptance criteria: docker compose up starts Loki, Promtail, and Grafana healthy. Logs from core-api appear in Grafana Explore. At least one dashboard panel exists.',
    ),
    labels: ['devops'],
    priority: 'Medium',
    blocks: [],
  },
  {
    ref: 'T8',
    summary: 'Design ChecklistTemplate UI mockup',
    description: text(
      'Design a wireframe/mockup for the checklist inspection form in the PWA. Each checklist item should have a pass/fail toggle, a text notes field, and a voice note button. Reference packages/shared-types/src/index.ts for the ChecklistItem and ChecklistTemplate types. Deliverable is a Figma mockup or annotated sketch shared with the team.\n\nAcceptance criteria: Mockup covers the full checklist flow (start, each item, submit). Reviewed and approved by the team in standup.',
    ),
    labels: ['frontend'],
    priority: 'Medium',
    blocks: [],
  },
];

const dependencies = [
  { blocker: 'T1', blocked: 'T2' },
  { blocker: 'T2', blocked: 'T3' },
  { blocker: 'T4', blocked: 'T5' },
  { blocker: 'T4', blocked: 'T6' },
];

const createIssue = async (ticket) => {
  const body = {
    fields: {
      project: { id: PROJECT_ID },
      summary: ticket.summary,
      description: ticket.description,
      issuetype: { id: ISSUE_TYPE_ID },
      priority: { name: ticket.priority },
      labels: ticket.labels,
    },
  };

  const res = await fetch(`${BASE_URL}/rest/api/3/issue`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Failed to create "${ticket.summary}": ${JSON.stringify(data.errors ?? data)}`);
  }

  return data;
};

const linkIssues = async (blockerKey, blockedKey) => {
  const body = {
    type: { name: 'Blocks' },
    inwardIssue: { key: blockerKey },
    outwardIssue: { key: blockedKey },
  };

  const res = await fetch(`${BASE_URL}/rest/api/3/issueLink`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 201) {
    const data = await res.json();
    console.warn(
      `  Warning: could not link ${blockerKey} -> ${blockedKey}: ${JSON.stringify(data)}`,
    );
  }
};

const run = async () => {
  console.log(`Creating ${tickets.length} tickets in project ${PROJECT_KEY}...\n`);

  const createdKeys = {};

  for (const ticket of tickets) {
    try {
      const result = await createIssue(ticket);
      createdKeys[ticket.ref] = result.key;
      console.log(`  Created ${result.key}: ${ticket.summary}`);
    } catch (err) {
      console.error(`  ${err.message}`);
    }
  }

  console.log('\nLinking dependencies...\n');

  for (const { blocker, blocked } of dependencies) {
    const blockerKey = createdKeys[blocker];
    const blockedKey = createdKeys[blocked];
    if (blockerKey && blockedKey) {
      await linkIssues(blockerKey, blockedKey);
      console.log(`  Linked: ${blockerKey} blocks ${blockedKey}`);
    }
  }

  console.log('\nDone.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
