'use client';

import { useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useEquipmentLookup } from '../hooks/use-equipment-lookup';
import type { Equipment } from '@mat-inspect/shared-schemas';

// Matches the status palette on the equipment list page: READY green, awaiting yellow,
// out-of-service red. A binary green/amber split hid OUT_OF_SERVICE behind a green badge.
const STATUS_THEME: Record<Equipment['status'], string> = {
  READY: 'bg-green-100 text-green-800',
  AWAITING_INSPECTION: 'bg-amber-100 text-amber-800',
  OUT_OF_SERVICE: 'bg-red-100 text-red-800',
  RETIRED: 'bg-slate-200 text-slate-700',
};

export const QrScanner = (): React.ReactElement => {
  const [assetTag, setAssetTag] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  const { data: equipment, error, isLoading } = useEquipmentLookup(assetTag);

  const startScanner = () => {
    setIsScanning(true);
    // Timeout gives the DOM time to render the 'reader' div
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        'reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        true, // Set to TRUE to keep the built-in library UI
      );

      scanner.render(
        (decodedText) => {
          const tag = decodedText.trim().split('/').pop() ?? decodedText.trim();
          setAssetTag(tag.toUpperCase());
          scanner.clear();
          setIsScanning(false);
        },
        () => {},
      );

      scannerRef.current = scanner;
    }, 100);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm p-4 mx-auto">
      {!isScanning && !equipment && !isLoading && !error && (
        <button
          onClick={startScanner}
          className="w-full max-w-[200px] mx-auto bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 text-lg transition-all"
        >
          SCAN QR CODE
        </button>
      )}

      {/* The container where the library injects its UI */}
      {isScanning && (
        <div className="w-full">
          <div id="reader" className="w-full"></div>
          <button
            onClick={() => {
              scannerRef.current?.clear();
              setIsScanning(false);
            }}
            className="mt-4 w-full bg-slate-200 py-4 rounded-xl font-bold hover:bg-slate-300"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading && <p>Resolving...</p>}

      {equipment && (
        <div className="mt-6 p-6 bg-white border rounded-2xl w-full">
          <h2 className="text-xl font-bold">{equipment.name}</h2>
          <div
            className={`p-4 rounded-xl font-bold text-center mt-4 ${STATUS_THEME[equipment.status]}`}
          >
            Status: {equipment.status.replaceAll('_', ' ')}
          </div>
          <button onClick={() => setAssetTag(null)} className="mt-4 w-full underline">
            Scan another
          </button>
        </div>
      )}
    </div>
  );
};
