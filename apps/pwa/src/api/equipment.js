const USE_MOCK = true

const mockData = [
  { id: 1, assetTag: "FORK-001", name: "Toyota Forklift", location: "CB109", safety: "SAFE" },
  { id: 2, assetTag: "FORK-002", name: "Toyota Forklift", location: "CB109", safety: "SAFE" },
  { id: 3, assetTag: "FORK-003", name: "Toyota Forklift", location: "CC Auto", safety: "WARNING" },
  { id: 4, assetTag: "PWR-001", name: "Electric Pallet Jack", location: "CB109", safety: "SAFE" },
  { id: 5, assetTag: "TRK-001", name: "Chevy Truck", location: "Garage", safety: "SAFE" },
  { id: 6, assetTag: "TRK-002", name: "Ford Truck", location: "Garage", safety: "DANGER" },
  { id: 7, assetTag: "CRN-001", name: "Overhead Crane", location: "TD102", safety: "SAFE" },
  { id: 8, assetTag: "CRN-002", name: "Overhead Crane", location: "TD104", safety: "WARNING" },
  { id: 9, assetTag: "CRN-003", name: "Gantry Crane", location: "TF121", safety: "SAFE" },
  { id: 10, assetTag: "MLT-001", name: "Millwright Crane", location: "TF103", safety: "DANGER" }
]

export async function fetchEquipment() {
  await new Promise(r => setTimeout(r, 800))

  if (USE_MOCK) return mockData

  const res = await fetch('/api/v1/equipment')
  if (!res.ok) throw new Error('API failed')
  return res.json()
}
