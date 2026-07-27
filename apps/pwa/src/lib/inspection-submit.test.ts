import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswers } from './checklist-answers';
import { buildSubmitPayload, collectFailedItems } from './inspection-submit';

const booleanItem: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

const hornItem: ChecklistItem = {
  key: 'horn',
  prompt: 'Horn sounds?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'WARNING',
};

const textItem: ChecklistItem = {
  key: 'remarks',
  prompt: 'Additional remarks',
  type: 'TEXT',
  required: false,
  failSeverity: 'WARNING',
};

const EQUIPMENT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

describe('buildSubmitPayload', () => {
  // ADR 0007: the attestation is an explicit confirm action taken after the operator reviews a
  // summary. A payload that no human affirmed must not be constructible, so the caller has to
  // hand in the confirm and a missing one is a programming error, not a silent false.
  it('refuses to build a payload when the operator has not attested', () => {
    expect(() =>
      buildSubmitPayload({
        equipmentId: EQUIPMENT_ID,
        templateId: TEMPLATE_ID,
        items: [booleanItem],
        answers: { forks: { kind: 'BOOLEAN', passed: true } },
        inlineNotes: {},
        attested: false,
      }),
    ).toThrow(/attest/i);
  });

  it('builds an attested pass-path payload from all-passed boolean answers', () => {
    const items = [booleanItem, hornItem];
    const answers: ChecklistAnswers = {
      forks: { kind: 'BOOLEAN', passed: true },
      horn: { kind: 'BOOLEAN', passed: true },
    };

    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items,
      answers,
      inlineNotes: {},
      attested: true,
    });

    expect(payload).toEqual({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      attested: true,
      responses: [
        { itemKey: 'forks', value: true, passed: true, photoIds: [] },
        { itemKey: 'horn', value: true, passed: true, photoIds: [] },
      ],
    });
  });

  it('records a failed boolean answer as value false and passed false', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: false } },
      inlineNotes: {},
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'forks', value: false, passed: false, photoIds: [] },
    ]);
  });

  it('records a TEXT answer with the typed string as value and passed true', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [textItem],
      answers: { remarks: { kind: 'TEXT', value: 'runs hot after 20 min' } },
      inlineNotes: {},
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'remarks', value: 'runs hot after 20 min', passed: true, photoIds: [] },
    ]);
  });

  it('omits an unanswered optional item from responses', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem, textItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      inlineNotes: {},
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'forks', value: true, passed: true, photoIds: [] },
    ]);
  });

  it('attaches typed inline notes to a boolean response as TYPED', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      inlineNotes: { forks: 'slight surface rust, still safe' },
      attested: true,
    });

    expect(payload.responses).toEqual([
      {
        itemKey: 'forks',
        value: true,
        passed: true,
        notes: 'slight surface rust, still safe',
        notesSource: 'TYPED',
        photoIds: [],
      },
    ]);
  });

  it('ignores whitespace-only inline notes', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      inlineNotes: { forks: '   ' },
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'forks', value: true, passed: true, photoIds: [] },
    ]);
  });

  it('merges a failure doc (voice notes + photo ids) onto its failed boolean response', () => {
    const photoId = '33333333-3333-3333-3333-333333333333';
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem, hornItem],
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
      },
      // Inline note on the failed item is superseded by the documented failure below.
      inlineNotes: { forks: 'typed earlier' },
      attested: true,
      failureDocs: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          photoIds: [photoId],
        },
      },
    });

    expect(payload.responses).toEqual([
      {
        itemKey: 'forks',
        value: false,
        passed: false,
        notes: 'left fork cracked at the heel',
        notesSource: 'VOICE_TRANSCRIBED',
        photoIds: [photoId],
      },
      // The passing item is untouched: no notes, no photos.
      { itemKey: 'horn', value: true, passed: true, photoIds: [] },
    ]);
  });
});

describe('collectFailedItems', () => {
  it('returns only failed boolean items, in template order, with their prompt', () => {
    const items = [booleanItem, textItem, hornItem];
    const failed = collectFailedItems(items, {
      forks: { kind: 'BOOLEAN', passed: false },
      remarks: { kind: 'TEXT', value: 'noisy' },
      horn: { kind: 'BOOLEAN', passed: false },
    });

    expect(failed).toEqual([
      { itemKey: 'forks', prompt: 'Forks intact?' },
      { itemKey: 'horn', prompt: 'Horn sounds?' },
    ]);
  });

  it('excludes passed and unanswered items', () => {
    const failed = collectFailedItems([booleanItem, hornItem], {
      forks: { kind: 'BOOLEAN', passed: true },
    });

    expect(failed).toEqual([]);
  });
});
