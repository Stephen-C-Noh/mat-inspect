// 'auditor' is read-only and time-boxed (ADR 0021): it is never inherited by manager/admin, and
// no route should treat it as equivalent to manager.
export type UserRole = 'operator' | 'supervisor' | 'manager' | 'admin' | 'auditor';

export type EquipmentType = 'OVERHEAD_CRANE' | 'TRUCK' | 'ELECTRIC_PALLET_JACK' | 'FORKLIFT';

export type EquipmentStatus = 'READY' | 'AWAITING_INSPECTION' | 'OUT_OF_SERVICE' | 'RETIRED';

export type InspectionResult = 'PASS' | 'FAIL_WARNING' | 'FAIL_BLOCKING';

export type DefectStatus = 'OPEN' | 'ACKNOWLEDGED' | 'IN_REPAIR' | 'RESOLVED' | 'REJECTED';

export type NotesSource = 'TYPED' | 'VOICE_TRANSCRIBED' | 'VOICE_EDITED';

// Single source for the defect-category taxonomy (ADR 0028): the Postgres pgEnum
// (db/schema/inspections.ts), the Zod submit validation (shared-schemas), and the PWA chip set
// all read this array, so the eight values are declared once. The Advisory Check model suggests
// one of the first seven or abstains; it never suggests OTHER (Operator-only manual choice).
export const DEFECT_CATEGORY_VALUES = [
  'LEAK',
  'DAMAGE',
  'WEAR',
  'MALFUNCTION',
  'MISSING',
  'CONTAMINATION',
  'NOISE_VIBRATION',
  'OTHER',
] as const;

export type DefectCategory = (typeof DEFECT_CATEGORY_VALUES)[number];

// The subset the Advisory Check model may suggest (ADR 0028, decision 2): OTHER is an
// Operator-only manual choice, never a model output. Used to validate the AI Service's
// /advisory response and the core-api proxy's response, so a model bug that somehow emits
// OTHER is rejected (fail-open to UNAVAILABLE) instead of passed through as a suggestion.
export const MODEL_SUGGESTABLE_DEFECT_CATEGORY_VALUES = [
  'LEAK',
  'DAMAGE',
  'WEAR',
  'MALFUNCTION',
  'MISSING',
  'CONTAMINATION',
  'NOISE_VIBRATION',
] as const;

export type ModelSuggestableDefectCategory =
  (typeof MODEL_SUGGESTABLE_DEFECT_CATEGORY_VALUES)[number];

// Only three types render (DEV-16, DEV-75). SIGNATURE is rejected by ADR 0007 and
// MEASUREMENT is out of scope; abnormal readings go in free-text notes (FRS).
export type ChecklistItemType = 'BOOLEAN' | 'BOOLEAN_PHOTO_ON_FAIL' | 'TEXT';

export type FailSeverity = 'BLOCKING' | 'WARNING';

export type ChecklistItem = {
  key: string;
  prompt: string;
  type: ChecklistItemType;
  required: boolean;
  failSeverity: FailSeverity;
  // Cites the source clause, e.g. "OHS Part 19 s.257" (Section 8.8: checklist drives
  // pass/fail, not free text or AI).
  regulatoryReference?: string;
};

export type ChecklistTemplate = {
  id: string;
  equipmentType: EquipmentType;
  version: number;
  isActive: boolean;
  effectiveFrom: string;
  items: ChecklistItem[];
  createdBy: string;
  reviewedBy?: string | null;
  createdAt: string;
};
