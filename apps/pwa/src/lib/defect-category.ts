import type { DefectCategory } from '@mat-inspect/shared-types';
import { DEFECT_CATEGORY_VALUES } from '@mat-inspect/shared-types';

// One FAIL item's category state, kept in the draft alongside its note (ADR 0028). Both fields
// are absent by default; a key missing entirely from the draft's categories record means "no
// note yet, or the note has not been through the categorize flow".
export type ItemCategory = {
  // True once the categorize call for this item's note has resolved, whatever the outcome
  // (a suggestion, an abstain, or UNAVAILABLE). Distinguishes "asked, nothing came back" from
  // "not asked yet" so useDefectCategorySuggestions does not re-fire the request on every review
  // screen remount: without it an abstained or unavailable item looked identical to an unrequested
  // one (both left suggested/confirmed undefined) and got re-queried on every visit, burning the
  // shared, serialized mini-PC inference budget (ADR 0017) on a result already known.
  requested?: true;
  // The Advisory Check's top-1 suggestion, present only when the model returned a real category
  // (status OK, non-null). Absent covers "not requested yet", "the model abstained", and "the
  // model was unavailable" alike: all three render the same "no suggestion, Add category" state,
  // so there is nothing else worth distinguishing here.
  suggested?: DefectCategory;
  // The Operator's decision (ADR 0028: the confirmed value is the Operator's, not the model's).
  // undefined = not yet acted on (the suggested chip, if any, is still showing). null = the
  // Operator explicitly dismissed the suggestion. A value = confirmed, whether that is the
  // suggestion the Operator tapped to accept or a manual pick from the full set (including
  // OTHER, which the model never suggests).
  confirmed?: DefectCategory | null;
};

export const DEFECT_CATEGORY_LABELS: Record<DefectCategory, string> = {
  LEAK: 'Leak',
  DAMAGE: 'Damage',
  WEAR: 'Wear',
  MALFUNCTION: 'Malfunction',
  MISSING: 'Missing',
  CONTAMINATION: 'Contamination',
  NOISE_VIBRATION: 'Noise / Vibration',
  OTHER: 'Other',
};

export const DEFECT_CATEGORIES = DEFECT_CATEGORY_VALUES;
