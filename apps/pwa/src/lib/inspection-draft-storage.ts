import { z } from 'zod';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ChecklistAnswers } from './checklist-answers';
import type { ItemNote } from './voice-notes';

// The part of the Storage interface this module needs. Narrow on purpose: it keeps the module
// testable without a DOM, and nothing here needs key enumeration or clear().
export type DraftStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

// An in-progress inspection, everything the operator has entered so far. Written from the first
// answer onward, not only once the operator reaches the failure screen, because a page load at
// 12 of 13 answered used to discard the lot (DEV-125).
export type DraftSnapshot = {
  equipmentId: string;
  templateId: string;
  items: ChecklistItem[];
  answers: ChecklistAnswers;
  // One note per item, typed and/or voice-captured, kept regardless of the item's current
  // pass/fail value. The checklist screen resets an item's entry the moment its answer changes,
  // so a stale note can never outlive the answer it was written against (ADR 0008, DEV-134).
  notes: Record<string, ItemNote>;
  // Uploaded evidence photo ids, keyed by item key. Ids, not blob: URLs: a blob: URL is revoked
  // on unload, so persisting one restores a reference that fetch() cannot read. Photos are
  // uploaded at capture time and only the returned id is kept (ADR 0023).
  photoIds: Record<string, string[]>;
  // The idempotency key minted for the first submit attempt, kept so a retry after a failed or
  // lost POST replays the original 201 rather than recording a second inspection (ADR 0009).
  // Absent until the operator confirms on the review screen.
  submitIdempotencyKey?: string;
};

const STORAGE_KEY = 'mat-inspect.inspection-draft';

// The lab is at SAIT Main Campus (Calgary), so "lab-local" is Mountain Time. Matches the server's
// readiness computation (core-api equipment-readiness) rather than the device's timezone, which a
// traveling phone can have set to anything.
const LAB_TIMEZONE = 'America/Edmonton';

const labLocalDay = (at: Date): string =>
  at.toLocaleDateString('en-CA', { timeZone: LAB_TIMEZONE });

// Storage is untrusted input like any other: a write can be truncated, and a draft written by an
// older build can outlive a deploy in an open tab. Narrow with Zod rather than trusting the cast
// (CLAUDE.md section 4), so a bad entry is discarded instead of crashing the checklist render.
const checklistItemSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  type: z.enum(['BOOLEAN', 'BOOLEAN_PHOTO_ON_FAIL', 'TEXT']),
  required: z.boolean(),
  failSeverity: z.enum(['BLOCKING', 'WARNING']),
  regulatoryReference: z.string().optional(),
});

const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BOOLEAN'), passed: z.boolean() }),
  z.object({ kind: z.literal('TEXT'), value: z.string() }),
]);

const itemNoteSchema = z.object({
  notes: z.string(),
  notesSource: z.enum(['TYPED', 'VOICE_TRANSCRIBED', 'VOICE_EDITED']),
  rawTranscript: z.string().nullable(),
});

const storedDraftSchema = z.object({
  savedAt: z.string().datetime(),
  draft: z.object({
    equipmentId: z.string(),
    templateId: z.string(),
    items: z.array(checklistItemSchema),
    answers: z.record(answerSchema),
    notes: z.record(itemNoteSchema),
    photoIds: z.record(z.array(z.string())),
    submitIdempotencyKey: z.string().optional(),
  }),
});

export const saveDraft = (storage: DraftStorage, draft: DraftSnapshot, now: Date): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: now.toISOString(), draft }));
};

const parseStored = (raw: string): z.infer<typeof storedDraftSchema> | null => {
  try {
    const result = storedDraftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    // JSON.parse on a truncated write. Not an error worth surfacing: the operator re-answers.
    return null;
  }
};

export const loadDraft = (
  storage: DraftStorage,
  equipmentId: string,
  now: Date,
): DraftSnapshot | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  const parsed = parseStored(raw);
  if (!parsed) return null;
  if (parsed.draft.equipmentId !== equipmentId) return null;
  if (labLocalDay(new Date(parsed.savedAt)) !== labLocalDay(now)) return null;
  return parsed.draft;
};

export const clearDraft = (storage: DraftStorage): void => {
  storage.removeItem(STORAGE_KEY);
};

// sessionStorage, or null during the server render and wherever storage is unavailable (Safari
// private mode throws on access). Callers treat null as "no draft", so persistence degrades to
// the pre-DEV-125 in-memory behaviour rather than breaking the inspection.
export const browserDraftStorage = (): DraftStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};
