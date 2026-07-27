'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Bell } from 'lucide-react';
import type { InspectionResult } from '@mat-inspect/shared-types';
import { useActivity } from '@/components/activity-provider';

const RESULT_LABEL: Record<InspectionResult, string> = {
  PASS: 'Pass',
  FAIL_WARNING: 'Fail (Warning)',
  FAIL_BLOCKING: 'Fail (Blocking)',
};

const RESULT_CLASSES: Record<InspectionResult, string> = {
  PASS: 'bg-success text-success-foreground',
  FAIL_WARNING: 'bg-warning text-warning-foreground',
  FAIL_BLOCKING: 'bg-destructive text-destructive-foreground',
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });

// The inspections that arrived while the manager was looking at the dashboard. The bell was an
// inert icon until now; the point of making it real is that a manager who steps away for ten
// minutes can see what they missed rather than comparing a screen against their memory of it
// (DEV-127).
export const NotificationBell = (): ReactElement => {
  const { unread, markAllRead } = useActivity();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Hand-rolled rather than a popover dependency: this is the
  // only overlay on the dashboard, and the project adds dependencies only with a justification.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const count = unread.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={
          count === 0 ? 'Notifications, none new' : `Notifications, ${count} new inspections`
        }
        className="relative rounded-sm p-1 hover:bg-primary-foreground/10"
      >
        <Bell className="size-6" aria-hidden />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="region"
          aria-label="New inspections"
          className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-border bg-card text-foreground shadow-card"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              New inspections
            </p>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>

          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing new since you opened the dashboard.
            </p>
          ) : (
            <ul aria-label="New inspection notifications" className="max-h-80 overflow-y-auto">
              {unread.map((item) => (
                <li key={item.id} className="border-b border-border px-4 py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{item.equipmentName}</p>
                      <p className="text-xs text-muted-foreground">{item.equipmentAssetTag}</p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-lg px-2 py-0.5 text-xs font-bold ${RESULT_CLASSES[item.result]}`}
                    >
                      {RESULT_LABEL[item.result]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.operatorDisplayName} &middot; {formatTime(item.submittedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* An entry cannot link to its own machine yet: fleet selection is component state with
              no URL behind it, which is DEV-128. Until that lands, the panel hands off to Fleet. */}
          <div className="border-t border-border px-4 py-2">
            <Link
              href="/fleet"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Open Fleet
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
