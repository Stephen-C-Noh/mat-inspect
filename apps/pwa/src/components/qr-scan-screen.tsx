'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Html5Qrcode } from 'html5-qrcode';
import type { Equipment } from '@mat-inspect/shared-schemas';
import { useEquipmentLookup } from '../hooks/use-equipment-lookup';
import { useEquipmentList } from '../hooks/use-equipment';
import { ChevronLeftIcon, EquipmentIcon, QrCodeIcon, RefreshIcon, XIcon } from './ui/icons';

// The reader div id html5-qrcode mounts the camera <video> into.
const READER_ID = 'qr-reader';

// idle: before the first start attempt. starting: start() in flight. scanning: live
// feed is up. denied: the browser refused the camera or none is available, so the
// operator falls back to the quick list or manual entry (OHS s.257 still needs a human).
type CameraState = 'idle' | 'starting' | 'scanning' | 'denied';

type Props = {
  // Where to go once a tag resolves to a real equipment row. The scan screen only
  // identifies the asset; the inspection flow (screen 03) takes over from here.
  onResolved: (equipment: Equipment) => void;
};

// QR payloads may be a full URL (https://.../equipment/SAIT-FL-03) or the bare tag.
// Take the last path segment and normalize so the lookup matches the stored asset tag.
const tagFromScan = (decoded: string): string => {
  const trimmed = decoded.trim();
  return (trimmed.split('/').pop() ?? trimmed).toUpperCase();
};

export const QrScanScreen = ({ onResolved }: Props): React.ReactElement => {
  const router = useRouter();
  const [assetTag, setAssetTag] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const { data: equipment, error, isLoading } = useEquipmentLookup(assetTag);
  const { data: equipmentList } = useEquipmentList();

  // A resolved tag means the asset exists; hand off to the inspection flow.
  useEffect(() => {
    if (equipment) onResolved(equipment);
  }, [equipment, onResolved]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // stop() rejects if the camera already released; nothing to recover.
    }
    scannerRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraState('starting');
    const scanner = new Html5Qrcode(READER_ID, false);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decoded) => {
          setAssetTag(tagFromScan(decoded));
          void stopCamera();
          setCameraState('idle');
        },
        () => {
          // Per-frame decode miss. Expected on most frames; ignore.
        },
      );
      setCameraState('scanning');
    } catch {
      // Permission refused, insecure context, or no camera. Fall back to manual entry.
      setCameraState('denied');
    }
  }, [stopCamera]);

  // Try the camera once on mount. Cleanup stops the stream on navigate away.
  useEffect(() => {
    void startCamera();
    return () => {
      void stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = manual.trim().toUpperCase();
    if (tag) setAssetTag(tag);
  };

  const notFound = error?.message === 'EQUIPMENT_NOT_FOUND';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col gap-6 bg-background px-4 py-5">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="flex size-9 items-center justify-center rounded-lg text-foreground hover:bg-muted"
      >
        <ChevronLeftIcon />
      </button>

      <header className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <QrCodeIcon className="size-7" />
        </span>
        <h1 className="text-2xl font-bold text-foreground">Scan Equipment QR Code</h1>
        <p className="text-sm text-muted-foreground">
          Point your camera at the QR code on the equipment to begin inspection
        </p>
      </header>

      <section className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        {/* html5-qrcode mounts the camera video here. Kept in the DOM so start() finds it. */}
        <div id={READER_ID} className="size-full [&_video]:size-full [&_video]:object-cover" />

        {cameraState === 'denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <XIcon className="size-12 text-destructive" />
            <p className="text-sm">
              Camera access denied. Enable camera permission or use manual entry.
            </p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
            >
              <RefreshIcon className="size-[18px]" />
              Try Again
            </button>
          </div>
        )}

        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Starting camera...
          </div>
        )}
      </section>

      {isLoading && <p className="text-center text-sm text-muted-foreground">Resolving tag...</p>}
      {notFound && (
        <p className="text-center text-sm text-destructive">
          No equipment found for {assetTag}. Check the tag and try again.
        </p>
      )}

      {equipmentList && equipmentList.length > 0 && (
        <section className="flex flex-col gap-3">
          {equipmentList.slice(0, 3).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onResolved(item)}
              className="flex items-center gap-3 rounded-sm border border-border bg-card px-4 py-3 text-left hover:bg-muted"
            >
              <EquipmentIcon className="size-6 shrink-0 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="font-semibold text-card-foreground">{item.name}</span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.location ?? item.assetTag}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      <form
        onSubmit={handleManualSubmit}
        className="flex flex-col gap-2 rounded-sm border border-border bg-muted p-4"
      >
        <label htmlFor="manual-tag" className="text-sm font-semibold text-foreground">
          Manual Entry
        </label>
        <div className="flex gap-2">
          <input
            id="manual-tag"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="e.g. SAIT-FL-03"
            autoCapitalize="characters"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!manual.trim()}
            className="rounded-lg bg-accent px-5 py-2 font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </form>
    </main>
  );
};
