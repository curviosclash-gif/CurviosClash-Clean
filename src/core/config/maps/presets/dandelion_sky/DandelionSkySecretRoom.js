// The Wurzelkammer is earned by stripping the whole flower head. Its portal appears in the
// emptied crown; the three emplacements stand outside around that portal, never in the room.

import {
    MUSHROOM_FACING,
    mushroomPatch,
    mushroomWallRow,
} from '../glowing_mushrooms.js';

const ROOM_HALF = 22;
const ROOM_FLOOR = -18;
const ROOM_CEILING = -4;
const WALL = 1;
const SHELL_HALF = ROOM_HALF + WALL;
const ROOM_HEIGHT = ROOM_CEILING - ROOM_FLOOR;
const ROOM_MID_Y = (ROOM_FLOOR + ROOM_CEILING) / 2;

export const DANDELION_SKY_ROOT_CHAMBER_OBSTACLES = Object.freeze([
    { pos: [0, ROOM_FLOOR - WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [0, ROOM_CEILING + WALL / 2, 0], size: [SHELL_HALF * 2, WALL, SHELL_HALF * 2] },
    { pos: [-ROOM_HALF - WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [ROOM_HALF + WALL / 2, ROOM_MID_Y, 0], size: [WALL, ROOM_HEIGHT, SHELL_HALF * 2] },
    { pos: [0, ROOM_MID_Y, -ROOM_HALF - WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
    { pos: [0, ROOM_MID_Y, ROOM_HALF + WALL / 2], size: [SHELL_HALF * 2, ROOM_HEIGHT, WALL] },
].map((box) => Object.freeze({
    ...box,
    kind: 'hard',
    renderWithGlb: true,
    compileWithGlb: true,
})));

// The room's own light. It is sealed rock under a flower, lit by nothing the map above it owns,
// and a player who has earned their way in should see that the place is alive rather than merely
// dark. Teal carries the entry portal's colour down into the room; the violet brackets keep the
// walls from reading as one flat tone.
//
// The render distance is short on purpose. The chamber sits at y=-11 while the match plays
// between y=29 and y=250, so at this distance the mushrooms are drawn for whoever is inside and
// for nobody else, even though the models load with the map like everything else.
const MUSHROOM_RENDER_DISTANCE = 55;
// A bracket reaches roughly half its target size in every direction from its anchor, and the
// loader centres it horizontally on top of that, so the inset has to clear half the largest
// bracket rather than the token gap a wall decoration looks like it needs.
const BRACKET_MAX_SIZE = 4.5;
const WALL_INSET = BRACKET_MAX_SIZE / 2 + 0.75;
// Brackets grow upward from their anchor, so the topmost one has to start a full bracket below
// the ceiling, not just clear of it.
const BRACKET_TOP = ROOM_CEILING - BRACKET_MAX_SIZE - 1.5;

export const DANDELION_SKY_ROOT_CHAMBER_MODELS = Object.freeze([
    // Two clumps on the floor, diagonally opposite, clear of the four corner pickups at +-14
    // and of the exit portal in the middle.
    ...mushroomPatch({
        id: 'dandelion-root-clump-west',
        centre: [-15, ROOM_FLOOR, -15],
        radius: 4.5,
        count: 3,
        size: [3.5, 5.5],
        forms: ['cap', 'coral'],
        hues: ['teal'],
        seed: 8231,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    ...mushroomPatch({
        id: 'dandelion-root-clump-east',
        centre: [15, ROOM_FLOOR, 15],
        radius: 4.5,
        count: 3,
        size: [3.5, 5.5],
        forms: ['cap', 'trumpet'],
        hues: ['teal', 'violet'],
        seed: 4417,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    // Brackets climbing two opposite walls, each on the half its wall's pickup is not on. All
    // four pickups sit at the middle of a wall, so a row that spans a whole wall covers one -
    // and a pickup a player cannot see is worse than a wall a player cannot see.
    //
    // The rows climb in opposite directions so the room reads as tall from either end rather
    // than as a box with one decorated corner.
    ...mushroomWallRow({
        id: 'dandelion-root-brackets-north',
        start: [4, ROOM_FLOOR + 3, -ROOM_HALF + WALL_INSET],
        end: [16, BRACKET_TOP, -ROOM_HALF + WALL_INSET],
        count: 3,
        size: [3, BRACKET_MAX_SIZE],
        facing: MUSHROOM_FACING.fromMinZ,
        hues: ['violet'],
        seed: 9013,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    ...mushroomWallRow({
        id: 'dandelion-root-brackets-south',
        start: [-16, BRACKET_TOP, ROOM_HALF - WALL_INSET],
        end: [-4, ROOM_FLOOR + 3, ROOM_HALF - WALL_INSET],
        count: 3,
        size: [3, BRACKET_MAX_SIZE],
        facing: MUSHROOM_FACING.fromMaxZ,
        hues: ['violet'],
        seed: 2609,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
]);

const MG_GUARD = Object.freeze({ weapon: 'mg', damage: 2, cooldown: 1.3 });
const ROCKET_GUARD = Object.freeze({ weapon: 'rocket', rocketType: 'ROCKET_WEAK', cooldown: 6 });

export const DANDELION_SKY_ROOT_CHAMBER_TURRETS = Object.freeze([
    { ...MG_GUARD, id: 'dandelion_root_mg_west', pos: [-100, 280, 0] },
    { ...MG_GUARD, id: 'dandelion_root_mg_east', pos: [175, 280, 0] },
    { ...ROCKET_GUARD, id: 'dandelion_root_rocket_south', pos: [39, 280, 135] },
].map((turret) => Object.freeze({
    ...turret,
    range: 150,
    destructible: true,
    maxHp: 45,
    respawnSeconds: 45,
    allowedModes: ['HUNT', 'ARCADE'],
    secretRoomId: 'root_chamber',
})));

const ITEMS = Object.freeze([
    { pos: [-14, -11, -14] },
    { pos: [14, -11, -14] },
    { pos: [14, -11, 14] },
    { pos: [-14, -11, 14] },
    { pos: [-7, -8, 0] },
    { pos: [7, -8, 0] },
    { pos: [0, -11, -16], type: 'SHIELD' },
    { pos: [0, -11, 16], type: 'HEALTH' },
    { pos: [-16, -11, 0], type: 'ROCKET_MEDIUM' },
    { pos: [16, -11, 0], type: 'SPEED_UP' },
]);

export const DANDELION_SKY_ROOT_CHAMBER = Object.freeze({
    id: 'root_chamber',
    modes: Object.freeze(['HUNT', 'ARCADE']),
    unlock: Object.freeze({
        source: 'dandelionSeeds',
        when: 'allReleased',
        delaySeconds: 0,
    }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    entryPortal: Object.freeze({ pos: Object.freeze([39, 318, 0]), color: 0xb7ffd8 }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -11, 0]) }),
    bounds: Object.freeze({
        min: Object.freeze([-ROOM_HALF, ROOM_FLOOR, -ROOM_HALF]),
        max: Object.freeze([ROOM_HALF, ROOM_CEILING, ROOM_HALF]),
    }),
    ejectPoint: Object.freeze({ pos: Object.freeze([0, 120, 170]), yawDeg: 0 }),
    items: ITEMS,
});
