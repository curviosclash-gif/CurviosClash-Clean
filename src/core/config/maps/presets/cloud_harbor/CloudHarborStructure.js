// Fallback collision, pickups and background traffic for the Cloud Harbor.
//
// The map runs in glbColliderMode 'scene' (see index.js): once the GLBs load, collision comes
// straight off their triangles. The boxes below are the load-failure fallback only -- the cloud
// sea and the island decks -- kept well clear of every ring and corridor. Anything a run flies
// through (the zeppelin's cargo bay, the windmill rotors, the harbor gate) is left to the GLB.
//
// Coordinates are authored map units, transcribed from scripts/cloud_harbor_layout.py's section
// dicts (CLOUD_SEA, MOORING_DOCK, WIND_ISLE, MARKET_ISLE, WEATHER_TOWER, HARBOR_ISLAND).

const CloudHarborObstacles = [
    // --- The cloud sea: a soft safety net far below the whole course -----------------------------
    { pos: [0, 0, 0], size: [350, 8, 290], kind: 'foam' },
    // --- Island decks, each below its lowest corridor -------------------------------------------
    { pos: [-150, 53, 100], size: [56, 6, 36] },
    { pos: [33, 11, 79], size: [78, 6, 78] },
    { pos: [116, 33, 22], size: [68, 6, 72] },
    { pos: [120, 37, -66], size: [60, 6, 60] },
    { pos: [-125, 71, -120], size: [70, 6, 50] },
];

// One pickup per major beat of the course, in the Orbital Shipyard's style.
const CloudHarborItems = [
    { id: 'ch_speed_dock', type: 'item_battery', pickupType: 'SPEED_UP', x: -145.0, y: 68.0, z: 100.0, weight: 1.3 },
    { id: 'ch_shield_bay', type: 'item_shield', pickupType: 'SHIELD', x: -86.0, y: 68.0, z: 100.0, weight: 1.1 },
    { id: 'ch_rocket_mills', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 30.0, y: 77.0, z: 76.0, weight: 0.9 },
    { id: 'ch_speed_bazaar', type: 'item_battery', pickupType: 'SPEED_UP', x: 91.0, y: 67.0, z: 22.0, weight: 1.2 },
    { id: 'ch_rare_roof', type: 'item_crystal', pickupType: 'SHIELD', x: 91.0, y: 91.0, z: 22.0, weight: 0.5 },
    { id: 'ch_ghost_tower', type: 'item_coin', pickupType: 'GHOST', x: 136.0, y: 102.0, z: -81.0, weight: 0.7 },
    { id: 'ch_rocket_summit', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 103.0, y: 146.0, z: -66.0, weight: 0.7 },
    { id: 'ch_speed_cable', type: 'item_battery', pickupType: 'SPEED_UP', x: 45.0, y: 104.0, z: -114.0, weight: 1.1 },
    { id: 'ch_shield_chains', type: 'item_shield', pickupType: 'SHIELD', x: -35.0, y: 81.0, z: -115.0, weight: 1.0 },
];

// Background traffic drifting between the islands (jetId, position, scale, yaw) -- decoration,
// not obstacles.
const CloudHarborAircraft = [
    { id: 'ch_dock_tender', jetId: 'ship3', x: -150.0, y: 95.0, z: 55.0, scale: 0.8, rotateY: 0.9 },
    { id: 'ch_mill_courier', jetId: 'ship8', x: 20.0, y: 110.0, z: 30.0, scale: 0.9, rotateY: -0.7 },
    { id: 'ch_tower_patrol', jetId: 'ship6', x: 165.0, y: 130.0, z: -110.0, scale: 0.85, rotateY: 2.2 },
    { id: 'ch_harbor_scout', jetId: 'ship4', x: -150.0, y: 110.0, z: -40.0, scale: 0.75, rotateY: -1.2 },
];

export { CloudHarborObstacles, CloudHarborItems, CloudHarborAircraft };
