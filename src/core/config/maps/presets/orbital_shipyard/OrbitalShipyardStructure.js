// Fallback collision, pickups and background traffic for the Orbital Shipyard.
//
// The map runs in glbColliderMode 'scene' (see index.js): once the thirteen GLBs load, collision
// comes straight off their triangles, exactly like the Eiffel Tower and Notre-Dame. The boxes below
// are the load-failure fallback only -- a coarse station that keeps a match playable if a GLB never
// arrives -- so they are deliberately sparse and kept well clear of every ring and corridor rather
// than tracing the rib cage or drydock tower in detail. Anything that would need to look like a
// hoop a player flies through (the hull ribs, the airlock doors, the rotor) is left to the GLB: a
// solid authored box standing in for it would seal the opening the route flies through.
//
// Coordinates are authored map units, transcribed from scripts/orbital_shipyard_layout.py's section
// dicts (STATION_DECK, LAUNCH_BAY, AIRLOCK, CANYON).

const STATION_DECK_Y = 3.0;

const OrbitalShipyardObstacles = [
    // --- The station deck: a safety net far below the whole course ------------------------------
    { pos: [0, 0, 0], size: [350, 6, 290], kind: 'foam' },

    // --- Launch bay walls: the bay is a straight tunnel, so its side walls sit outside the ---------
    // 12-unit inner half width CP01 and the spawn already fly down the middle of.
    { pos: [-176, 40, 110], size: [4, 22, 26] },
    { pos: [-145, 40, 124], size: [64, 22, 4] },
    { pos: [-145, 40, 96], size: [64, 22, 4] },

    // --- Airlock hall side walls, outside the door slots at x 78/96/114 and well past the --------
    // CP09_LOCK / CP09_DUCT rings on either side of the hall's z span.
    { pos: [95, 43.5, -129], size: [76, 37, 4] },
    { pos: [95, 43.5, -91], size: [76, 37, 4] },

    // --- Fuel canyon side walls, outside the CP16-CP18 corridor which runs along z = 115 ---------
    { pos: [112.5, 35, 100], size: [78, 50, 4] },
    { pos: [112.5, 35, 130], size: [78, 50, 4] },
];

// A handful of pickups along the route, in the style of the Eiffel Tower's list: one per major
// beat of the climb rather than one per checkpoint.
const OrbitalShipyardItems = [
    { id: 'os_speed_launch', type: 'item_battery', pickupType: 'SPEED_UP', x: -145.0, y: 40.0, z: 110.0, weight: 1.3 },
    { id: 'os_shield_scaffold', type: 'item_shield', pickupType: 'SHIELD', x: -80.0, y: 44.0, z: 85.0, weight: 1.1 },
    { id: 'os_rocket_crane', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -35.0, y: 45.0, z: 50.0, weight: 0.9 },
    { id: 'os_ghost_bow', type: 'item_coin', pickupType: 'GHOST', x: 20.0, y: 45.0, z: 78.0, weight: 0.7 },
    { id: 'os_speed_ribs', type: 'item_battery', pickupType: 'SPEED_UP', x: 30.0, y: 34.0, z: -10.0, weight: 1.2 },
    { id: 'os_shield_lock', type: 'item_shield', pickupType: 'SHIELD', x: 87.0, y: 45.0, z: -110.0, weight: 1.0 },
    { id: 'os_rare_duct', type: 'item_crystal', pickupType: 'SHIELD', x: 90.0, y: 80.0, z: -110.0, weight: 0.5 },
    { id: 'os_speed_tower', type: 'item_battery', pickupType: 'SPEED_UP', x: 125.0, y: 82.0, z: 20.0, weight: 1.1 },
    { id: 'os_rocket_rotor', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 92.0, y: 112.0, z: -15.0, weight: 0.7 },
    { id: 'os_ghost_summit', type: 'item_coin', pickupType: 'GHOST', x: 125.0, y: 142.0, z: -15.0, weight: 0.7 },
    { id: 'os_shield_canyon', type: 'item_shield', pickupType: 'SHIELD', x: 158.0, y: 35.0, z: 115.0, weight: 1.0 },
];

// Background traffic drifting around the drydock, in the Eiffel Tower's style (jetId, position,
// scale, yaw) -- decoration, not obstacles.
const OrbitalShipyardAircraft = [
    { id: 'os_yard_tug', jetId: 'ship3', x: -70.0, y: 55.0, z: 60.0, scale: 0.8, rotateY: 1.1 },
    { id: 'os_hull_welder_escort', jetId: 'ship8', x: 55.0, y: 50.0, z: -5.0, scale: 0.9, rotateY: -0.6 },
    { id: 'os_tower_patrol', jetId: 'ship6', x: 150.0, y: 105.0, z: 35.0, scale: 0.85, rotateY: 2.0 },
    { id: 'os_canyon_scout', jetId: 'ship4', x: 130.0, y: 45.0, z: 130.0, scale: 0.75, rotateY: -1.4 },
];

export {
    STATION_DECK_Y,
    OrbitalShipyardObstacles,
    OrbitalShipyardItems,
    OrbitalShipyardAircraft,
};
