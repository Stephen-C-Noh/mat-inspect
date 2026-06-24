'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { useEquipmentList } from '../hooks/use-equipment';
import {
  Search,
  ChevronRight,
  LayoutDashboard,
  History,
  Settings,
  HelpCircle,
  QrCode,
  Forklift,
  Truck,
  Construction,
  Package,
  LucideIcon,
  Wrench,
} from 'lucide-react';

// Refactored icon colors to use 'accent' token
function EquipmentIcon({ name }: { name: string }) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('forklift')) return <Forklift className="size-6 text-accent" />;
  if (lowerName.includes('truck')) return <Truck className="size-6 text-accent" />;
  if (lowerName.includes('crane')) return <Construction className="size-6 text-accent" />;
  if (lowerName.includes('pallet')) return <Package className="size-6 text-accent" />;
  return <Wrench className="size-6 text-accent" />;
}

function LandingPageContent() {
  const { data: equipmentList, isLoading } = useEquipmentList();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filteredAndSorted = useMemo(() => {
    if (!equipmentList) return [];
    return equipmentList
      .filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.assetTag?.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [equipmentList, searchTerm]);

  const displayedEquipment = showAll ? filteredAndSorted : filteredAndSorted.slice(0, 3);

  return (
    <main className="min-h-screen bg-muted flex justify-center py-6 px-4 md:py-10">
      <div className="w-full max-w-lg space-y-8">
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold text-foreground">Site Inspection</h2>
          <p className="text-base text-muted-foreground mt-2">
            Select equipment to begin a new check
          </p>
        </div>

        <div className="mt-6">
          <Link href="/scan" className="w-full">
            <button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground py-4 px-4 rounded-lg shadow-card border border-accent flex items-center justify-center gap-2 transition-all">
              <div className="bg-accent-foreground/20 p-1.5 rounded-md">
                <QrCode className="size-6 text-accent-foreground" />
              </div>
              <span className="font-bold text-sm tracking-wide">SCAN QR CODE</span>
            </button>
          </Link>
        </div>

        <div className="relative mt-8">
          <Search className="size-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by Equipment ID, Name or Tag"
            className="w-full pl-12 pr-4 py-4 rounded-lg border border-border shadow-card focus:ring-2 focus:ring-ring outline-none text-base bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="bg-card rounded-lg shadow-card border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="font-semibold text-muted-foreground text-sm">RECENTLY INSPECTED</h3>
            {filteredAndSorted.length > 3 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-sm font-bold text-accent hover:text-accent/80"
              >
                {showAll ? 'Show Less' : 'View All'}
              </button>
            )}
          </div>

          {isLoading && <p className="p-8 text-center text-sm">Loading...</p>}

          {!isLoading && filteredAndSorted.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-muted-foreground text-sm">
                No equipment found matching "{searchTerm}"
              </p>
              <button
                onClick={() => setSearchTerm('')}
                className="mt-2 text-accent text-xs font-bold underline"
              >
                Clear search
              </button>
            </div>
          )}

          <div className="divide-y divide-border">
            {displayedEquipment.map((item) => (
              // Row navigates to the canonical inspection route (DEV-62). The row was
              // styled as clickable (cursor-pointer, chevron) but not wired; this is the
              // home-list entry point DEV-16 requires.
              <Link
                key={item.id}
                href={`/inspect/${item.id}`}
                className="p-4 flex items-center justify-between hover:bg-muted transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-muted w-12 h-12 rounded-lg flex items-center justify-center">
                    <EquipmentIcon name={item.name} />
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-foreground">{item.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {item.location} • {item.assetTag}
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NavButton icon={LayoutDashboard} label="Dashboard" />
          <NavButton icon={History} label="History" />
          <NavButton icon={Settings} label="Settings" />
          <NavButton icon={HelpCircle} label="Help Center" />
        </div>
      </div>
    </main>
  );
}

function NavButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button className="flex items-center justify-center gap-2 bg-card py-4 rounded-lg border border-border shadow-card transition-all font-semibold text-sm">
      <Icon className="size-5 text-accent" /> {label}
    </button>
  );
}

export default function EquipmentPage() {
  return (
    <AuthGuard>
      <LandingPageContent />
    </AuthGuard>
  );
}
