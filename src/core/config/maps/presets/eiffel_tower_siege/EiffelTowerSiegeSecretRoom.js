// The vault under the Champ-de-Mars: the reward for bringing a piece of the tower down.
//
// Four seconds after the first part of the tower breaks, a portal opens on the esplanade. It leads
// into a sealed box below the ground, stocked with pickups and watched by three emplacements. After
// twenty seconds the room throws the visitor back out, facing the tower.
//
// Everything here is authored in map units, exactly like `size`, `obstacles` and `portals` of this
// preset. The arena multiplies by the map scale (3) while it builds, so one map unit is three world
// metres. Where a number has to be compared with a weapon reach - those are world metres - the
// comment says which of the two it is.
//
// Three numbers decide the whole layout and none of them is taste:
//   - The arena box runs from y = 0 to y = 220, so the room has to hang below zero with at least
//     two map units of rock between the two. Touching would leave the normal on the seam undecided.
//   - A collapse settles at most 130.9 map units from the tower axis (218.2 m at 0.6 units per
//     metre, measured on the baked clips). Both the portal and the eject point stand outside that
//     circle, so no fall can ever bury either of them.
//   - Half the field is 155 map units, and a portal keeps eight units clear of the side walls.
//
// The guards are ordinary `staticTurrets`. They stand in the room and nowhere else, which is what
// makes the eject point safe: it is a full field away from them, far beyond the 270 world metres
// the rocket emplacement reaches.

/** Interior of the room. The ceiling is four map units below the arena floor. */
const ROOM_HALF = 20;
const ROOM_CEILING = -4;
const ROOM_FLOOR = -16;

const ROOM_BOUNDS = Object.freeze({
    min: Object.freeze([-ROOM_HALF, ROOM_FLOOR, -ROOM_HALF]),
    max: Object.freeze([ROOM_HALF, ROOM_CEILING, ROOM_HALF]),
});

// Wall thickness. The boxes sit outside the bounds, so the playable volume describes the inside of
// the room with no wall in it - the arena already answers for the room walls through
// `ArenaPlayableVolumes`, and these boxes only have to be seen.
const WALL = 1;
const SHELL_HALF = ROOM_HALF + WALL;
const ROOM_HEIGHT = ROOM_CEILING - ROOM_FLOOR;
const ROOM_MID_Y = (ROOM_CEILING + ROOM_FLOOR) / 2;

/**
 * Floor, ceiling and the four walls as plain boxes (decision E78: no GLB for the first version).
 *
 * Both flags are needed and neither is decoration: with the tower GLBs loaded the arena compiles
 * only the obstacles marked `compileWithGlb`, and of those it keeps the visuals only for the ones
 * marked `renderWithGlb`. A box with just one of the two is either invisible or gone entirely.
 */
export const EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES = Object.freeze([
    { pos: [0, ROOM_FLOOR - WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [0, ROOM_CEILING + WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [-ROOM_HALF - WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [ROOM_HALF + WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [0, ROOM_MID_Y, -ROOM_HALF - WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
    { pos: [0, ROOM_MID_Y, ROOM_HALF + WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
].map((box) => Object.freeze({ ...box, kind: 'hard', renderWithGlb: true, compileWithGlb: true })));

/**
 * Three emplacements around the way back, so arriving in the middle of the room costs something.
 * Ranges stay at the contract's own fallbacks: the room is 40 map units across, so everything is
 * in reach of everything anyway. What the map does say is what was decided: 45 hit points, 45
 * seconds until a destroyed guard stands there again - and a fire rate tamed so that a vehicle
 * just sitting there lasts about twelve seconds instead of four (guns 2 hp every 1.3 s instead
 * of 4 every 0.8 s, a rocket every 6 s instead of 3.4 s). tests/secret-room-guard-balance pins it.
 */
const MG_GUARD = Object.freeze({ weapon: 'mg', damage: 2, cooldown: 1.3 });
const ROCKET_GUARD = Object.freeze({ weapon: 'rocket', rocketType: 'ROCKET_WEAK', cooldown: 6 });

export const EIFFEL_SIEGE_SECRET_ROOM_TURRETS = Object.freeze([
    { ...MG_GUARD, id: 'eiffel_siege_vault_mg_west', pos: [-13, -13, -13] },
    { ...MG_GUARD, id: 'eiffel_siege_vault_mg_east', pos: [13, -13, -13] },
    { ...ROCKET_GUARD, id: 'eiffel_siege_vault_rocket', pos: [0, -13, 14] },
].map((turret) => Object.freeze({
    ...turret,
    destructible: true,
    maxHp: 45,
    respawnSeconds: 45,
    allowedModes: ['HUNT', 'ARCADE'],
})));

// Ten item points at mid height. Six of them name no type on purpose: an unnamed point draws from
// the mode's own weighted choice, so the room is worth entering twice.
const ITEMS = Object.freeze([
    { pos: [-12, -10, -12] },
    { pos: [12, -10, -12] },
    { pos: [12, -10, 12] },
    { pos: [-12, -10, 12] },
    { pos: [-6, -8, 0] },
    { pos: [6, -8, 0] },
    { pos: [0, -10, -14], type: 'SHIELD' },
    { pos: [0, -10, 14], type: 'HEALTH' },
    { pos: [-14, -10, 0], type: 'ROCKET_MEDIUM' },
    { pos: [14, -10, 0], type: 'ROCKET_HEAVY' },
]);

export const EIFFEL_SIEGE_SECRET_ROOM = Object.freeze({
    id: 'vault',
    // Hunt is the mode the tower can be brought down in, so hunt is the mode the room is earned in.
    // Arcade is listed as well because a mode that cannot break anything opens the portal from the
    // first second - which is the agreed reading, not an oversight.
    modes: Object.freeze(['HUNT', 'ARCADE']),
    // This map carries exactly one destructible block and it has no id of its own, so `destructible`
    // is documentation; `anyBreak` is what the runtime reads. Four seconds let the collapse play
    // before the portal appears.
    unlock: Object.freeze({ destructible: 'eiffel_tower', when: 'anyBreak', delaySeconds: 4 }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    // Due west, 140 map units out: past the 130.9 the wreck reaches, 15 units clear of the wall, and
    // a quarter turn away from all four diagonals a leg topples along. Twelve units above the
    // esplanade, the height the rest of the map is flown at.
    entryPortal: Object.freeze({ pos: Object.freeze([-140, 20, 0]), color: 0xffc94d }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -10, 0]) }),
    bounds: ROOM_BOUNDS,
    // Due south, the same 140 units out and a whole field away from the guards below the centre.
    // Yaw 180 turns the ship's forward (0, 0, -1) onto +Z, which is where the tower stands from here.
    ejectPoint: Object.freeze({ pos: Object.freeze([0, 34, -140]), yawDeg: 180 }),
    items: ITEMS,
});
