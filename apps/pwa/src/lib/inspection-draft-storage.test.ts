import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import { clearDraft, loadDraft, saveDraft, type DraftSnapshot } from './inspection-draft-storage';

// A Storage stand-in. The real sessionStorage is a browser global, and the point of the module is
// that the draft survives a page load, which is exactly what a fresh object with the same contents
// models: save through one instance, read through another.
const fakeStorage = (seed: Record<string, string> = {}) => {
  const entries = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    // Lets a test model a page load: the backing store persists, the object does not.
    snapshot: () => Object.fromEntries(entries),
  };
};

const items: ChecklistItem[] = [
  {
    key: 'wire-rope',
    prompt: 'Wire rope free of broken strands',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'hours',
    prompt: 'Hour meter reading',
    type: 'TEXT',
    required: true,
    failSeverity: 'WARNING',
  },
];

const snapshot = (overrides: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  equipmentId: 'eq-1',
  templateId: 'tpl-1',
  items,
  answers: {
    'wire-rope': { kind: 'BOOLEAN', passed: false },
    hours: { kind: 'TEXT', value: '1420' },
  },
  notes: {
    'wire-rope': { notes: 'frayed near the drum', notesSource: 'TYPED', rawTranscript: null },
  },
  photoIds: {},
  categories: {},
  ...overrides,
});

const NOW = new Date('2026-07-26T15:00:00-06:00');

describe('inspection draft storage', () => {
  it('restores a saved draft after a page load', () => {
    const storage = fakeStorage();
    saveDraft(storage, snapshot(), NOW);

    // A page load: same backing store, a storage object the pre-load code never touched.
    const afterLoad = fakeStorage(storage.snapshot());

    expect(loadDraft(afterLoad, 'eq-1', NOW)).toEqual(snapshot());
  });

  // Scanning a different machine must start a clean inspection. Restoring one machine's answers
  // onto another would attribute a walkaround to equipment it was never performed on.
  it('does not restore a draft belonging to different equipment', () => {
    const storage = fakeStorage();
    saveDraft(storage, snapshot({ equipmentId: 'eq-1' }), NOW);

    expect(loadDraft(storage, 'eq-2', NOW)).toBeNull();
  });

  // A truncated write or a stored value from an older shape must not throw on the checklist
  // screen's first render. Losing a draft is recoverable; a render crash strands the operator.
  it.each([
    ['unparseable', '{"savedAt":'],
    ['not an object', '"a string"'],
    ['missing the draft', '{"savedAt":"2026-07-26T21:00:00.000Z"}'],
    [
      'a draft with no answers',
      '{"savedAt":"2026-07-26T21:00:00.000Z","draft":{"equipmentId":"eq-1"}}',
    ],
  ])('returns no draft when the stored value is %s', (_label, stored) => {
    const storage = fakeStorage({ 'mat-inspect.inspection-draft': stored });

    expect(loadDraft(storage, 'eq-1', NOW)).toBeNull();
  });

  // Called once the POST returns. Without it the next inspection of the same machine reopens the
  // answers that were just submitted, and the operator could resubmit yesterday's walkaround.
  it('does not restore a draft that was cleared after submission', () => {
    const storage = fakeStorage();
    saveDraft(storage, snapshot(), NOW);
    clearDraft(storage);

    expect(loadDraft(fakeStorage(storage.snapshot()), 'eq-1', NOW)).toBeNull();
  });

  // ADR 0006 makes an Inspection valid for the lab-local calendar day it is submitted on. A draft
  // answered before midnight and restored after it would let yesterday's walkaround claim today's
  // readiness, so the day boundary ends the draft even though sessionStorage still holds it.
  it('does not restore a draft answered on an earlier lab-local day', () => {
    const storage = fakeStorage();
    saveDraft(storage, snapshot(), new Date('2026-07-26T23:58:00-06:00'));

    expect(loadDraft(storage, 'eq-1', new Date('2026-07-27T00:01:00-06:00'))).toBeNull();
  });

  it('restores a draft answered earlier on the same lab-local day', () => {
    const storage = fakeStorage();
    saveDraft(storage, snapshot(), new Date('2026-07-26T06:15:00-06:00'));

    expect(loadDraft(storage, 'eq-1', new Date('2026-07-26T23:58:00-06:00'))).toEqual(snapshot());
  });

  // ADR 0028: the Advisory Check suggestion and the Operator's confirmed category round-trip the
  // same way notes and photoIds do, including the null that a dismissed suggestion sends (not
  // simply an absent key).
  it('round-trips a suggested and a confirmed defect category', () => {
    const storage = fakeStorage();
    const draft = snapshot({
      categories: {
        'wire-rope': { suggested: 'WEAR', confirmed: 'WEAR' },
        hours: { confirmed: null },
      },
    });
    saveDraft(storage, draft, NOW);

    expect(loadDraft(storage, 'eq-1', NOW)).toEqual(draft);
  });

  // A draft written before ADR 0028 added this field has no `categories` key at all. It must
  // still restore (losing a draft over a forward-compat gap strands the operator), with an empty
  // categories record rather than a crash on the first `categories[itemKey]` read.
  it('defaults categories to an empty record for a draft written before the field existed', () => {
    const storage = fakeStorage({
      'mat-inspect.inspection-draft': JSON.stringify({
        savedAt: NOW.toISOString(),
        draft: {
          equipmentId: 'eq-1',
          templateId: 'tpl-1',
          items,
          answers: { hours: { kind: 'TEXT', value: '1420' } },
          notes: {},
          photoIds: {},
        },
      }),
    });

    expect(loadDraft(storage, 'eq-1', NOW)?.categories).toEqual({});
  });
});
