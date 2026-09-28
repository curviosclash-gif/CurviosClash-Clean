import { skyLadderRules } from './SkyLadderShared.js';

// Himmelsleiter IV: Sternenbrunnen -- the finale. Route: asteroid field -> ring station
// (branch: spoke tube vs. outer rim bypass) -> sun sail tunnel -> boost approach -> twin well
// spokes (alias lanes) -> vertical star well (slingshot rings) -> star gate finish.
// All obstacles are deterministic hand-placed geometry (no Math.random, no GLB).

function asteroid(x, y, z, size, rotateY) {
    return { pos: [x, y, z], size: [size, size, size], rotateY };
}

// Deep asteroid debris kept out of the y 20-34 / |z|<=20 flight corridor between CP01-CP04.
const ASTEROID_FIELD = [
    asteroid(-92, 16, 8, 10, 0.4),
    asteroid(-88, 42, -18, 11, 1.1),
    asteroid(-74, 14, -28, 9, 2.0),
    asteroid(-68, 40, 26, 12, 0.6),
    asteroid(-52, 15, 30, 8, 1.7),
    asteroid(-46, 44, -30, 10, 2.3),
    asteroid(-34, 16, -28, 9, 0.3),
    asteroid(-24, 42, 30, 8, 1.9),
    asteroid(-60, 44, 6, 9, 1.0),
    asteroid(-40, 14, 10, 8, 2.6),
];

// Six tangential plates ring the hub spoke tube at radius ~30-32; none reach the tube's
// radius-5.5 hollow or either CP05 ring centre (checked by hand, see report).
const STATION_RIM = [
    { pos: [40, 52, 32], size: [8, 10, 8], rotateY: 0.3 },
    { pos: [40, 52, -32], size: [8, 10, 8], rotateY: -0.3 },
    { pos: [64, 52, 20], size: [8, 10, 8], rotateY: 0.9 },
    { pos: [64, 52, -20], size: [8, 10, 8], rotateY: -0.9 },
    // Lowered clear of the CP04->CP05_RIM bypass line, which passes through y ~53 near here.
    { pos: [18, 40, 20], size: [8, 10, 8], rotateY: 1.4 },
    { pos: [18, 40, -20], size: [8, 10, 8], rotateY: -1.4 },
];

function wellColumn(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const radius = 17;
    return {
        pos: [150 + radius * Math.cos(rad), 125, radius * Math.sin(rad)],
        size: [4, 90, 4],
    };
}

// Six-column cage around the vertical shaft (y 80-170), radius 17 from the x=150/z=0 axis --
// every well checkpoint sits within z [-4, 6] of that axis, leaving >9 units of clearance.
const STAR_WELL_COLUMNS = [0, 60, 120, 180, 240, 300].map(wellColumn);

const OBSTACLES = [
    ...ASTEROID_FIELD,
    // Asteroid gates: flanking debris walls with a 15-wide gap centred on each ring.
    { pos: [-54, 26, 4], size: [10, 20, 9] },
    { pos: [-54, 26, 28], size: [10, 20, 9] },
    { pos: [-28, 30, -28], size: [10, 20, 9], kind: 'foam' },
    { pos: [-28, 30, -4], size: [10, 20, 9], kind: 'foam' },
    // Ring station: hub spoke shaft (CP05_SPOKE lane) is a hollow tunnel-box, not a solid tube
    // -- the desktop collision probe found the 'tube' shape solid, so a real hollow passage
    // needs the box+tunnel mechanism the sun sail already uses. Kept short of CP06 so neither
    // branch leg grazes its shell.
    { pos: [37.5, 52, 0], size: [35, 24, 28], tunnel: { radius: 8.0, axis: 'x' }, kind: 'hard' },
    ...STATION_RIM,
    // Sun sail: a thin wide plate punched through by a flight tunnel.
    { pos: [120, 58, 0], size: [6, 72, 72], tunnel: { radius: 7.0, axis: 'x' }, kind: 'foam' },
    // Star well: six-column cage around the vertical ascent shaft.
    ...STAR_WELL_COLUMNS,
];

const GATES = [
    {
        id: 'star_boost_field_exit',
        type: 'boost',
        pos: [-16, 38, -4],
        forward: [1, 0.1, 0.2],
        params: { duration: 1.0, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.9 },
    },
    {
        id: 'star_boost_sail_exit',
        type: 'boost',
        pos: [148, 62, 10],
        forward: [1, 0.1, 0.2],
        params: { duration: 1.0, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 },
    },
    {
        id: 'star_sling_well_lower',
        type: 'slingshot',
        pos: [150, 90, 0],
        forward: [0, 0.9, 0.2],
        up: [0, 1, 0],
        params: { duration: 1.6, forwardImpulse: 24, liftImpulse: 30, cooldown: 1.2 },
    },
    {
        id: 'star_sling_well_upper',
        type: 'slingshot',
        pos: [150, 134, -4],
        forward: [0, 0.9, 0.2],
        up: [0, 1, 0],
        params: { duration: 1.6, forwardImpulse: 24, liftImpulse: 30, cooldown: 1.2 },
    },
];

// Space-fold shortcut: entrance floats just past the ring station's rim bypass, exit sits in a
// pocket behind the asteroid field -- spatially backward, but purely a bonus loop back to an
// item cache. No checkpoint ring ever depends on it, so the route stays flyable with portals off.
const PORTALS = [
    { a: [46, 70, 40], b: [-100, 46, -10], color: 0x8866ff },
];

const ITEMS = [
    { id: 'star_speed_field', type: 'item_battery', pickupType: 'SPEED_UP', x: -54, y: 28, z: 16, weight: 1.2 },
    { id: 'star_shield_station', type: 'item_shield', pickupType: 'SHIELD', x: 40, y: 66, z: 34, weight: 1.1 },
    { id: 'star_fold_cache', type: 'item_coin', pickupType: 'THICK', x: -100, y: 48, z: -10, weight: 0.8 },
    { id: 'star_rocket_sail', type: 'item_rocket', pickupType: 'ROCKET_MEDIUM', x: 148, y: 64, z: 10, weight: 1.0 },
    { id: 'star_shield_well', type: 'item_shield', pickupType: 'SHIELD', x: 150, y: 112, z: 6, weight: 1.1 },
    { id: 'star_ghost_gate', type: 'item_coin', pickupType: 'GHOST', x: 150, y: 176, z: 0, weight: 0.9 },
];

export const SKY_LADDER_STAR_MAP = {
    name: 'Himmelsleiter IV: Sternenbrunnen',
    size: [340, 210, 200],
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    portalLevels: [40, 90, 150],
    fivePortalsExit: { pos: [150, 194, 0], color: 0xffcc44 },
    obstacles: OBSTACLES,
    portals: PORTALS,
    gates: GATES,
    playerSpawn: { x: -96, y: 22, z: 0 },
    botSpawns: [
        { x: -96, y: 22, z: -10 },
        { x: -96, y: 22, z: 10 },
        { x: -88, y: 22, z: 0 },
    ],
    items: ITEMS,
    missions: [
        { type: 'TIME_TRIAL', params: { target: 82 }, weight: 1.5 },
        { type: 'NO_DAMAGE', params: {}, weight: 0.8 },
    ],
    parcours: {
        enabled: true,
        routeId: 'sky_ladder_star_v1',
        rules: skyLadderRules({ maxSegmentTimeMs: 18000 }),
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [-80, 24, 0], radius: 7.0, forward: [1, 0.05, 0.1] },
            { id: 'CP02', type: 'gate', pos: [-54, 26, 16], radius: 6.0, forward: [1, 0.05, -0.3] },
            { id: 'CP03', type: 'gate', pos: [-28, 30, -16], radius: 5.6, forward: [1, 0.05, 0.3] },
            {
                id: 'CP04',
                type: 'branch_entry',
                pos: [-4, 40, 0],
                radius: 5.4,
                forward: [1, 0.1, 0],
                nextIds: ['CP05_SPOKE', 'CP05_RIM'],
            },
            {
                id: 'CP05_SPOKE',
                type: 'branch_precision',
                pos: [40, 52, 0],
                radius: 4.4,
                forward: [1, 0, 0],
                nextIds: ['CP06'],
            },
            {
                id: 'CP05_RIM',
                type: 'branch_gate',
                pos: [40, 66, 34],
                radius: 6.0,
                forward: [1, 0.15, -0.4],
                nextIds: ['CP06'],
            },
            { id: 'CP06', type: 'gate', pos: [80, 56, -6], radius: 5.6, forward: [1, 0.1, -0.3] },
            { id: 'CP07', type: 'tunnel', pos: [120, 58, 0], radius: 6.4, forward: [1, 0.05, 0] },
            { id: 'CP08', type: 'gate', pos: [148, 62, 10], radius: 5.6, forward: [1, 0.1, 0.2] },
            { id: 'CP09', type: 'split', pos: [150, 72, 30], radius: 5.2, forward: [0.3, 0.6, -0.5] },
            { id: 'CP09_R', type: 'split', aliasOf: 'CP09', pos: [150, 72, -30], radius: 5.2, forward: [0.3, 0.6, 0.5] },
            { id: 'CP10', type: 'slingshot', pos: [150, 90, 0], radius: 5.4, forward: [0, 0.9, 0.2] },
            { id: 'CP11', type: 'gate', pos: [150, 112, 6], radius: 5.2, forward: [0, 0.9, -0.2] },
            { id: 'CP12', type: 'slingshot', pos: [150, 134, -4], radius: 5.0, forward: [0, 0.9, 0.2] },
            { id: 'CP13', type: 'precision', pos: [150, 154, 2], radius: 4.2, forward: [0, 0.9, 0] },
            { id: 'CP14', type: 'finish_pre', pos: [150, 170, 0], radius: 5.4, forward: [0, 0.9, 0] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [150, 182, 0], radius: 7.2, forward: [0, 1, 0] },
    },
};
