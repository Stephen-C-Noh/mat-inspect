'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useEquipmentLookup } from '../hooks/use-equipment-lookup';

// Component orchestrating camera-based QR detection and inspection-gate logic.
// Follows mobile-first UI patterns for gloved-operator accessibility.
export const QrScanner = (): React.ReactElement => {
  const [assetTag, setAssetTag] = useState<string | null>(null);
  const { data: equipment, error, isLoading } = useEquipmentLookup(assetTag);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5QrcodeScanner(
      'reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false,
    );
    scannerRef.current.render(
      (decodedText) => {
        setAssetTag(decodedText);
        scannerRef.current?.pause();
      },
      (_err) => {},
    );

    return () => {
      scannerRef.current?.clear().catch(() => {});
    };
  }, []);

  if (isLoading) return <div className="p-8 text-center">Resolving equipment...</div>;

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-center">
        <p className="text-red-700 font-bold mb-4">
          {error.message === 'EQUIPMENT_NOT_FOUND' ? 'Equipment not found' : 'Scan failed'}
        </p>
        <button
          onClick={() => {
            setAssetTag(null);
            scannerRef.current?.resume();
          }}
          className="bg-red-600 text-white px-6 py-3 rounded-lg font-bold"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (equipment) {
    const isLocked = equipment.status === 'OUT_OF_SERVICE' || equipment.status === 'RETIRED';
    return (
      <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-lg w-full max-w-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-2">{equipment.name}</h2>
        <p className="text-slate-500 mb-4">
          {equipment.type} • {equipment.location}
        </p>

        <div
          className={`p-4 rounded-lg font-bold text-center mb-6 ${isLocked ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}
        >
          Status: {equipment.status}
        </div>

        {isLocked ? (
          <p className="text-red-600 font-bold text-center">Lockout: Cannot start inspection.</p>
        ) : (
          <button className="w-full bg-blue-600 text-white py-4 rounded-lg font-bold text-lg">
            Start Checklist
          </button>
        )}
      </div>
    );
  }

  return <div id="reader" className="w-full max-w-sm"></div>;
};
