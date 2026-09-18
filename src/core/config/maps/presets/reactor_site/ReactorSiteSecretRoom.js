// The bunker under the reactor site: the reward for putting the first hole in the plant.
//
// Four seconds after any one of the five structures loses a part, a portal opens on the apron
// north of the containment. It leads into a sealed box below the site, stocked with pickups and
// watched by three emplacements. After twenty seconds the room throws the visitor back out on the
// grass, facing the plant.
//
// Everything here is authored in map units, exactly like `size`, `obstacles` and `gates` of this
// preset. The arena multiplies by the map scale (3) while it builds, so one map unit is three
// world metres. Where a number has to be compared with a weapon reach - those are world metres -
// the comment says which of the two it is.
//
// Where the portal stands, and why not in the middle of the reactor
// ------------------------------------------------------------------------------------------------
// The plan asks for one fixed place at the reactor, the same one whichever structure breaks first.
// The middle itself is solid: the containment block fills x and z from -15 to 15 and its northern
// wing reaches out to z = 36, and after the breach the ruin settles in exactly that footprint. So
// the portal takes the nearest place that is free before and after every break - the open apron due
// north of the wing, on the axis of the plant, twelve map units clear of the wing and well short of
// the switchyard slab that starts at z = 54.
//
// Every break was measured against that spot, in map units from the segment's own anchor:
//   cooling towers  69.1 reach from x = -63 and x = 63   portal is 79.2 away from each
//   vent stack      53.0 reach from (57.6, -39.6)        portal is 104.8 away
//   turbine hall    53.0 reach from (0, -64.8)           portal is 112.8 away
//   containment     no topple at all; the cloud is authored decorative and collides with nothing,
//                   the ruin stays inside the 36 unit footprint - the portal is 48 away
// The eject point is the same axis, 130 units out on the grass between the perimeter fence and the
// tree line: past every wreck field again, and 373 world metres from the rocket emplacement in the
// room, which reaches 270.

import { up } from './ReactorSiteStructure.js';

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
 * Both flags are needed and neither is decoration. This map takes its collision off the exported
 * concrete (`glbColliderMode: 'scene'`), and it then compiles only the authored boxes marked
 * `compileWithGlb`; of those it keeps the visuals only for the ones marked `renderWithGlb`. The
 * map-wide `glbAuthoredObstaclesCollisionOnly` is what strips the rest, and the per-box flag is
 * what wins the visuals back - no GLB draws this room, so its walls need both.
 */
export const REACTOR_SITE_SECRET_ROOM_OBSTACLES = Object.freeze([
    { pos: [0, ROOM_FLOOR - WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [0, ROOM_CEILING + WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [-ROOM_HALF - WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [ROOM_HALF + WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [0, ROOM_MID_Y, -ROOM_HALF - WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
    { pos: [0, ROOM_MID_Y, ROOM_HALF + WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
].map((box) => Object.freeze({ ...box, kind: 'hard', renderWithGlb: true, compileWithGlb: true })));

/**
 * Three emplacements around the way back, so arriving in the middle of the room costs something.
 * Ranges, cooldown and damage stay at the contract's own fallbacks: the room is 40 map units
 * across, every one of them is in reach of everything anyway, and a number that never changes does
 * not belong in the map file. What the map does say is what the plan decided: 45 hit points and 45
 * seconds until a destroyed guard stands there again.
 */
export const REACTOR_SITE_SECRET_ROOM_TURRETS = Object.freeze([
    { id: 'reactor_site_bunker_mg_west', weapon: 'mg', pos: [-13, -13, -13] },
    { id: 'reactor_site_bunker_mg_east', weapon: 'mg', pos: [13, -13, -13] },
    { id: 'reactor_site_bunker_rocket', weapon: 'rocket', rocketType: 'ROCKET_WEAK', pos: [0, -13, 14] },
].map((turret) => Object.freeze({
    ...turret,
    destructible: true,
    maxHp: 45,
    respawnSeconds: 45,
    allowedModes: ['HUNT', 'ARCADE'],
})));

// Ten item points at mid height. Five of them name no type on purpose: an unnamed point draws from
// the mode's own weighted choice, so the room is worth entering twice. The five that do name one
// are the plant's own flavour - shield, speed, ghost and the two heavier rockets a siege needs.
const ITEMS = Object.freeze([
    { pos: [-12, -10, -12] },
    { pos: [12, -10, -12] },
    { pos: [12, -10, 12] },
    { pos: [-12, -10, 12] },
    { pos: [0, -8, 0] },
    { pos: [-6, -8, -6], type: 'SHIELD' },
    { pos: [6, -8, -6], type: 'SPEED_UP' },
    { pos: [0, -10, -15], type: 'GHOST' },
    { pos: [-15, -10, 0], type: 'ROCKET_MEDIUM' },
    { pos: [15, -10, 0], type: 'ROCKET_HEAVY' },
]);

export const REACTOR_SITE_SECRET_ROOM = Object.freeze({
    id: 'bunker',
    // Hunt is the mode the plant can be brought down in, so hunt is the mode the room is earned in.
    // Arcade is listed as well because a mode that cannot break anything opens the portal from the
    // first second - which is the agreed reading, not an oversight.
    modes: Object.freeze(['HUNT', 'ARCADE']),
    // This map carries exactly one destructible block and it has no id of its own, so `destructible`
    // is documentation; `anyBreak` is what the runtime reads, and it is also what the fixed portal
    // place needs - any one of the five structures may be the one that opens it. Four seconds let
    // the collapse play before the portal appears.
    unlock: Object.freeze({ destructible: 'reactor_site', when: 'anyBreak', delaySeconds: 4 }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    // Due north of the containment, on the axis of the plant, at the height the map is flown at.
    entryPortal: Object.freeze({ pos: Object.freeze([0, up(36), 48]), color: 0x8cff4d }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -10, 0]) }),
    bounds: ROOM_BOUNDS,
    // The same axis, out on the grass. Yaw 0 leaves the ship's forward (0, 0, -1) pointing south,
    // which is where the plant stands from here.
    ejectPoint: Object.freeze({ pos: Object.freeze([0, up(40), 130]), yawDeg: 0 }),
    items: ITEMS,
});
