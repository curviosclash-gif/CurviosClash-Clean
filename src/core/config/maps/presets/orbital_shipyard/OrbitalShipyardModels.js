// Orbital Shipyard: the thirteen GLB parts, all modelled in one shared map frame at scale 1 (see
// scripts/orbital_shipyard_layout.py, the single source of truth the Blender generators also
// read). The loader recentres every file on its own bounding box -- X/Z centre, Y bottom -- onto
// the position given here, so no `targetSize` and no per-part scale factor are needed: unlike the
// Eiffel Tower (modelled at true metres) this pack is already authored in map units.
//
// Positions are the centre/base each generator reported for its own part's bounding box.

const PACK = 'orbital_shipyard';
const BEAT_SECONDS = 4;

/**
 * A static architecture part. Position is [centre_x, base_y, centre_z] of the part's own bounding
 * box in the shared map frame -- what the generator's `report()` prints once the part is built.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/orbital_shipyard/glb
 * @param {number[]} centre [x, y, z] bounding-box centre/base in authored map units
 */
function part(id, file, centre) {
    const [x, y, z] = centre;
    return {
        id: `orbital-shipyard-${id}`,
        url: `assets/maps/${PACK}/glb/${file}.glb`,
        position: [x, y, z],
        rotation: [0, 0, 0],
        scale: 1,
    };
}

/**
 * An animated setpiece. Same placement rule as `part`, plus the single clip it drives.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/orbital_shipyard/glb
 * @param {string} clipName the one animation clip the generator exports for this part
 * @param {number[]} centre [x, y, z] bounding-box centre/base in authored map units
 */
function setpiece(id, file, clipName, centre) {
    return {
        ...part(id, file, centre),
        animationClock: { clipName, phaseOffsetBeats: 0 },
    };
}

// --- Static architecture (parts 01-08) -----------------------------------------------------------
const ARCHITECTURE = [
    part('station-deck', '01_station_deck', [0.0, 0.0, 0.0]),
    part('launch-bay', '02_launch_bay', [-145.35, 3.0, 110.0]),
    part('scaffold-yard', '03_scaffold_yard', [-63.69, 0.0, 85.0]),
    part('hull-spine', '04_hull_spine', [30.0, 3.0, -19.93]),
    part('airlock-hall', '05_airlock_hall', [95.0, 3.0, -110.0]),
    part('drydock-tower', '06_drydock_tower', [125.0, 3.0, -15.0]),
    part('fuel-canyon', '07_fuel_canyon', [107.5, 7.0, 115.0]),
    part('backdrop', '08_backdrop', [0.0, 3.0, -11.95]),
];

// --- Animated setpieces (parts 10-14) ------------------------------------------------------------
// Clip names and loop lengths come straight from scripts/generate_orbital_shipyard_assets.py's
// SETPIECES tuple, so a mismatch there fails the contract test rather than drifting silently.
const SETPIECES = [
    setpiece('crane-sweep', '10_crane_sweep', 'CraneSweepLoop', [-60.0, 2.8, 105.1]),
    setpiece('weld-gantry', '11_weld_gantry', 'WeldGantryLoop', [30.0, 20.97, 45.0]),
    setpiece('airlock-doors', '12_airlock_doors', 'AirlockCycleLoop', [96.0, 23.8, -110.0]),
    setpiece('tower-rotor', '13_tower_rotor', 'TowerRotorLoop', [135.6, 98.5, -15.0]),
    setpiece('fuel-pistons', '14_fuel_pistons', 'FuelPistonLoop', [115.0, 14.0, 115.0]),
];

export const ORBITAL_SHIPYARD_MODELS = [...ARCHITECTURE, ...SETPIECES];
export const ORBITAL_SHIPYARD_BEAT_SECONDS = BEAT_SECONDS;
