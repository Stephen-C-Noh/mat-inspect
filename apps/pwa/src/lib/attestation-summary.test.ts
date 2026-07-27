import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { attestationSummary, operatorDisplayName } from './attestation-summary';

const forks: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const horn: ChecklistItem = {
  key: 'horn',
  prompt: 'Horn sounds?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'WARNING',
};

const remarks: ChecklistItem = {
  key: 'remarks',
  prompt: 'Additional remarks',
  type: 'TEXT',
  required: false,
  failSeverity: 'WARNING',
};

describe('attestationSummary', () => {
  // The counts the operator attests to, per ADR 0007: "You answered 12 items. 1 failed."
  it('counts answered items and failed items across the template', () => {
    const summary = attestationSummary([forks, horn, remarks], {
      forks: { kind: 'BOOLEAN', passed: false },
      horn: { kind: 'BOOLEAN', passed: true },
      remarks: { kind: 'TEXT', value: 'runs hot after 20 min' },
    });

    expect(summary).toEqual({ answered: 3, total: 3, failed: 1 });
  });
});

describe('operatorDisplayName', () => {
  // "Submitting as Jane Doe" must name the authenticated operator (ADR 0007, OHS Part 6 log
  // book rule). The name comes from the signed-in account, never from anything typed.
  it('names the signed-in account', () => {
    const account = {
      homeAccountId: 'home-id',
      environment: 'login.microsoftonline.com',
      tenantId: 'tenant-id',
      localAccountId: 'local-id',
      username: 'jane.doe@example.edu',
      name: 'Jane Doe',
    };

    expect(operatorDisplayName(account)).toBe('Jane Doe');
  });

  // The name claim is optional in an Entra token. The operator must still see who they are
  // submitting as, so fall back to the sign-in name rather than showing a blank attestation.
  it('falls back to the sign-in name when the token carries no name claim', () => {
    const account = {
      homeAccountId: 'home-id',
      environment: 'login.microsoftonline.com',
      tenantId: 'tenant-id',
      localAccountId: 'local-id',
      username: 'jane.doe@example.edu',
    };

    expect(operatorDisplayName(account)).toBe('jane.doe@example.edu');
  });
});
