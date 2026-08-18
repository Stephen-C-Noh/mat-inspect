'use client';

import { useEffect, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { categorizeNoteResponseSchema } from '@mat-inspect/shared-schemas';
import type { DefectCategory } from '@mat-inspect/shared-types';
import { acquireAccessToken } from '@/lib/auth';

export type NotedFailure = { itemKey: string; noteText: string };

// Requests a defect-category suggestion for each FAIL item that has a note, once per item (ADR
// 0028). "Once per item" is enforced two ways: hasSuggestion lets the caller skip an item whose
// draft already carries a suggested/confirmed value or was already requested and came back empty
// (so a remount of the review screen does not re-request an already-decided or already-abstained
// item), and requestedRef stops this effect from refiring the same request on every re-render
// within one mount.
//
// Fails open at every layer: core-api's /ai/categorize proxy always answers 200 (never an error
// status), and a network failure reaching it here is folded into the same "no suggestion"
// outcome. The review screen never needs a retry affordance for this call; the Operator can
// always fall back to "Add category" and pick manually.
export const useDefectCategorySuggestions = (
  items: NotedFailure[],
  hasSuggestion: (itemKey: string) => boolean,
  onSuggestion: (itemKey: string, category: DefectCategory | null) => void,
): void => {
  const { instance, accounts } = useMsal();
  const requestedRef = useRef<Set<string>>(new Set());

  const itemsKey = items.map((item) => item.itemKey).join(',');

  useEffect(() => {
    for (const item of items) {
      if (hasSuggestion(item.itemKey) || requestedRef.current.has(item.itemKey)) continue;
      requestedRef.current.add(item.itemKey);

      void (async () => {
        try {
          const accessToken = await acquireAccessToken(instance, accounts);
          const res = await fetch('/api/v1/ai/categorize', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ noteText: item.noteText }),
          });

          if (!res.ok) {
            onSuggestion(item.itemKey, null);
            return;
          }

          const parsed = categorizeNoteResponseSchema.safeParse(await res.json());
          onSuggestion(item.itemKey, parsed.success ? parsed.data.category : null);
        } catch {
          onSuggestion(item.itemKey, null);
        }
      })();
    }
    // itemsKey (not items) is the real dependency: a new array reference on every render must not
    // refire this effect, only a change in which item keys are present.
  }, [itemsKey]);
};
