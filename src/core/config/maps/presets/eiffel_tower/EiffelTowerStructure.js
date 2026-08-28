// Collision, boosts and pickups for the Eiffel Tower map.
//
// The running map takes its collision straight off the GLB triangles (glbColliderMode 'scene'),
// and on this map that is not a convenience but the only honest option: the level *is* the gaps
// between the members. No set of authored boxes can describe a lattice -- a box big enough to
// stand for a leg seals the way through it, and a box small enough to leave the way open stands
// for nothing. So the definitions below are the load-failure fallback: a coarse tower that keeps
// a match playable if a GLB never arrives, plus the handful of surfaces marked compileWithGlb
// that stay active either way.
//
// Coordinates are authored units with the esplanade at y = 8; one real metre is 0.6 authored
// units, matching the generator. Every height comment states the real metre it stands for.

const GROUND = 8;
const METRE = 0.6;

/** Authored height for a real height above the esplanade. */
function up(metres) {
    return GROUND + metres * METRE;
}

/** Authored length for a real length. */
function across(metres) {
    return metres * METRE;
}

// Half the square the four leg centres stand on, at the four heights collision cares about.
// These are the same numbers the generator tapers through.
const BASE_SPREAD = across(62.5);        // 37.5, the 125 m base square
const FIRST_SPREAD = across(32.5);       // 19.5
const SECOND_SPREAD = across(15.0);      // 9.0
const TOP_SPREAD = across(5.6);          // 3.36

const FIRST_DECK = up(57.63);            // 42.58
const SECOND_DECK = up(115.73);          // 77.44
const TOP_DECK = up(276.1);              // 173.66
const CUPOLA_TOP = up(300.0);            // 188.0
const TIP = up(330.0);                   // 206.0

const FIRST_OUTER = across(36.5);        // 21.9, outer edge of the first gallery
const FIRST_INNER = across(24.0);        // 14.4, the open middle of it
const SECOND_OUTER = across(18.0);       // 10.8
const SECOND_INNER = across(10.5);       // 6.3

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * One leg as a pair of tapered beams. Two segments rather than one because the leg bends: a
 * single beam from the pier to the platform runs outside the drawn iron over its whole middle.
 *
 * @param {number} signX which side of the tower the leg stands on
 * @param {number} signZ
 */
function leg(signX, signZ) {
    const foot = [signX * BASE_SPREAD, GROUND, signZ * BASE_SPREAD];
    const knee = [signX * across(45.0), up(25.0), signZ * across(45.0)];
    const shoulder = [signX * FIRST_SPREAD, FIRST_DECK, signZ * FIRST_SPREAD];
    const waist = [signX * across(22.4), up(85.0), signZ * across(22.4)];
    const neck = [signX * SECOND_SPREAD, SECOND_DECK, signZ * SECOND_SPREAD];
    return [
        // The pier the leg is bolted to.
        { pos: [signX * BASE_SPREAD, GROUND + 0.9, signZ * BASE_SPREAD], size: [20.4, 1.8, 20.4] },
        { shape: 'beam', kind: 'hard', start: foot, end: knee, radius: across(11.0) },
        { shape: 'beam', kind: 'hard', start: knee, end: shoulder, radius: across(8.0) },
        { shape: 'beam', kind: 'hard', start: shoulder, end: waist, radius: across(5.5) },
        { shape: 'beam', kind: 'hard', start: waist, end: neck, radius: across(3.6) },
    ];
}

/**
 * A gallery deck as four slabs around an open middle. The middle stays open because on the real
 * tower it is, and because it is the way up through the building.
 *
 * @param {number} height authored height of the deck surface
 * @param {number} outer outer half width
 * @param {number} inner half width of the opening
 * @param {number} thickness
 */
function deck(height, outer, inner, thickness) {
    const band = outer - inner;
    const centre = (outer + inner) / 2;
    return [-1, 1].flatMap((sign) => [
        { pos: [0, height, sign * centre], size: [outer * 2, thickness, band] },
        { pos: [sign * centre, height, 0], size: [band, thickness, inner * 2] },
    ]);
}

const EIFFEL_TOWER_OBSTACLES = [
    // --- The Champ-de-Mars ---------------------------------------------------------------------
    // The one surface that stays active with the GLBs loaded: a ship that clips the ground should
    // scrape rather than fall through the world while the esplanade mesh is still streaming in.
    { pos: [0, 4, 0], size: [200, 8, 200], kind: 'foam', compileWithGlb: true },

    // --- The four legs, ground to the second platform -------------------------------------------
    ...CORNERS.flatMap(([signX, signZ]) => leg(signX, signZ)),

    // --- The decorative arches under the first platform ------------------------------------------
    // Only their haunches are described. The crown of each arch is where the route flies, so a
    // fallback that closed it would replace the entrance with a wall.
    ...[-1, 1].flatMap((sign) => [
        { pos: [sign * across(36.0), up(30.0), 0], size: [across(14), across(20), across(52)] },
        { pos: [0, up(30.0), sign * across(36.0)], size: [across(52), across(20), across(14)] },
    ]),

    // --- First gallery at 57.63 m ---------------------------------------------------------------
    ...deck(FIRST_DECK, FIRST_OUTER, FIRST_INNER, 1.4),
    // The four pavilions on it.
    ...[-1, 1].flatMap((sign) => [
        { pos: [0, FIRST_DECK + 2.4, sign * ((FIRST_OUTER + FIRST_INNER) / 2)], size: [9.6, 3.0, 5.4] },
        { pos: [sign * ((FIRST_OUTER + FIRST_INNER) / 2), FIRST_DECK + 2.4, 0], size: [5.4, 3.0, 9.6] },
    ]),

    // --- Second gallery at 115.73 m --------------------------------------------------------------
    ...deck(SECOND_DECK, SECOND_OUTER, SECOND_INNER, 1.2),
    ...[-1, 1].map((sign) => (
        { pos: [0, SECOND_DECK + 2.0, sign * ((SECOND_OUTER + SECOND_INNER) / 2)], size: [10.8, 2.5, 3.8] }
    )),

    // --- The upper shaft, 115.73 m to 276.1 m -----------------------------------------------------
    // Four corner beams rather than one column: the middle of the shaft is the map's shortcut,
    // and a solid fallback would take it away.
    ...CORNERS.map(([signX, signZ]) => ({
        shape: 'beam',
        kind: 'hard',
        start: [signX * SECOND_SPREAD, SECOND_DECK, signZ * SECOND_SPREAD],
        end: [signX * TOP_SPREAD, TOP_DECK, signZ * TOP_SPREAD],
        radius: across(2.2),
    })),

    // --- Summit, cupola, mast and antenna ---------------------------------------------------------
    { pos: [0, TOP_DECK, 0], size: [11.4, 1.2, 11.4] },
    { pos: [0, TOP_DECK + 3.3, 0], size: [10.1, 5.4, 10.1] },
    { pos: [0, TOP_DECK + 9.0, 0], size: [8.9, 5.4, 8.9] },
    { shape: 'beam', kind: 'hard', start: [0, TOP_DECK + 11.5, 0], end: [0, CUPOLA_TOP, 0], radius: 1.6 },
    { shape: 'beam', kind: 'hard', start: [0, CUPOLA_TOP, 0], end: [0, TIP, 0], radius: 0.6 },

    // --- Landing platforms for the route ------------------------------------------------------
    // Each one stands inside something a player can see, so it renders with the GLBs instead of
    // being a slab of invisible air: the approach pad on the esplanade, and the two gallery decks
    // a run can put down on.
    { pos: [-72, up(18.0), 0], size: [22, 3, 26], renderWithGlb: true, compileWithGlb: true },
    { pos: [0, FIRST_DECK + 0.4, FIRST_OUTER - 2], size: [18, 2, 6], renderWithGlb: true, compileWithGlb: true },
    { pos: [0, SECOND_DECK + 0.4, SECOND_OUTER - 1.6], size: [12, 2, 5], renderWithGlb: true, compileWithGlb: true },
];

// Portals shortcut the long way round: back down from the summit to the esplanade, and up the
// outside of the tower for a run that lost its climb.
const EIFFEL_TOWER_PORTALS = [
    { a: [-72, up(18.0), 0], b: [0, up(34.0), 0], color: 0x77aaff },
    { a: [FIRST_OUTER + 4, FIRST_DECK + 6, 0], b: [0, SECOND_DECK + 10, 0], color: 0xffaa33 },
    { a: [0, TOP_DECK + 14, 0], b: [-72, up(20.0), 0], color: 0xaa66ff },
];

// A climb needs lift, so most of these are slingshots rather than flat boosts.
const EIFFEL_TOWER_GATES = [
    { id: 'et_approach_boost', type: 'boost', pos: [-58, up(20.0), 0], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 } },
    { id: 'et_pier_sling', type: 'slingshot', pos: [-24, up(20.0), 0], forward: [0.7, 0.7, 0], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 30, liftImpulse: 20, cooldown: 1.2 } },
    { id: 'et_core_sling', type: 'slingshot', pos: [0, up(48.0), 0], forward: [0.1, 0.99, 0], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 22, liftImpulse: 24, cooldown: 1.1 } },
    { id: 'et_leg_sling', type: 'slingshot', pos: [26, up(40.0), 26], forward: [0.25, 0.94, 0.25], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 24, liftImpulse: 22, cooldown: 1.1 } },
    { id: 'et_first_deck_boost', type: 'boost', pos: [0, FIRST_DECK + 8, 0], forward: [0, 1, 0], params: { duration: 1.1, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.8 } },
    { id: 'et_shaft_sling', type: 'slingshot', pos: [0, up(96.0), 0], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 20, liftImpulse: 26, cooldown: 1.2 } },
    { id: 'et_gallery_boost', type: 'boost', pos: [SECOND_OUTER + 3, SECOND_DECK - 2, -SECOND_OUTER - 3], forward: [-0.3, 0.9, 0.3], params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'et_spiral_sling', type: 'slingshot', pos: [12, up(190.0), 0], forward: [0, 0.94, -0.34], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 26, liftImpulse: 20, cooldown: 1.1 } },
    { id: 'et_summit_sling', type: 'slingshot', pos: [0, TOP_DECK - 8, 8], forward: [0, 0.96, -0.28], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 24, liftImpulse: 24, cooldown: 1.2 } },
    { id: 'et_mast_boost', type: 'boost', pos: [0, TOP_DECK + 16, 0], forward: [0, 1, 0], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
];

const EIFFEL_TOWER_ITEMS = [
    { id: 'et_speed_approach', type: 'item_battery', pickupType: 'SPEED_UP', x: -50, y: up(20.0), z: 0, weight: 1.3 },
    { id: 'et_shield_pier', type: 'item_shield', pickupType: 'SHIELD', x: -30, y: up(16.0), z: 0, weight: 1.1 },
    { id: 'et_ghost_iris', type: 'item_coin', pickupType: 'GHOST', x: 0, y: up(24.0), z: 0, weight: 0.7 },
    { id: 'et_speed_core', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: up(46.0), z: 0, weight: 1.2 },
    { id: 'et_rare_leg', type: 'item_crystal', pickupType: 'SHIELD', x: 26, y: up(50.0), z: 26, weight: 0.5 },
    { id: 'et_rocket_first', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: FIRST_DECK + 6, z: 0, weight: 0.9 },
    { id: 'et_thick_shaft', type: 'item_coin', pickupType: 'THICK', x: 0, y: up(96.0), z: 0, weight: 0.8 },
    { id: 'et_shield_gallery', type: 'item_shield', pickupType: 'SHIELD', x: 12.5, y: SECOND_DECK - 2, z: -12.5, weight: 1.0 },
    { id: 'et_speed_spiral', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: up(205.0), z: -11, weight: 1.1 },
    { id: 'et_rocket_spiral', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: -10, y: up(220.0), z: 0, weight: 0.7 },
    { id: 'et_ghost_summit', type: 'item_coin', pickupType: 'GHOST', x: 0, y: TOP_DECK + 4, z: 8, weight: 0.7 },
    { id: 'et_shield_mast', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: TOP_DECK + 20, z: 0, weight: 1.0 },
];

// The arena variant fights around the two galleries instead of climbing, so its boosts ring the
// decks rather than pointing up.
const EIFFEL_TOWER_ARENA_GATES = [
    { id: 'et_arena_first_north', type: 'boost', pos: [0, FIRST_DECK + 5, FIRST_OUTER + 4], forward: [1, 0, -0.2], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'et_arena_first_south', type: 'boost', pos: [0, FIRST_DECK + 5, -FIRST_OUTER - 4], forward: [-1, 0, 0.2], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'et_arena_first_east', type: 'boost', pos: [FIRST_OUTER + 4, FIRST_DECK + 5, 0], forward: [-0.2, 0, -1], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'et_arena_first_west', type: 'boost', pos: [-FIRST_OUTER - 4, FIRST_DECK + 5, 0], forward: [0.2, 0, 1], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'et_arena_core_sling', type: 'slingshot', pos: [0, up(30.0), 0], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 18, liftImpulse: 28, cooldown: 1.2 } },
    { id: 'et_arena_second_sling', type: 'slingshot', pos: [0, SECOND_DECK + 6, 0], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 20, liftImpulse: 24, cooldown: 1.1 } },
];

const EIFFEL_TOWER_ARENA_ITEMS = [
    { id: 'et_arena_shield_north', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: FIRST_DECK + 5, z: FIRST_OUTER, weight: 1.0 },
    { id: 'et_arena_shield_south', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: FIRST_DECK + 5, z: -FIRST_OUTER, weight: 1.0 },
    { id: 'et_arena_speed_east', type: 'item_battery', pickupType: 'SPEED_UP', x: FIRST_OUTER, y: FIRST_DECK + 5, z: 0, weight: 1.1 },
    { id: 'et_arena_speed_west', type: 'item_battery', pickupType: 'SPEED_UP', x: -FIRST_OUTER, y: FIRST_DECK + 5, z: 0, weight: 1.1 },
    { id: 'et_arena_rocket_core', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: up(34.0), z: 0, weight: 0.9 },
    { id: 'et_arena_ghost_second', type: 'item_coin', pickupType: 'GHOST', x: 0, y: SECOND_DECK + 5, z: 0, weight: 0.8 },
    { id: 'et_arena_heavy_summit', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: TOP_DECK + 6, z: 0, weight: 0.6 },
];

const EIFFEL_TOWER_AIRCRAFT = [
    { id: 'et_seine_patrol', jetId: 'ship8', x: -80, y: up(60.0), z: 70, scale: 1.1, rotateY: 0.4 },
    { id: 'et_trocadero_scout', jetId: 'ship4', x: 70, y: up(110.0), z: -70, scale: 0.9, rotateY: -1.2 },
    { id: 'et_mast_watch', jetId: 'ship6', x: -30, y: up(250.0), z: 34, scale: 0.85, rotateY: 2.4 },
    { id: 'et_garden_drift', jetId: 'ship3', x: 60, y: up(30.0), z: 60, scale: 0.75, rotateY: -0.6 },
];

export {
    GROUND,
    METRE,
    up,
    across,
    BASE_SPREAD,
    FIRST_SPREAD,
    SECOND_SPREAD,
    TOP_SPREAD,
    FIRST_DECK,
    SECOND_DECK,
    TOP_DECK,
    CUPOLA_TOP,
    TIP,
    FIRST_OUTER,
    FIRST_INNER,
    SECOND_OUTER,
    SECOND_INNER,
    EIFFEL_TOWER_OBSTACLES,
    EIFFEL_TOWER_PORTALS,
    EIFFEL_TOWER_GATES,
    EIFFEL_TOWER_ITEMS,
    EIFFEL_TOWER_ARENA_GATES,
    EIFFEL_TOWER_ARENA_ITEMS,
    EIFFEL_TOWER_AIRCRAFT,
};
