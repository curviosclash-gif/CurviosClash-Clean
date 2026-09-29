// The Honigkammer is earned by shooting every kernel out of the sunflower head. Its portal
// appears in front of the emptied disc; the three emplacements stand around that portal. The
// shell mirrors the dandelion's root chamber so both rooms play alike.

import { mushroomPatch, mushroomWallRow, MUSHROOM_FACING } from '../glowing_mushrooms.js';

const ROOM_HALF = 22;
const ROOM_FLOOR = -32;
const ROOM_CEILING = -4;
const WALL = 1;
const SHELL_HALF = ROOM_HALF + WALL;
const ROOM_HEIGHT = ROOM_CEILING - ROOM_FLOOR;
const ROOM_MID_Y = (ROOM_FLOOR + ROOM_CEILING) / 2;

export const SUNFLOWER_MEADOW_HONEY_CHAMBER_OBSTACLES = Object.freeze([
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

// Amber is the honey the room is named for; the violet brackets keep the walls from reading as
// one flat tone. Drawn only at short range, so nobody above the floor pays for them.
const MUSHROOM_RENDER_DISTANCE = 55;
const BRACKET_MAX_SIZE = 4.5;
const WALL_INSET = BRACKET_MAX_SIZE / 2 + 0.75;
const BRACKET_TOP = ROOM_CEILING - BRACKET_MAX_SIZE - 1.5;

export const SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS = Object.freeze([
    // Diagonally opposite floor clumps, clear of the corner pickups at +-14 and the exit portal.
    ...mushroomPatch({
        id: 'sunflower-honey-clump-west',
        centre: [-15, ROOM_FLOOR, 15],
        radius: 4.5,
        count: 3,
        size: [3.5, 5.5],
        forms: ['cap', 'coral'],
        hues: ['amber'],
        seed: 5171,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    ...mushroomPatch({
        id: 'sunflower-honey-clump-east',
        centre: [15, ROOM_FLOOR, -15],
        radius: 4.5,
        count: 3,
        size: [3.5, 5.5],
        forms: ['cap', 'trumpet'],
        hues: ['amber', 'violet'],
        seed: 7723,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    // Each row climbs the half of its wall that the wall's middle pickup is not on.
    ...mushroomWallRow({
        id: 'sunflower-honey-brackets-north',
        start: [-16, ROOM_FLOOR + 3, -ROOM_HALF + WALL_INSET],
        end: [-4, BRACKET_TOP, -ROOM_HALF + WALL_INSET],
        count: 3,
        size: [3, BRACKET_MAX_SIZE],
        facing: MUSHROOM_FACING.fromMinZ,
        hues: ['amber'],
        seed: 3307,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
    ...mushroomWallRow({
        id: 'sunflower-honey-brackets-south',
        start: [16, BRACKET_TOP, ROOM_HALF - WALL_INSET],
        end: [4, ROOM_FLOOR + 3, ROOM_HALF - WALL_INSET],
        count: 3,
        size: [3, BRACKET_MAX_SIZE],
        facing: MUSHROOM_FACING.fromMaxZ,
        hues: ['violet'],
        seed: 6089,
        maxRenderDistance: MUSHROOM_RENDER_DISTANCE,
    }),
]);

// In front of the enlarged kernel disc, clear of its petals and head collider.
export const SUNFLOWER_MEADOW_HONEY_PORTAL = Object.freeze([3, 254, 43]);

const MG_GUARD = Object.freeze({ weapon: 'mg', damage: 2, cooldown: 1.3 });
const ROCKET_GUARD = Object.freeze({ weapon: 'rocket', rocketType: 'ROCKET_WEAK', cooldown: 6 });

// The guards ring the larger head's portal without reaching the chamber below the meadow.
export const SUNFLOWER_MEADOW_HONEY_CHAMBER_TURRETS = Object.freeze([
    { ...MG_GUARD, id: 'sunflower_honey_mg_west', pos: [-65, 260, 43] },
    { ...MG_GUARD, id: 'sunflower_honey_mg_east', pos: [71, 260, 43] },
    { ...ROCKET_GUARD, id: 'sunflower_honey_rocket_front', pos: [3, 275, 105] },
].map((turret) => Object.freeze({
    ...turret,
    range: 135,
    destructible: true,
    maxHp: 45,
    respawnSeconds: 45,
    allowedModes: ['HUNT', 'ARCADE'],
    secretRoomId: 'honey_chamber',
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
    // The prizes every secret room holds (user decision 28.09.2026).
    { pos: [0, -8, -8], type: 'BOMBER_STRIKE' },
    { pos: [0, -8, 8], type: 'LIGHTNING' },
].flatMap((item) => [
    item,
    { ...item, pos: [item.pos[0], item.pos[1] - ROOM_HEIGHT / 2, item.pos[2]] },
]));

export const SUNFLOWER_MEADOW_HONEY_CHAMBER = Object.freeze({
    id: 'honey_chamber',
    modes: Object.freeze(['HUNT', 'ARCADE']),
    unlock: Object.freeze({
        source: 'sunflowerKernels',
        when: 'allReleased',
        delaySeconds: 0,
    }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    entryPortal: Object.freeze({ pos: SUNFLOWER_MEADOW_HONEY_PORTAL, color: 0xffc34d }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -11, 0]) }),
    bounds: Object.freeze({
        min: Object.freeze([-ROOM_HALF, ROOM_FLOOR, -ROOM_HALF]),
        max: Object.freeze([ROOM_HALF, ROOM_CEILING, ROOM_HALF]),
    }),
    ejectPoint: Object.freeze({ pos: Object.freeze([0, 60, 80]), yawDeg: 0 }),
    items: ITEMS,
});
