// The Wurzelkammer is earned by stripping the whole flower head. Its portal appears in the
// emptied crown; the three emplacements stand outside around that portal, never in the room.

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
