// Authored station-side positions in map units; only the named Journey mission borrows them.
export const ORBITAL_JOURNEY_SCENARIO_ID = 'orbital_journey_defense';
export const ORBITAL_JOURNEY_TURRETS = Object.freeze([
    { id: 'orbital_mg_scaffold', weapon: 'mg', pos: [-78, 40, 112], range: 80, cooldown: 0.85, damage: 4, phase: 1.2 },
    { id: 'orbital_rocket_hull', weapon: 'rocket', pos: [8, 52, 88], range: 92, cooldown: 3.4, rocketType: 'ROCKET_MEDIUM', phase: 2 },
    { id: 'orbital_mg_tower', weapon: 'mg', pos: [164, 80, -36], range: 85, cooldown: 0.9, damage: 4, phase: 0.8 },
    { id: 'orbital_rocket_canyon', weapon: 'rocket', pos: [140, 44, 132], range: 90, cooldown: 3.6, rocketType: 'ROCKET_MEDIUM', phase: 1.8 },
].map(entry => Object.freeze({ ...entry, pos: Object.freeze(entry.pos), allowedModes: Object.freeze(['ARCADE']),
    targetPlayers: 'humans', destructible: true, maxHp: 90, respawnSeconds: 0 })));
