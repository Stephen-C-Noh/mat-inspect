'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import { getActiveAccount, hasAllowedRole } from '@mat-inspect/shared-auth';
import { AuthGuard } from '@/components/auth-guard';
import { DASHBOARD_LINK_ROLES } from '@/lib/auth';
import { useEquipmentList } from '../hooks/use-equipment';
import { useMyInspections } from '@/hooks/use-my-inspections';
import { RESULT_DISPLAY, formatInspectionDate } from '@/lib/inspection-display';
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
  const { instance, accounts } = useMsal();
  const { data: equipmentList, isLoading } = useEquipmentList();
  const { data: recentInspections } = useMyInspections({ limit: 3 });
  const [searchTerm, setSearchTerm] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Operators have no manager dashboard to go to; supervisors (and, in principle, manager/admin,
  // though those roles never reach the PWA per its own ALLOWED_ROLES) do.
  const canSeeDashboard = hasAllowedRole(
    getActiveAccount(instance, accounts),
    DASHBOARD_LINK_ROLES,
  );
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;

  const equipmentById = useMemo(
    () => new Map((equipmentList ?? []).map((e) => [e.id, e])),
    [equipmentList],
  );

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
            <button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground py-4 px-4 rounded-sm shadow-card border border-accent flex items-center justify-center gap-2 transition-all">
              <div className="bg-accent-foreground/20 p-1.5 rounded-sm">
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
            className="w-full pl-12 pr-4 py-4 rounded-sm border border-border shadow-card focus:ring-2 focus:ring-ring outline-none text-base bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {recentInspections && recentInspections.length > 0 && (
          <div className="bg-card rounded-sm shadow-card border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-muted-foreground text-sm">RECENTLY INSPECTED</h3>
              <Link href="/history" className="text-sm font-bold text-accent hover:text-accent/80">
                View All
              </Link>
            </div>
            <div className="divide-y divide-border">
              {recentInspections.map((inspection) => {
                const equipment = equipmentById.get(inspection.equipmentId);
                const display = RESULT_DISPLAY[inspection.result];
                return (
                  <Link
                    key={inspection.id}
                    href={`/history/${inspection.id}`}
                    className="p-4 flex items-center justify-between gap-3 hover:bg-muted transition-colors"
                  >
                    <div className="min-w-0">
                      <h4 className="truncate font-bold text-base text-foreground">
                        {equipment?.name ?? 'Equipment'}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {formatInspectionDate(inspection.submittedAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-bold ${display.badgeClass}`}
                    >
                      {display.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-card rounded-sm shadow-card border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="font-semibold text-muted-foreground text-sm">SELECT EQUIPMENT</h3>
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
                  <div className="bg-muted w-12 h-12 rounded-sm flex items-center justify-center">
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
          {canSeeDashboard && dashboardUrl && (
            <a
              href={dashboardUrl}
              className="flex items-center justify-center gap-2 bg-card py-4 rounded-sm border border-border shadow-card transition-all font-semibold text-sm text-foreground"
            >
              <LayoutDashboard className="size-5 text-accent" /> Dashboard
            </a>
          )}
          <NavButton icon={History} label="History" href="/history" />
          <NavButton icon={Settings} label="Settings" href="/settings" />
          <NavButton icon={HelpCircle} label="Help Center" href="/help" />
        </div>
      </div>
    </main>
  );
}

function NavButton({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-2 bg-card py-4 rounded-sm border border-border shadow-card transition-all font-semibold text-sm text-foreground"
    >
      <Icon className="size-5 text-accent" /> {label}
    </Link>
  );
}

export default function EquipmentPage() {
  return (
    <AuthGuard>
      <LandingPageContent />
    </AuthGuard>
  );
}
