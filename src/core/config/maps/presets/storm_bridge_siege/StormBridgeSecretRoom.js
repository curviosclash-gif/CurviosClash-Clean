const ROOM_HALF = 18;
const FLOOR = -18;
const CEILING = -6;
const WALL = 1;
const MID_Y = (FLOOR + CEILING) / 2;
const HEIGHT = CEILING - FLOOR;
const SHELL = ROOM_HALF + WALL;

export const STORM_BRIDGE_SECRET_ROOM_OBSTACLES = Object.freeze([
    { pos: [0, FLOOR - WALL / 2, 0], size: [SHELL * 2, WALL, SHELL * 2] },
    { pos: [0, CEILING + WALL / 2, 0], size: [SHELL * 2, WALL, SHELL * 2] },
    { pos: [-ROOM_HALF - WALL / 2, MID_Y, 0], size: [WALL, HEIGHT, SHELL * 2] },
    { pos: [ROOM_HALF + WALL / 2, MID_Y, 0], size: [WALL, HEIGHT, SHELL * 2] },
    { pos: [0, MID_Y, -ROOM_HALF - WALL / 2], size: [SHELL * 2, HEIGHT, WALL] },
    { pos: [0, MID_Y, ROOM_HALF + WALL / 2], size: [SHELL * 2, HEIGHT, WALL] },
].map((box) => Object.freeze({ ...box, kind: 'hard', renderWithGlb: true, compileWithGlb: true })));

const ITEMS = Object.freeze([
    [-11, -12, -11], [11, -12, -11], [11, -12, 11], [-11, -12, 11],
    [0, -10, 0], [-7, -10, 0], [7, -10, 0], [0, -10, 7], [0, -10, -7],
].map((pos) => Object.freeze({ pos: Object.freeze(pos) })));

export const STORM_BRIDGE_SECRET_ROOM = Object.freeze({
    id: 'bridge_vault',
    modes: Object.freeze(['HUNT', 'ARCADE']),
    unlock: Object.freeze({ destructible: 'storm_bridge', when: 'anyBreak', delaySeconds: 4 }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    entryPortal: Object.freeze({ pos: Object.freeze([0, 10, -62]), color: 0x45d8ff }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -12, 0]) }),
    bounds: Object.freeze({
        min: Object.freeze([-ROOM_HALF, FLOOR, -ROOM_HALF]),
        max: Object.freeze([ROOM_HALF, CEILING, ROOM_HALF]),
    }),
    ejectPoint: Object.freeze({ pos: Object.freeze([0, 16, -70]), yawDeg: 180 }),
    items: ITEMS,
});
