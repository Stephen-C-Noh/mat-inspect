// GET /api/v1/equipment is operator-only today (services/core-api/src/routes/equipment/list.ts),
// so the dashboard can't fetch real equipment names/locations/assetTags yet (DEV-35 is
// dashboard-only in scope; opening that endpoint up is a separate, backend-owned change).
// This stands in for that join until it does.
type MockEquipment = { id: string; name: string; assetTag: string; location: string };

export const MOCK_EQUIPMENT: MockEquipment[] = [
  { id: 'eq-oc-102', name: 'Overhead Crane TD102', assetTag: 'MAT-OC-002', location: 'Bay 3' },
  {
    id: 'eq-tr-chevy',
    name: 'Truck (Chevrolet)',
    assetTag: 'MAT-TR-001',
    location: 'Vehicle Compound',
  },
  { id: 'eq-fl-1', name: 'Forklift 1', assetTag: 'MAT-FL-001', location: 'Warehouse A' },
];
