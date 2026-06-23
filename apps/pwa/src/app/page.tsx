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

// Helper to pick the right icon based on what the equipment is called
function EquipmentIcon({ name }: { name: string }) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('forklift')) return <Forklift className="w-6 h-6 text-blue-600" />;
  if (lowerName.includes('truck')) return <Truck className="w-6 h-6 text-blue-600" />;
  if (lowerName.includes('crane')) return <Construction className="w-6 h-6 text-blue-600" />;
  if (lowerName.includes('pallet')) return <Package className="w-6 h-6 text-blue-600" />;
  return <Wrench className="w-6 h-6 text-blue-600" />; // Default icon for everything else
}

function LandingPageContent() {
  const { data: equipmentList, isLoading } = useEquipmentList();
  const [searchTerm, setSearchTerm] = useState(''); // Keeps track of what the user is typing
  const [showAll, setShowAll] = useState(false); // Toggles between "top 3" and "full list"

  // This part filters the list while the user types, then sorts by newest first
  const filteredAndSorted = useMemo(() => {
    if (!equipmentList) return [];

    return (
      equipmentList
        .filter(
          (item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.assetTag?.toLowerCase().includes(searchTerm.toLowerCase()),
        )
        // Sorts by 'updatedAt' so the most recently changed equipment is always at the top
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    );
  }, [equipmentList, searchTerm]);

  // Only show 3 items by default, or all of them if the user clicks "View All"
  const displayedEquipment = showAll ? filteredAndSorted : filteredAndSorted.slice(0, 3);

  return (
    <main className="min-h-screen bg-gray-50 flex justify-center py-6 px-4 md:py-10">
      <div className="w-full max-w-lg space-y-8">
        {/* Top greeting and instructions */}
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold text-gray-900">Site Inspection</h2>
          <p className="text-base text-gray-500 mt-2">Select equipment to begin a new check</p>
        </div>

        {/* Scan QR code button */}
        <div className="mt-6">
          <Link href="/scan" className="w-full">
            <button className="w-full bg-[#0066CC] hover:bg-[#0052a3] text-white py-4 px-4 rounded-xl shadow-sm border border-blue-700 flex items-center justify-center gap-2 transition-all">
              <div className="bg-white/20 p-1.5 rounded-md">
                <QrCode className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-sm tracking-wide">SCAN QR CODE</span>
            </button>
          </Link>
        </div>

        {/* Input box for finding specific equipment */}
        <div className="relative mt-8">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by Equipment ID, Name or Tag"
            className="w-full pl-12 pr-4 py-4 rounded-xl border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none text-base"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* The main list container */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-semibold text-gray-700 text-sm">RECENTLY INSPECTED</h3>
            {filteredAndSorted.length > 3 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-sm font-bold text-blue-600 hover:text-blue-800"
              >
                {showAll ? 'Show Less' : 'View All'}
              </button>
            )}
          </div>

          {/* Show a message if we are still waiting for the list to load */}
          {isLoading && <p className="p-8 text-center text-sm">Loading...</p>}

          {/* message if the user types something that doesn't exist */}
          {!isLoading && filteredAndSorted.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-gray-500 text-sm">No equipment found matching "{searchTerm}"</p>
              <button
                onClick={() => setSearchTerm('')}
                className="mt-2 text-blue-600 text-xs font-bold underline"
              >
                Clear search
              </button>
            </div>
          )}

          {/* Mapping through the filtered list to show each item */}
          <div className="divide-y divide-gray-100">
            {displayedEquipment.map((item) => (
              <div
                key={item.id}
                className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-blue-50 w-12 h-12 rounded-lg flex items-center justify-center">
                    <EquipmentIcon name={item.name} />
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-gray-900">{item.name}</h4>
                    <p className="text-sm text-gray-500">
                      {item.location} • {item.assetTag}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            ))}
          </div>
        </div>

        {/* Footer menu for navigation */}
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

// Simple button component for the bottom nav
function NavButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button className="flex items-center justify-center gap-2 bg-white py-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all font-semibold text-sm">
      <Icon className="w-5 h-5 text-blue-600" /> {label}
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
