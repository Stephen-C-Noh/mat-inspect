import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswers } from './checklist-answers';
import {
  buildSubmitPayload,
  collectFailedItems,
  failuresDocumented,
  photoRequiredFailures,
} from './inspection-submit';
import { emptyItemNote, type ItemNote } from './voice-notes';

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

const photoOnFailItem: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN_PHOTO_ON_FAIL',
  required: true,
  failSeverity: 'BLOCKING',
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

const typed = (notes: string): ItemNote => ({ ...emptyItemNote(), notes });

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
        notes: {},
        photoIds: {},
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
      notes: {},
      photoIds: {},
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
      notes: {},
      photoIds: {},
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
      notes: {},
      photoIds: {},
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
      notes: {},
      photoIds: {},
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'forks', value: true, passed: true, photoIds: [] },
    ]);
  });

  it('attaches a typed note to a passing boolean response as TYPED', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      notes: { forks: typed('slight surface rust, still safe') },
      photoIds: {},
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

  it('ignores a whitespace-only note', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      notes: { forks: typed('   ') },
      photoIds: {},
      attested: true,
    });

    expect(payload.responses).toEqual([
      { itemKey: 'forks', value: true, passed: true, photoIds: [] },
    ]);
  });

  it('merges a voice-transcribed note and evidence photo onto a failed boolean response', () => {
    const photoId = '33333333-3333-3333-3333-333333333333';
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem, hornItem],
      answers: {
        forks: { kind: 'BOOLEAN', passed: false },
        horn: { kind: 'BOOLEAN', passed: true },
      },
      notes: {
        forks: {
          notes: 'left fork cracked at the heel',
          notesSource: 'VOICE_TRANSCRIBED',
          rawTranscript: null,
        },
      },
      photoIds: { forks: [photoId] },
      attested: true,
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

  // buildSubmitPayload trusts the draft: it sends whatever note and photo ids are on record for
  // the current answer, with no pass/fail filtering of its own. Staleness (a fail-documented note
  // surviving a flip to pass) is prevented upstream, by resetting an item's note and photo the
  // moment its answer changes (the checklist screen, DEV-134), not by this function.
  it('sends notes and photo ids as given, even for a currently-passing item', () => {
    const payload = buildSubmitPayload({
      equipmentId: EQUIPMENT_ID,
      templateId: TEMPLATE_ID,
      items: [booleanItem],
      answers: { forks: { kind: 'BOOLEAN', passed: true } },
      notes: { forks: typed('heel reground, within spec') },
      photoIds: { forks: ['some-photo-id'] },
      attested: true,
    });

    expect(payload.responses).toEqual([
      {
        itemKey: 'forks',
        value: true,
        passed: true,
        notes: 'heel reground, within spec',
        notesSource: 'TYPED',
        photoIds: ['some-photo-id'],
      },
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

describe('photoRequiredFailures', () => {
  // DEV-120 scopes the photo requirement to BOOLEAN_PHOTO_ON_FAIL specifically. A plain BOOLEAN
  // fail never requires a photo, so it must never show up here even though it is a failure.
  it('returns only failed BOOLEAN_PHOTO_ON_FAIL items, excluding a plain boolean fail', () => {
    const failed = photoRequiredFailures([photoOnFailItem, hornItem], {
      forks: { kind: 'BOOLEAN', passed: false },
      horn: { kind: 'BOOLEAN', passed: false },
    });

    expect(failed).toEqual([{ itemKey: 'forks', prompt: 'Forks intact?' }]);
  });

  it('excludes a passing BOOLEAN_PHOTO_ON_FAIL item', () => {
    const failed = photoRequiredFailures([photoOnFailItem], {
      forks: { kind: 'BOOLEAN', passed: true },
    });

    expect(failed).toEqual([]);
  });
});

describe('failuresDocumented', () => {
  it('is true when there are no photo-required failures', () => {
    expect(failuresDocumented([hornItem], { horn: { kind: 'BOOLEAN', passed: false } }, {})).toBe(
      true,
    );
  });

  it('is false when a photo-required failure has no photo id', () => {
    expect(
      failuresDocumented([photoOnFailItem], { forks: { kind: 'BOOLEAN', passed: false } }, {}),
    ).toBe(false);
  });

  it('is true once the photo-required failure has a photo id', () => {
    expect(
      failuresDocumented(
        [photoOnFailItem],
        { forks: { kind: 'BOOLEAN', passed: false } },
        { forks: ['some-photo-id'] },
      ),
    ).toBe(true);
  });
});
