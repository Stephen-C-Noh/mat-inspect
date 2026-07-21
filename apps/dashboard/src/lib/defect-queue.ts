import type { Defect, Equipment } from '@mat-inspect/shared-schemas';

const LAB_TIMEZONE = 'America/Edmonton';

// A resolved BLOCKING defect stays open until return-to-service is approved (ADR 0006's
// watermark): resolution alone does not restore readiness, so the queue must keep showing it.
// This is the single source of truth for that condition; isQueueOpen delegates to it.
export const isPendingApproval = (defect: Defect): boolean =>
  defect.status === 'RESOLVED' &&
  defect.severity === 'BLOCKING' &&
  defect.returnToServiceApprovedBy === null;

// Mirrors the server's return-to-service watermark (ADR 0006): a defect leaves the queue
// once it can no longer affect equipment readiness. WARNING defects clear on RESOLVED alone,
// since return-to-service only applies to BLOCKING severity. REJECTED never counts as open.
export const isQueueOpen = (defect: Defect): boolean => {
  if (defect.status === 'REJECTED') return false;
  if (defect.status !== 'RESOLVED') return true;
  return isPendingApproval(defect);
};

// Shared equipment lookup for the defect views: the Failure Queue and the Defects table both
// join equipment metadata (name, asset tag, location) onto a defect by id. Undefined until the
// equipment query resolves, and for any id not in the fetched fleet.
export const findEquipment = (
  equipmentList: Equipment[] | undefined,
  equipmentId: string,
): Equipment | undefined => (equipmentList ?? []).find((e) => e.id === equipmentId);

export const isActive = (defect: Defect): boolean =>
  defect.status === 'ACKNOWLEDGED' || defect.status === 'IN_REPAIR';

const labLocalDateKey = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: LAB_TIMEZONE });

// Opened on the current lab-local calendar day (ADR 0006's day boundary), not a rolling 24h
// window, so the badge resets at the same midnight the readiness check does.
export const isNewToday = (defect: Defect): boolean =>
  labLocalDateKey(defect.openedAt) === labLocalDateKey(new Date().toISOString());

export const formatAge = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Cosmetic display code only (e.g. "DEF-0001" / "INS-0001"); the real id used for API calls
// stays defect.id / defect.inspectionId.
export const shortCode = (prefix: string, id: string): string => {
  const match = /(\d+)$/.exec(id);
  return match ? `${prefix}-${match[1].padStart(4, '0')}` : id.slice(0, 8).toUpperCase();
};

export const categoryFor = (itemKey: string): string =>
  itemKey
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
