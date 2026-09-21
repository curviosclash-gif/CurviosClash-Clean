// Layout of the giant forest: the field, the clearings the trees leave open, and where a round
// starts, boosts and pickups sit.
//
// One idea decides every number here. The forest is two storeys - the ground between the trunks
// and the canopy on the branches around y = 52 - and the fog says which of the two is playable.
// The clearings are therefore not decoration: they are the places where a player can change
// storey, and they are the only places from which the canopy is reachable in a straight climb.
//
// Everything here is authored units. The arena builds every map at CONFIG.ARENA.MAP_SCALE, and
// obstacles, gates and GLB placements are multiplied by it whether a map asks or not - while
// spawns, pickups and the fog's height terms only follow when the map sets scaleAuthoredAnchors.
// The forest sets it, so one authored unit is one unit here and three in the world, for all of
// them alike. The only numbers that stay world units are the fog's near and far distances.

/** Top of the forest floor. Everything stands on it, nothing is buried in it. */
export const FOREST_GROUND = 8;

/** Half the playing field. A tree crown is ~80 wide, so the rim keeps one crown of margin. */
export const FOREST_HALF_SIZE = 320;

/**
 * Where the canopy storey is. The trees' main branches leave their trunks around y = 38 and climb
 * from there, so a deck at 52 sits inside the crowns rather than above them - you land among
 * branches, not on a roof.
 */
export const CANOPY_DECK = 52;

export const FOREST_MAP_SIZE = Object.freeze([FOREST_HALF_SIZE * 2, 150, FOREST_HALF_SIZE * 2]);

/**
 * The openings in the tree grid, as circles. A tree whose trunk falls inside one is not planted.
 *
 * The central clearing is the map's one long sightline and the only place where both storeys are
 * visible at once; the four outer ones are where rounds start, far enough apart that no start
 * looks into another.
 */
export const FOREST_CLEARINGS = Object.freeze([
    Object.freeze({ x: 0, z: 0, radius: 104, name: 'heart' }),
    Object.freeze({ x: -212, z: -212, radius: 74, name: 'north-west' }),
    Object.freeze({ x: 212, z: -212, radius: 74, name: 'north-east' }),
    Object.freeze({ x: -212, z: 212, radius: 74, name: 'south-west' }),
    Object.freeze({ x: 212, z: 212, radius: 74, name: 'south-east' }),
]);

/**
 * Where the canopy decks stand, and how much room each one needs to itself.
 *
 * A deck is 56 units square, so a trunk within 40 of its centre would grow straight through the
 * planks - unclimbable, and a solid body in the middle of the one place the storey is meant to be
 * walkable. The trees give way there; the crowns around still close over the deck.
 */
export const CANOPY_DECK_RADIUS = 150;
export const CANOPY_DECK_CLEARANCE = 42;

export const CANOPY_DECK_SITES = Object.freeze([
    Object.freeze({ x: 0, z: -CANOPY_DECK_RADIUS }),
    Object.freeze({ x: CANOPY_DECK_RADIUS, z: 0 }),
    Object.freeze({ x: 0, z: CANOPY_DECK_RADIUS }),
    Object.freeze({ x: -CANOPY_DECK_RADIUS, z: 0 }),
]);

export const FOREST_OBSTACLES = Object.freeze([
    // The floor. It stays active with the GLBs loaded, because the decorative ground mesh is
    // flyable and something has to stop a ship at the roots instead of letting it fall out.
    Object.freeze({
        pos: [0, FOREST_GROUND / 2, 0],
        size: [FOREST_MAP_SIZE[0], FOREST_GROUND, FOREST_MAP_SIZE[2]],
        kind: 'foam',
        compileWithGlb: true,
    }),
]);

/**
 * Pickups. The rockets sit in the canopy and the shields on the ground, so each storey is worth
 * being on while the fog makes it the awkward one.
 */
export const FOREST_ITEMS = Object.freeze([
    Object.freeze({ id: 'gf_rocket_deck_n', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: CANOPY_DECK + 6, z: -150, weight: 1.2 }),
    Object.freeze({ id: 'gf_rocket_deck_s', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: CANOPY_DECK + 6, z: 150, weight: 1.2 }),
    Object.freeze({ id: 'gf_speed_deck_w', type: 'item_battery', pickupType: 'SPEED_UP', x: -150, y: CANOPY_DECK + 6, z: 0, weight: 1.0 }),
    Object.freeze({ id: 'gf_speed_deck_e', type: 'item_battery', pickupType: 'SPEED_UP', x: 150, y: CANOPY_DECK + 6, z: 0, weight: 1.0 }),
    Object.freeze({ id: 'gf_shield_heart', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: FOREST_GROUND + 10, z: 0, weight: 1.4 }),
    Object.freeze({ id: 'gf_ghost_nw', type: 'item_coin', pickupType: 'GHOST', x: -212, y: FOREST_GROUND + 10, z: -212, weight: 0.9 }),
    Object.freeze({ id: 'gf_thick_se', type: 'item_coin', pickupType: 'THICK', x: 212, y: FOREST_GROUND + 10, z: 212, weight: 0.9 }),
]);

/**
 * The climbs. Four updraughts on the outer clearings lift a ship from the roots into the canopy
 * in one go; without them the ground storey would be a trap once the fog lifts off it.
 */
export const FOREST_GATES = Object.freeze(FOREST_CLEARINGS.slice(1).map((clearing, index) => Object.freeze({
    id: `giant_forest_updraft_${index + 1}`,
    type: 'slingshot',
    pos: [clearing.x, FOREST_GROUND + 6, clearing.z],
    forward: [0, 1, 0],
    up: [0, 1, 0],
    params: Object.freeze({ duration: 1.6, forwardImpulse: 12, liftImpulse: 38, cooldown: 1.4 }),
})));

export const FOREST_PLAYER_SPAWN = Object.freeze({ x: -212, y: FOREST_GROUND + 12, z: -212 });

export const FOREST_BOT_SPAWNS = Object.freeze([
    Object.freeze({ x: 212, y: FOREST_GROUND + 12, z: -212 }),
    Object.freeze({ x: -212, y: FOREST_GROUND + 12, z: 212 }),
    Object.freeze({ x: 212, y: FOREST_GROUND + 12, z: 212 }),
    Object.freeze({ x: 0, y: CANOPY_DECK + 10, z: -150 }),
    Object.freeze({ x: 0, y: CANOPY_DECK + 10, z: 150 }),
]);

/** True while a point is inside one of the ground clearings. */
export function isInsideClearing(x, z, margin = 0) {
    for (const clearing of FOREST_CLEARINGS) {
        const dx = x - clearing.x;
        const dz = z - clearing.z;
        if (dx * dx + dz * dz <= (clearing.radius + margin) ** 2) return true;
    }
    return false;
}

/** Everywhere a tree must not stand: the ground clearings and the four canopy decks. */
export function isTreeFreeSite(x, z) {
    if (isInsideClearing(x, z)) return true;
    for (const site of CANOPY_DECK_SITES) {
        if (Math.hypot(x - site.x, z - site.z) <= CANOPY_DECK_CLEARANCE) return true;
    }
    return false;
}
