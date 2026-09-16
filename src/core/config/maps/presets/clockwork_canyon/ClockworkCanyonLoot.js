// ============================================
// Clockwork Canyon - Wüsten-Canyon mit Zahnrädern
// Spawns, Items, Flugzeuge, Missionen und Ausgangsportal
// ============================================

// Start des Spielers am westlichen Canyon-Rand
export const CLOCKWORK_CANYON_PLAYER_SPAWN = { x: -62, y: 10, z: 0 };

// Bot-Spawns: vier am Boden verteilt um das Zentrum, zwei erhöht am Uhrturm
export const CLOCKWORK_CANYON_BOT_SPAWNS = [
    { x: 62, y: 10, z: 0 },
    { x: 0, y: 10, z: -62 },
    { x: 0, y: 10, z: 62 },
    { x: -50, y: 40, z: -50 },
    { x: 50, y: 40, z: 50 },
    { x: 0, y: 58, z: 0 },
];

// Items: Boden-Ring um das Zentrum, vier Zahnrad-Plattformen, Rarität ganz oben am Uhrturm
export const CLOCKWORK_CANYON_ITEMS = [
    // Boden-Ebene (Canyon-Sohle, Nord/Süd/Ost/West um den Turm)
    { id: 'cc_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -25, y: 6, z: 0, weight: 1.5 },
    { id: 'cc_shield_east', type: 'item_shield', pickupType: 'SHIELD', x: 25, y: 6, z: 0, weight: 1.2 },
    { id: 'cc_speed_north', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 6, z: -25, weight: 1.3 },
    { id: 'cc_ghost_south', type: 'item_coin', pickupType: 'GHOST', x: 0, y: 6, z: 25, weight: 1.4 },
    // Zahnrad-Plattformen (mittlere Ebene, vier Ecken)
    { id: 'cc_thick_ne', type: 'item_coin', pickupType: 'THICK', x: 40, y: 27, z: -40, weight: 1.0 },
    { id: 'cc_shield_sw', type: 'item_shield', pickupType: 'SHIELD', x: -40, y: 27, z: 40, weight: 1.1 },
    { id: 'cc_speed_nw', type: 'item_battery', pickupType: 'SPEED_UP', x: -40, y: 27, z: -40, weight: 1.3 },
    { id: 'cc_rocket_se', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 40, y: 27, z: 40, weight: 1.4 },
    // Turmspitze: seltene schwere Rakete
    { id: 'cc_rocket_tower', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: 54, z: 0, weight: 0.6 },
];

// Flugzeuge über dem Canyon, symmetrisch zum Uhrturm ausgerichtet
export const CLOCKWORK_CANYON_AIRCRAFT = [
    { id: 'cc_air_1', jetId: 'ship2', x: -30, y: 55, z: -30, scale: 1.2, rotateY: 0.5 },
    { id: 'cc_air_2', jetId: 'ship7', x: 30, y: 55, z: 30, scale: 1.1, rotateY: -1.0 },
    { id: 'cc_air_3', jetId: 'aircraft', x: 0, y: 45, z: -40, scale: 1.3, rotateY: 1.57 },
];

// Missionen: etwas härter als die Referenzkarte (Crystal Ruins) austariert
export const CLOCKWORK_CANYON_MISSIONS = [
    { type: 'KILL_COUNT', params: { target: 8 }, weight: 1.5 },
    { type: 'SURVIVE_DURATION', params: { target: 65 }, weight: 1 },
    { type: 'TIME_TRIAL', params: { target: 35 }, weight: 1.5 },
    { type: 'REACH_PORTAL', params: {}, weight: 1 },
];

// Ausgangsportal auf der Uhrturm-Spitze
export const CLOCKWORK_CANYON_EXIT_PORTAL = { pos: [0, 56, 0], color: 0xffcc55, activateOnClear: true };
