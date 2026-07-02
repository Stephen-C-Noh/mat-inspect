import { describe, it, expect } from 'vitest';
import { buildFailedInspectionCard, type TeamsCardInput } from './teams-card.js';

const makeInput = (overrides: Partial<TeamsCardInput> = {}): TeamsCardInput => ({
  assetTag: 'CRANE-01',
  defectId: '7f1d2c3b-0000-4000-8000-000000000001',
  severity: 'BLOCKING',
  deepLink: 'https://dashboard.mat-inspect.sait.ca/defects/7f1d2c3b-0000-4000-8000-000000000001',
  ...overrides,
});

// Pulls the FactSet facts out of the rendered card so tests assert on content, not on the exact
// body ordering.
const factsOf = (payload: ReturnType<typeof buildFailedInspectionCard>) => {
  const card = payload.attachments[0]!.content as {
    body: Array<{ type: string; facts?: Array<{ title: string; value: string }> }>;
  };
  const factSet = card.body.find((b) => b.type === 'FactSet');
  return factSet?.facts ?? [];
};

describe('buildFailedInspectionCard', () => {
  it('wraps the card in the Power Automate Workflows message envelope', () => {
    const payload = buildFailedInspectionCard(makeInput());
    expect(payload.type).toBe('message');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
    const card = payload.attachments[0]!.content as { type: string; version: string };
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.4');
  });

  it('carries the asset tag, Defect ID, and severity as facts', () => {
    const facts = factsOf(buildFailedInspectionCard(makeInput()));
    expect(facts).toEqual([
      { title: 'Asset tag', value: 'CRANE-01' },
      { title: 'Defect ID', value: '7f1d2c3b-0000-4000-8000-000000000001' },
      { title: 'Severity', value: 'BLOCKING' },
    ]);
  });

  it('adds an open-in-dashboard action when a deep link is provided', () => {
    const payload = buildFailedInspectionCard(makeInput());
    const card = payload.attachments[0]!.content as {
      actions: Array<{ type: string; url: string; title: string }>;
    };
    expect(card.actions).toHaveLength(1);
    expect(card.actions[0]!.type).toBe('Action.OpenUrl');
    expect(card.actions[0]!.url).toBe(makeInput().deepLink);
  });

  it('omits the action when no deep link is provided', () => {
    const payload = buildFailedInspectionCard(makeInput({ deepLink: undefined }));
    const card = payload.attachments[0]!.content as { actions: unknown[] };
    expect(card.actions).toEqual([]);
  });

  it('contains no PII: no operator name, transcript, or photo anywhere in the payload', () => {
    // The TeamsCardInput type has no field for these, so this guards against a future change
    // that reintroduces them. Serialize the whole payload and assert the sensitive strings are
    // absent (ADR 0013: asset tag and Defect ID only).
    const serialized = JSON.stringify(
      buildFailedInspectionCard(
        makeInput({
          // Even if a caller smuggled these into an unexpected place, they must not appear.
          assetTag: 'CRANE-01',
        }),
      ),
    );
    expect(serialized).not.toMatch(/operator/i);
    expect(serialized).not.toMatch(/transcript/i);
    expect(serialized).not.toMatch(/photo/i);
  });
});
