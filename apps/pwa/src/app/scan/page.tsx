'use client';

import { useRouter } from 'next/navigation';
import type { Equipment } from '@mat-inspect/shared-schemas';
import { QrScanScreen } from '@/components/qr-scan-screen';

// Auth is enforced by the AuthGuard in the root layout, so the page only wires the
// scan result to the inspection route.
export default function ScanPage() {
  const router = useRouter();

  const handleResolved = (equipment: Equipment) => {
    router.push(`/inspect/${equipment.id}`);
  };

  return <QrScanScreen onResolved={handleResolved} />;
}
