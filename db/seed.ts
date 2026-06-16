import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { equipment } from './schema/equipment';
import { checklistTemplates, type ChecklistItemRecord } from './schema/checklist-templates';
import { users } from './schema/users';

const { Pool } = pg;

// Synthetic make/model values for realistic dev data. serial_number and
// manufacturer_specs_url stay null; they are populated during real onboarding.
const EQUIPMENT_RECORDS = [
  // Overhead cranes: 4 Heavy Equipment program units confirmed in AIA Inspection document.
  // Room numbers are used as location identifiers. Make/model from the equipment table in
  // that document. Serial numbers populated during onboarding, not here.
  {
    assetTag: 'MAT-OC-001',
    name: 'Overhead Crane TD102',
    type: 'OVERHEAD_CRANE' as const,
    make: 'Tappenden / Munck',
    model: '6 ton',
    location: 'TD102',
  },
  {
    assetTag: 'MAT-OC-002',
    name: 'Overhead Crane TD104',
    type: 'OVERHEAD_CRANE' as const,
    make: 'Tappenden / Munck',
    model: null,
    location: 'TD104',
  },
  {
    assetTag: 'MAT-OC-003',
    name: 'Overhead Crane TD106',
    type: 'OVERHEAD_CRANE' as const,
    make: 'Tappenden / Munck',
    model: null,
    location: 'TD106',
  },
  {
    assetTag: 'MAT-OC-004',
    name: 'Overhead Crane TF121',
    type: 'OVERHEAD_CRANE' as const,
    make: 'R&M Materials',
    model: 'Semi Gantry',
    location: 'TF121',
  },
  // Trucks: 1 Chevrolet and 1 Ford confirmed in AIA Inspection document.
  // Specific models not listed in the source document; serial numbers populated during onboarding.
  {
    assetTag: 'MAT-TR-001',
    name: 'Truck (Chevrolet)',
    type: 'TRUCK' as const,
    make: 'Chevrolet',
    model: null,
    location: 'MAT Campus',
  },
  {
    assetTag: 'MAT-TR-002',
    name: 'Truck (Ford)',
    type: 'TRUCK' as const,
    make: 'Ford',
    model: null,
    location: 'MAT Campus',
  },
  // Electric pallet jack: 1 Toyota unit in CB109.
  {
    assetTag: 'MAT-PJ-001',
    name: 'Electric Pallet Jack',
    type: 'ELECTRIC_PALLET_JACK' as const,
    make: 'Toyota',
    model: null,
    location: 'CB109',
  },
  // Forklifts: 3 Toyota Electric units — 2 in CB109, 1 in Clayton Carroll.
  {
    assetTag: 'MAT-FL-001',
    name: 'Forklift 1',
    type: 'FORKLIFT' as const,
    make: 'Toyota',
    model: null,
    location: 'CB109',
  },
  {
    assetTag: 'MAT-FL-002',
    name: 'Forklift 2',
    type: 'FORKLIFT' as const,
    make: 'Toyota',
    model: null,
    location: 'CB109',
  },
  {
    assetTag: 'MAT-FL-003',
    name: 'Forklift 3',
    type: 'FORKLIFT' as const,
    make: 'Toyota',
    model: null,
    location: 'Clayton Carroll',
  },
  // as const narrows type fields to literals so Drizzle's insert accepts them as enum values.
] as const;

// Fixed UUID so re-running the seed is idempotent. This user represents the project team
// that authored and reviewed the initial templates; it is not a real Entra ID account.
const SEED_USER_ID = '00000000-0000-0000-0000-000000000001';

const SEED_USER = {
  id: SEED_USER_ID,
  displayName: 'MAT-Inspect Seed',
  email: 'seed@mat-inspect.invalid',
} as const;

// Overhead crane pre-use inspection items.
// Source: Jenner's Overhead Crane Checklist (SAIT paper form, Sprint 0).
// Regulatory basis: Alberta OHS Part 6 s.94 — mandates CSA CAN/CSA B167-96 (R2007).
// Verify clause text at search-ohs-laws.alberta.ca before citing in operator-facing materials.
// Visual Check items follow Jenner's Overhead Crane Checklist order.
// Operations Check items follow the same checklist.
const OVERHEAD_CRANE_ITEMS: ChecklistItemRecord[] = [
  // --- Visual Check ---
  {
    key: 'travel_areas_clear',
    prompt: 'Travel areas are free and clear of obstructions.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'wheels_trolley_rollers',
    prompt: 'Wheels and trolley rollers are properly seated on the rails/beams.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'conductors_collectors',
    prompt: 'Conductors and collectors are free of debris.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'festooned_cables',
    prompt: 'Festooned cables are running free and not tangled or damaged.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'wire_rope',
    prompt: 'Wire rope is neatly spooled on the drum; no oil leaks or loose parts.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'hook_safety_clip',
    prompt: 'The hook is not sprung and the safety clip is in place.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'control_pendant',
    prompt: 'The control pendant is free of any damage.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'main_power_switch',
    prompt: 'The main power shut-off switch is accessible and turned on.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  // --- Operations Check ---
  {
    key: 'all_controls',
    prompt: 'Each button on the pendant causes the crane to respond as labelled; no unexpected motion.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'signal_lights_horn',
    prompt: 'Signal lights, horn, and proximity sensors are working correctly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'brakes',
    prompt: 'Crane stops smoothly when the travel button is released; does not coast excessively.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'hoist_limit_switch',
    prompt: 'Hoist limit switch trips and stops the hoist when the hook is slowly raised to the upper limit.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 6 s.94',
  },
  {
    key: 'operator_notes',
    prompt: 'Additional observations (optional).',
    type: 'TEXT',
    required: false,
    failSeverity: 'WARNING',
  },
];

// Truck pre-use inspection items.
// Source: SAIT Daily Vehicle Checklist (paper form, Sprint 0).
// Regulatory basis: Alberta OHS Part 19 s.257 (Powered Mobile Equipment).
// Verify clause text at search-ohs-laws.alberta.ca before citing in operator-facing materials.
const TRUCK_ITEMS: ChecklistItemRecord[] = [
  {
    key: 'engine_oil_coolant',
    prompt: 'Engine oil Or/And coolant levels are within acceptable range; no leaks visible.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'windshield_wipers_mirrors',
    prompt: 'Windshield intact; wipers operational; rearview and exterior mirrors present, clean, and adjusted.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'doors_windows',
    prompt: 'Doors and windows open, close, and seal correctly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'emergency_brake',
    prompt: 'Emergency/parking brake holds the vehicle stationary.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'tires',
    prompt: 'All tires (including spare) are in good condition; wear and pressure acceptable.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'seat_belts',
    prompt: 'Seat belts present and functional for all seating positions in use.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'fluid_leaks',
    prompt: 'Visual check under vehicle shows no fluid leaks.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'overall_condition',
    prompt: 'Vehicle free of physical damage (interior and exterior) that affects safe operation; housekeeping acceptable.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'fuel_gauges_warnings',
    prompt: 'Fuel level adequate; gauges functional; no dash warning lights active.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'horn',
    prompt: 'Horn sounds when activated.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'lights',
    prompt: 'Headlights, tail lights, turn signals, flashers, and warning lights functional.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  // --- Emergency Equipment ---
  {
    key: 'first_aid_kit',
    prompt: 'First aid kit is present and stocked.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'fire_extinguisher',
    prompt: 'Fire extinguisher is present, pin intact, and within service date.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'warning_reflectors_flares',
    prompt: 'Warning reflectors and flares are present.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'flashlight',
    prompt: 'Flashlight is present and functional.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'jack_lug_wrench_spare',
    prompt: 'Jack, lug wrench, and spare tire are present and in usable condition.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'communication_device',
    prompt: 'Communication device (phone or radio) is present and charged.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  // --- Documentation ---
  {
    key: 'insurance_card',
    prompt: 'Insurance card is present and valid.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'registration',
    prompt: 'Registration is present; license plate is intact and clearly visible.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'operator_notes',
    prompt: 'Additional observations (optional).',
    type: 'TEXT',
    required: false,
    failSeverity: 'WARNING',
  },
];

// Electric pallet jack pre-use inspection items.
// Source: Toyota Electric Pallet Truck Daily Check List #041578 (SAIT paper form, Sprint 0).
// Regulatory basis: Alberta OHS Part 19 s.257 (Powered Mobile Equipment).
// Verify clause text at search-ohs-laws.alberta.ca before citing in operator-facing materials.
const ELECTRIC_PALLET_JACK_ITEMS: ChecklistItemRecord[] = [
  // --- Visual Inspection ---
  {
    key: 'battery_inspection',
    prompt: 'Battery water level, vent caps, and cables are in good condition.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'battery_connector',
    prompt: 'Battery connector is secure and undamaged.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'key_switch',
    prompt: 'Key switch is present and operational.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'capacity_data_plate',
    prompt: 'Capacity data plate is present and legible.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'control_handle',
    prompt: 'Control handle is undamaged and moves freely through its range.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'safety_reversing_switch_visual',
    prompt: 'Safety reversing switch is present and undamaged (visual check only).',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'power_head',
    prompt: 'Power head is free of visible damage or fluid leaks.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'drive_wheel',
    prompt: 'Drive wheel is free of damage, flat spots, or embedded debris.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'stabilizers',
    prompt: 'Stabilizers are present and undamaged.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'forks',
    prompt: 'Left and right forks are free of cracks, bends, or visible damage.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'load_wheels',
    prompt: 'Left and right load wheels are in good condition and spin freely.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'WARNING',
  },
  // --- Operational Inspection ---
  {
    key: 'horn',
    prompt: 'Horn sounds when activated.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'gauges',
    prompt: 'All gauges are operational.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'lights',
    prompt: 'Lights are functional (if equipped).',
    type: 'BOOLEAN',
    required: false,
    failSeverity: 'WARNING',
  },
  {
    key: 'lift_lowering_control',
    prompt: 'Lift/lowering control responds correctly and forks move smoothly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'forward_drive_braking',
    prompt: 'Forward drive engages and brakes stop the unit correctly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'reverse_drive_braking',
    prompt: 'Reverse drive engages and brakes stop the unit correctly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'safety_reversing_switch_op',
    prompt: 'Safety reversing switch stops travel immediately when activated.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'oil_spots',
    prompt: 'No oil or fluid spots on the floor beneath the unit after operation.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'unusual_noise',
    prompt: 'No unusual noises detected during operation.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'operator_notes',
    prompt: 'Additional observations (optional).',
    type: 'TEXT',
    required: false,
    failSeverity: 'WARNING',
  },
];

// Forklift pre-use inspection items.
// Source: SAIT Powered Mobile Equipment SOG Appendix A — Forklift Pre-Operation Inspection
// Checklist (paper form, Sprint 0). All SAIT forklifts are Toyota electric; IC engine and
// LPG items from the generic paper form are excluded.
// Regulatory basis: Alberta OHS Part 19 s.257 (Powered Mobile Equipment).
// Verify clause text at search-ohs-laws.alberta.ca before citing in operator-facing materials.
const FORKLIFT_ITEMS: ChecklistItemRecord[] = [
  // --- Part A: Key Off (visual) ---
  {
    key: 'capacity_data_plate',
    prompt: 'Capacity data plate is in place and legible.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'overhead_guard',
    prompt: 'Overhead guard is free of broken welds, missing bolts, or damaged areas.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'rollover_protection',
    prompt: 'Rollover protection surfaces (if equipped) are free of broken welds, missing bolts, or damaged areas.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: false,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'hydraulic_cylinders',
    prompt: 'Lift, tilt, and attachment cylinders are free of leakage or visible damage.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'seat_seatbelt',
    prompt: 'Seat is secure and seatbelt buckles and latches correctly.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'hydraulic_fluid_level',
    prompt: 'Hydraulic fluid level is adequate and no leaks are visible (if accessible).',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'mast_assembly',
    prompt: 'Mast is free of broken welds, cracked or bent areas, and worn or missing stops.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'lift_chain_rollers',
    prompt: 'Lift chains and rollers are free of wear, damage, rust, or signs that lubricant is required; no unusual noises when moved.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'forks_lock_pins',
    prompt: 'Forks are free of cracks, bends, wear, or mismatching; no excessive oil or water on blades; locking pins engage fully.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'fork_retention',
    prompt: 'Fork stops or load backrest extension are present and prevent forks from sliding off the fork carrier.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'tires_wheels',
    prompt: 'Tires and wheels are in good condition; wheel nuts are secure.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'battery_inspection',
    prompt: 'Battery cell caps, connector, and terminal covers are in place; cable insulation is intact; battery is secure.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'fluid_leaks',
    prompt: 'No fluid leaks visible on the floor beneath the forklift.',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'cab_windows',
    prompt: 'Windshield and cab windows are clean and free of damage affecting visibility.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'general_condition',
    prompt: 'No other visible signs of wear and tear requiring immediate attention.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  // --- Part B: Key On (operational) ---
  {
    key: 'gauges',
    prompt: 'All gauges are operational and readings are within normal range.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'steering',
    prompt: 'Steering operates without unusual noise or excessive free-play.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'brakes',
    prompt: 'Brakes are responsive; forklift stops in forward and reverse within normal distance.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'parking_brake',
    prompt: 'Parking brake holds the forklift stationary when applied.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'safety_warning_devices',
    prompt: 'Horn, backup alarm, flashers, and other installed safety/warning devices are in place and working.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'lights',
    prompt: 'Operating and warning lights are functional (if equipped).',
    type: 'BOOLEAN',
    required: false,
    failSeverity: 'WARNING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'mast_operation',
    prompt: 'Lift and tilt circuits operate smoothly through full range.',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'operator_restraint',
    prompt: 'Operator restraint (if equipped) is working correctly.',
    type: 'BOOLEAN',
    required: false,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'load_attachments',
    prompt: 'Load handling attachments are free of leaks and properly secured (if equipped).',
    type: 'BOOLEAN',
    required: false,
    failSeverity: 'WARNING',
  },
  {
    key: 'operator_notes',
    prompt: 'Additional observations (optional).',
    type: 'TEXT',
    required: false,
    failSeverity: 'WARNING',
  },
];

// DB_HOST_LOCAL: use localhost (Docker Desktop) or <project>-postgres-1.orb.local (OrbStack).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl =
  process.env['DATABASE_URL'] ??
  process.env['CORE_API_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('DATABASE_URL or CORE_API_DB_URL must be set\n');
  process.exit(1);
}

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);

const seed = async () => {
  process.stdout.write('Seeding seed user...\n');

  await db.insert(users).values(SEED_USER).onConflictDoNothing({ target: users.id });

  process.stdout.write('Seeding equipment records...\n');

  await db
    .insert(equipment)
    .values(EQUIPMENT_RECORDS.map((r) => ({ ...r })))
    .onConflictDoNothing({ target: equipment.assetTag });

  process.stdout.write(`Inserted ${EQUIPMENT_RECORDS.length} equipment records.\n`);

  process.stdout.write('Seeding checklist templates...\n');

  const templates = [
    { equipmentType: 'OVERHEAD_CRANE' as const, items: OVERHEAD_CRANE_ITEMS },
    { equipmentType: 'TRUCK' as const, items: TRUCK_ITEMS },
    { equipmentType: 'ELECTRIC_PALLET_JACK' as const, items: ELECTRIC_PALLET_JACK_ITEMS },
    { equipmentType: 'FORKLIFT' as const, items: FORKLIFT_ITEMS },
  ];

  for (const { equipmentType, items } of templates) {
    await db
      .insert(checklistTemplates)
      .values({
        equipmentType,
        version: 1,
        isActive: true,
        items,
        createdBy: SEED_USER_ID,
      })
      // The partial unique index allows only one active row per type, but the
      // (equipment_type, version) unique index makes this the correct conflict target for
      // idempotent re-seeding. isActive is not updated on conflict; use the publish route
      // to change the active template in a running environment.
      .onConflictDoNothing();
  }

  process.stdout.write(`Inserted ${templates.length} checklist templates.\n`);
};

try {
  await seed();
} catch (err) {
  process.stderr.write(`Seed failed: ${String(err)}\n`);
  process.exitCode = 1;
} finally {
  // Always close the pool so the process can exit cleanly, even on failure.
  await pool.end();
}
