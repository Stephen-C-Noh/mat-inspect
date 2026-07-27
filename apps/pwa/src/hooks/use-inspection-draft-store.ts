'use client';

import { useCallback, useState } from 'react';
import {
  browserDraftStorage,
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftSnapshot,
} from '@/lib/inspection-draft-storage';

type DraftStore = {
  // The draft found in storage on this screen's first render, or null for a fresh inspection.
  // Read once: re-reading on later renders would fight the operator's in-flight edits.
  restored: DraftSnapshot | null;
  save: (draft: DraftSnapshot) => void;
  clear: () => void;
};

// Binds a screen to the persisted draft for one piece of equipment. Both inspection screens use
// it, so the checklist and the failure-documentation screens read and write the same record and a
// page load between them keeps the operator's work (DEV-125).
//
// The initial read happens in a useState initializer rather than an effect, so a restored draft is
// present on the first painted render and the operator never sees their answers blink in. Both
// screens sit inside AuthGuard, which renders nothing until MSAL resolves, so this never runs
// during the server render and cannot cause a hydration mismatch.
export const useInspectionDraftStore = (equipmentId: string): DraftStore => {
  const [restored] = useState<DraftSnapshot | null>(() => {
    const storage = browserDraftStorage();
    return storage ? loadDraft(storage, equipmentId, new Date()) : null;
  });

  const save = useCallback((draft: DraftSnapshot) => {
    const storage = browserDraftStorage();
    if (storage) saveDraft(storage, draft, new Date());
  }, []);

  const clear = useCallback(() => {
    const storage = browserDraftStorage();
    if (storage) clearDraft(storage);
  }, []);

  return { restored, save, clear };
};
