const ROOM_HALF = 17;
const FLOOR = -17;
const CEILING = -5;
const WALL = 1;
const MID_Y = (FLOOR + CEILING) / 2;
const HEIGHT = CEILING - FLOOR;
const SHELL = ROOM_HALF + WALL;

export const STORM_LIGHTHOUSE_SECRET_ROOM_OBSTACLES = Object.freeze([
    { pos: [0, FLOOR - WALL / 2, 0], size: [SHELL * 2, WALL, SHELL * 2] },
    { pos: [0, CEILING + WALL / 2, 0], size: [SHELL * 2, WALL, SHELL * 2] },
    { pos: [-ROOM_HALF - WALL / 2, MID_Y, 0], size: [WALL, HEIGHT, SHELL * 2] },
    { pos: [ROOM_HALF + WALL / 2, MID_Y, 0], size: [WALL, HEIGHT, SHELL * 2] },
    { pos: [0, MID_Y, -ROOM_HALF - WALL / 2], size: [SHELL * 2, HEIGHT, WALL] },
    { pos: [0, MID_Y, ROOM_HALF + WALL / 2], size: [SHELL * 2, HEIGHT, WALL] },
].map((box) => Object.freeze({ ...box, kind: 'hard', renderWithGlb: true, compileWithGlb: true })));

const ITEMS = Object.freeze([
    [-10, -11, -10], [10, -11, -10], [10, -11, 10], [-10, -11, 10],
    [0, -9, 0], [-7, -9, 0], [7, -9, 0], [0, -9, 7], [0, -9, -7],
].map((pos) => Object.freeze({ pos: Object.freeze(pos) })));

export const STORM_LIGHTHOUSE_SECRET_ROOM = Object.freeze({
    id: 'lighthouse_vault',
    modes: Object.freeze(['HUNT', 'ARCADE']),
    unlock: Object.freeze({ destructible: 'storm_lighthouse', when: 'anyBreak', delaySeconds: 5.5 }),
    stayLimitSeconds: 20,
    refillSeconds: 30,
    entryPortal: Object.freeze({ pos: Object.freeze([21, 11, 0]), color: 0xffd35a }),
    roomPortal: Object.freeze({ pos: Object.freeze([0, -11, 0]) }),
    bounds: Object.freeze({
        min: Object.freeze([-ROOM_HALF, FLOOR, -ROOM_HALF]),
        max: Object.freeze([ROOM_HALF, CEILING, ROOM_HALF]),
    }),
    ejectPoint: Object.freeze({ pos: Object.freeze([28, 17, -12]), yawDeg: 135 }),
    items: ITEMS,
});
