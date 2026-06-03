export type UserRole = 'operator' | 'supervisor' | 'manager' | 'admin';

export type EquipmentStatus = 'READY' | 'AWAITING_INSPECTION' | 'OUT_OF_SERVICE' | 'RETIRED';

export type InspectionResult = 'PASS' | 'FAIL_WARNING' | 'FAIL_BLOCKING';

export type NotesSource = 'TYPED' | 'VOICE_TRANSCRIBED' | 'VOICE_EDITED';

export type ChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  allowVoiceNote: boolean;
};

export type ChecklistTemplate = {
  id: string;
  version: number;
  equipmentType: string;
  items: ChecklistItem[];
};
