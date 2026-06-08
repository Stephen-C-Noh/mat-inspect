'use client';

import { useEquipmentList } from '../hooks/use-equipment';
import { Card } from '../components/ui/card';

// Logic to determine the color theme based on your schema's status
const getThemeByStatus = (status: string) => {
  switch (status) {
    case 'READY':
      return {
        card: 'bg-green-50 border-green-200',
        badge: 'bg-green-200 text-green-900 border-green-300 shadow-sm',
      };
    case 'AWAITING_INSPECTION':
      return {
        card: 'bg-yellow-50 border-yellow-200',
        badge: 'bg-yellow-200 text-yellow-900 border-yellow-300 shadow-sm',
      };
    case 'OUT_OF_SERVICE':
      return {
        card: 'bg-red-50 border-red-200',
        badge: 'bg-red-200 text-red-900 border-red-300 shadow-sm',
      };
    case 'RETIRED':
      return {
        card: 'bg-slate-50 border-slate-200',
        badge: 'bg-slate-200 text-slate-800 border-slate-300 shadow-sm',
      };
    default:
      return {
        card: 'bg-white border-slate-200',
        badge: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
};

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">{label}</span>
      <span className="text-sm font-semibold text-slate-700 truncate">{value ?? '—'}</span>
    </div>
  );
}

export default function EquipmentPage() {
  const { data: equipmentList, isLoading, error } = useEquipmentList();

  if (isLoading) return <div className="p-8 text-center">Loading equipment list...</div>;
  if (error) return <div className="p-8 text-red-600 text-center">Error loading data.</div>;

  return (
    <main className="p-6 bg-slate-50 min-h-screen flex flex-col items-center">
      {/* Centered Title */}
      <h1 className="text-3xl font-bold mb-8 text-slate-800 text-center">Equipment List</h1>

      {/* Centered list container */}
      <div className="flex flex-col gap-4 w-full max-w-5xl">
        {equipmentList?.map((item) => {
          const theme = getThemeByStatus(item.status);

          return (
            <Card
              key={item.id}
              className={`w-full flex flex-col md:flex-row items-center justify-between p-4 transition-all
                border-2 shadow-sm hover:shadow-md ${theme.card}`}
            >
              {/* Identity Section */}
              <div className="w-full md:w-1/4 mb-3 md:mb-0">
                <h2 className="text-lg font-bold text-slate-900 leading-tight">{item.name}</h2>
                <span className="text-xs font-mono bg-white/50 text-slate-500 px-1.5 py-0.5 rounded border border-black/5">
                  {item.assetTag}
                </span>
              </div>

              {/* Specs Section */}
              <div className="w-full md:w-2/4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <InfoItem label="Type" value={item.type} />
                <InfoItem label="Make" value={item.make} />
                <InfoItem label="Model" value={item.model} />
                <InfoItem label="Loc" value={item.location} />
              </div>

              {/* Status Button Section */}
              <div className="w-full md:w-1/4 mt-4 md:mt-0 flex justify-end">
                <button
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border cursor-pointer active:scale-95 transition-transform ${theme.badge}`}
                >
                  {item.status}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
