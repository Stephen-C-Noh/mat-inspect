export type UserRole = 'operator' | 'supervisor' | 'manager' | 'admin';

export type EquipmentType = 'OVERHEAD_CRANE' | 'TRUCK' | 'ELECTRIC_PALLET_JACK' | 'FORKLIFT';

export type EquipmentStatus = 'READY' | 'AWAITING_INSPECTION' | 'OUT_OF_SERVICE' | 'RETIRED';

export type InspectionResult = 'PASS' | 'FAIL_WARNING' | 'FAIL_BLOCKING';

export type NotesSource = 'TYPED' | 'VOICE_TRANSCRIBED' | 'VOICE_EDITED';

export type ChecklistItemType =
  | 'BOOLEAN'
  | 'BOOLEAN_PHOTO_ON_FAIL'
  | 'MEASUREMENT'
  | 'TEXT'
  | 'SIGNATURE';

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
