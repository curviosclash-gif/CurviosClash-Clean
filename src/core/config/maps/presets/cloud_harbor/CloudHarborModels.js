// Cloud Harbor: the fourteen GLB parts, all modelled in one shared map frame at scale 1 (see
// scripts/cloud_harbor_layout.py, the single source of truth the Blender generators also read).
// The loader recentres every file on its own bounding box -- X/Z centre, Y bottom -- onto the
// position given here, so no `targetSize` and no per-part scale factor are needed.
//
// Positions are the centre/base each generator reported for its own part's bounding box.

const PACK = 'cloud_harbor';
const BEAT_SECONDS = 4;

/**
 * A static architecture part. Position is [centre_x, base_y, centre_z] of the part's own bounding
 * box in the shared map frame -- what the generator's `report()` prints once the part is built.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/cloud_harbor/glb
 * @param {number[]} centre [x, y, z] bounding-box centre/base in authored map units
 */
function part(id, file, centre) {
    const [x, y, z] = centre;
    return {
        id: `cloud-harbor-${id}`,
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
 * @param {string} file basename under assets/maps/cloud_harbor/glb
 * @param {string} clipName the one animation clip the generator exports for this part
 * @param {number[]} centre [x, y, z] bounding-box centre/base in authored map units
 */
function setpiece(id, file, clipName, centre) {
    return {
        ...part(id, file, centre),
        animationClock: { clipName, phaseOffsetBeats: 0 },
    };
}

// --- Static architecture (parts 01-09) -----------------------------------------------------------
const ARCHITECTURE = [
    part('cloud-sea', '01_cloud_sea', [0, 0, 0]),
    part('mooring-dock', '02_mooring_dock', [-144.93565, 24, 100.67133]),
    part('cargo-zeppelin', '03_cargo_zeppelin', [-65, 42.3, 100]),
    part('wind-isle', '04_wind_isle', [33.10928, 4, 79.35596]),
    part('market-isle', '05_market_isle', [116.33713, 6, 22.08277]),
    part('weather-tower', '06_weather_tower', [120.33713, 10, -65.92182]),
    part('cableway', '07_cableway', [27, 75.00098, -116]),
    part('harbor-island', '08_harbor_island', [-123.94496, 22, -94.66857]),
    part('backdrop', '09_backdrop', [1.5, 109.5, -0.5]),
];

// --- Animated setpieces (parts 10-14) ------------------------------------------------------------
// Clip names and loop lengths come straight from scripts/generate_cloud_harbor_assets.py's
// SETPIECES tuple, so a mismatch there fails the contract test rather than drifting silently.
const SETPIECES = [
    setpiece('cargo-nets', '10_cargo_nets', 'CargoNetSwingLoop', [-65, 61.4, 100]),
    setpiece('windmill-rotors', '11_windmill_rotors', 'WindmillRotorLoop', [40.77887, 26.84225, 86.97887]),
    setpiece('gyro-rings', '12_gyro_rings', 'GyroRingLoop', [120, 103.95452, -66]),
    setpiece('cable-cars', '13_cable_cars', 'CableCarLoop', [27, 90.27972, -116]),
    setpiece('patrol-zeppelin', '14_patrol_zeppelin', 'PatrolZeppelinLoop', [-60, 57.2, -40]),
];

export const CLOUD_HARBOR_MODELS = [...ARCHITECTURE, ...SETPIECES];
export const CLOUD_HARBOR_BEAT_SECONDS = BEAT_SECONDS;
