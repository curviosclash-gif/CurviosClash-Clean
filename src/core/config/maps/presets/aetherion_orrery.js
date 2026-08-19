const BEAT_SECONDS = 12;
const LEVELS = Object.freeze([24, 84, 144]);

function architecture(id, file, position, targetSize, rotateY = 0) {
    return {
        id: `aetherion-orrery-${id}`,
        url: `assets/maps/aetherion_orrery/glb/${file}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function mechanism(id, file, clipName, phaseOffsetBeats, position, targetSize, rotateY = 0) {
    return {
        ...architecture(id, file, position, targetSize, rotateY),
        animationClock: { clipName, phaseOffsetBeats },
    };
}

const AETHERION_MODELS = [
    architecture('stellar-foundry', '01_stellar_foundry', [0, 18, 0], 112),
    architecture('meridian-gallery', '02_meridian_gallery', [0, 78, 0], 112),
    architecture('eclipse-crown', '03_eclipse_crown', [0, 138, 0], 108),
    // One continuous decorative helix makes the safe outer route readable between levels.
    architecture('outer-arcades', '04_outer_arcades', [0, 18, 0], 300),

    mechanism('bridge-lower', '05_meridian_bridges', 'MeridianBridgeLoop', 0, [-70, 24, -30], 38),
    mechanism('bridge-middle', '05_meridian_bridges', 'MeridianBridgeLoop', 1 / 3, [70, 84, 20], 38, Math.PI / 2),
    mechanism('bridge-crown', '05_meridian_bridges', 'MeridianBridgeLoop', 2 / 3, [-30, 144, 65], 38, Math.PI / 4),

    mechanism('astrolabe-foundry', '06_astrolabe_gate', 'AstrolabeGateLoop', 0.5, [0, 24, 0], 40),
    mechanism('astrolabe-gallery', '06_astrolabe_gate', 'AstrolabeGateLoop', 0, [0, 84, 0], 40, Math.PI / 2),
    mechanism('eclipse-iris', '07_eclipse_iris', 'EclipseIrisLoop', 0.25, [0, 144, 0], 42),

    mechanism('comet-foundry', '08_comet_pendulum', 'CometPendulumLoop', 0, [85, 24, 55], 42),
    mechanism('comet-gallery', '08_comet_pendulum', 'CometPendulumLoop', 0.5, [-85, 84, -45], 42, Math.PI / 2),
    mechanism('comet-crown', '08_comet_pendulum', 'CometPendulumLoop', 0.25, [75, 144, -55], 42),

    mechanism('zodiac-foundry', '09_zodiac_louvre', 'ZodiacLouvreLoop', 0.5, [-55, 24, 70], 40, Math.PI / 2),
    mechanism('zodiac-gallery', '09_zodiac_louvre', 'ZodiacLouvreLoop', 0, [55, 84, -70], 40),
    mechanism('zodiac-crown', '09_zodiac_louvre', 'ZodiacLouvreLoop', 0.75, [-70, 144, -15], 40, Math.PI / 2),

    // The core is animated but every mesh is _nocol, so it can never seal a route.
    mechanism('celestial-core', '10_celestial_core', 'CelestialCoreLoop', 0, [0, 70, 0], 120),
];

function levelDeck(y) {
    // The 40-unit outer band is permanently open and forms the fail-safe vertical route.
    return { pos: [0, y, 0], size: [240, 4, 240], kind: 'foam' };
}

function corridorFlanks(x, y, z, rotate = false) {
    if (rotate) {
        return [
            { pos: [x, y + 14, z - 22], size: [44, 28, 12] },
            { pos: [x, y + 14, z + 22], size: [44, 28, 12] },
        ];
    }
    return [
        { pos: [x - 22, y + 14, z], size: [12, 28, 44] },
        { pos: [x + 22, y + 14, z], size: [12, 28, 44] },
    ];
}

const AETHERION_OBSTACLES = [
    { pos: [0, 6, 0], size: [300, 4, 300], kind: 'foam' },
    levelDeck(LEVELS[1] - 8),
    levelDeck(LEVELS[2] - 8),

    // Fixed architecture frames the timed inner passages; none touches the safe outer band.
    ...corridorFlanks(-70, 24, -30),
    ...corridorFlanks(70, 84, 20, true),
    ...corridorFlanks(-30, 144, 65),
    ...corridorFlanks(0, 24, 0),
    ...corridorFlanks(0, 84, 0, true),
    ...corridorFlanks(0, 144, 0),
    ...corridorFlanks(-55, 24, 70, true),
    ...corridorFlanks(55, 84, -70),
    ...corridorFlanks(-70, 144, -15, true),

    // Four landmarks make the outer ascent visible while leaving a 24-unit clear corridor.
    { pos: [-132, 46, -132], size: [10, 76, 10] },
    { pos: [132, 46, 132], size: [10, 76, 10] },
    { pos: [-132, 106, 132], size: [10, 76, 10] },
    { pos: [132, 106, -132], size: [10, 76, 10] },
];

const AETHERION_PORTALS = [
    { a: [-138, 24, -104], b: [-138, 84, 104], color: 0x5ce1e6 },
    { a: [138, 84, -104], b: [138, 144, 104], color: 0xffd166 },
];

const AETHERION_GATES = [
    { id: 'orrery_lower_orbit', type: 'boost', pos: [0, 24, -128], forward: [0.7, 0.1, 0.7], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
    { id: 'orrery_east_ascent', type: 'slingshot', pos: [132, 48, 0], forward: [0, 0.85, 0.3], up: [0, 1, 0], params: { duration: 1.7, forwardImpulse: 26, liftImpulse: 21, cooldown: 1.2 } },
    { id: 'orrery_middle_orbit', type: 'boost', pos: [0, 84, 128], forward: [-0.7, 0.1, -0.7], params: { duration: 1.0, forwardImpulse: 37, bonusSpeed: 46, cooldown: 0.8 } },
    { id: 'orrery_west_ascent', type: 'slingshot', pos: [-132, 108, 0], forward: [0, 0.85, -0.3], up: [0, 1, 0], params: { duration: 1.7, forwardImpulse: 26, liftImpulse: 21, cooldown: 1.2 } },
    { id: 'orrery_crown_orbit', type: 'boost', pos: [0, 144, -128], forward: [0.8, 0, 0.6], params: { duration: 0.9, forwardImpulse: 39, bonusSpeed: 48, cooldown: 0.7 } },
    { id: 'orrery_eclipse_sling', type: 'slingshot', pos: [0, 154, -34], forward: [0, 0.15, 1], up: [0, 1, 0], params: { duration: 1.3, forwardImpulse: 34, liftImpulse: 9, cooldown: 1.0 } },
];

// Twelve route stages; CP03, CP06 and CP09 each expose a safe and a fast lane.
const AETHERION_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [0, 24, -138], radius: 7.0, forward: [0, 0, 1] },
    { id: 'CP02', type: 'foundry_branch', pos: [0, 28, -105], radius: 6.2, forward: [0, 0.05, 1], nextIds: ['CP03_SAFE', 'CP03_FAST'] },
    { id: 'CP03_SAFE', type: 'outer_safe', pos: [-122, 30, -60], radius: 6.0, forward: [-0.7, 0.02, 0.7], nextIds: ['CP04'] },
    { id: 'CP03_FAST', type: 'astrolabe_fast', pos: [0, 34, 15], radius: 4.8, forward: [-0.45, 0, 0.9], nextIds: ['CP04'] },
    { id: 'CP04', type: 'foundry_exit', pos: [-70, 30, 70], radius: 6.4, forward: [-0.55, 0.35, 0.75] },
    { id: 'CP05', type: 'gallery_branch', pos: [88, 88, 46], radius: 6.0, forward: [-0.6, 0.1, 0.8], nextIds: ['CP06_SAFE', 'CP06_FAST'] },
    { id: 'CP06_SAFE', type: 'outer_safe', pos: [128, 100, 88], radius: 6.0, forward: [-0.8, 0.2, 0.55], nextIds: ['CP07'] },
    { id: 'CP06_FAST', type: 'meridian_fast', pos: [52, 94, 26], radius: 4.8, forward: [-0.8, 0.15, 0.55], nextIds: ['CP07'] },
    { id: 'CP07', type: 'gallery_exit', pos: [14, 90, 112], radius: 6.4, forward: [0.75, 0.35, -0.55] },
    { id: 'CP08', type: 'eclipse_branch', pos: [-52, 148, 88], radius: 5.8, forward: [-0.7, 0.05, -0.7], nextIds: ['CP09_SAFE', 'CP09_FAST'] },
    { id: 'CP09_SAFE', type: 'outer_safe', pos: [-138, 154, 40], radius: 6.0, forward: [0.45, 0, -0.9], nextIds: ['CP10'] },
    { id: 'CP09_FAST', type: 'eclipse_fast', pos: [-30, 154, 18], radius: 4.6, forward: [0.25, 0, -0.97], nextIds: ['CP10'] },
    { id: 'CP10', type: 'crown_west', pos: [-82, 154, -72], radius: 5.8, forward: [0.65, 0, -0.75] },
    { id: 'CP11', type: 'crown_north', pos: [0, 154, -122], radius: 5.8, forward: [0.8, 0, 0.6] },
    { id: 'CP12', type: 'core_approach', pos: [92, 154, -42], radius: 5.6, forward: [-0.7, 0, 0.7] },
];

export const AETHERION_ORRERY_MAP = {
    aetherion_orrery: {
        name: 'Aetherion Orrery',
        size: [320, 210, 320],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: LEVELS,
        obstacles: AETHERION_OBSTACLES,
        portals: AETHERION_PORTALS,
        gates: AETHERION_GATES,
        glbModels: AETHERION_MODELS,
        glbAnimationClock: { beatSeconds: BEAT_SECONDS },
        glbColliderMode: 'dynamic',
        glbLoadConcurrency: 3,
        singlePlayerScenario: {
            enabled: true,
            id: 'aetherion_orrery_hunt',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 5,
            botRoles: ['guard', 'flanker', 'pursuer', 'interceptor', 'flanker'],
        },
        playerSpawn: { x: 0, y: 24, z: -146 },
        botSpawns: [
            { x: 118, y: 24, z: 112 },
            { x: -118, y: 84, z: 112 },
            { x: 118, y: 84, z: -112 },
            { x: -118, y: 144, z: -112 },
            { x: 118, y: 144, z: 112 },
        ],
        staticTurrets: [
            { id: 'orrery_meridian_turret', weapon: 'mg', pos: [0, 96, 0], range: 68, cooldown: 1.0, damage: 4, phase: 0.5 },
            { id: 'orrery_eclipse_turret', weapon: 'rocket', pos: [0, 158, 0], range: 84, cooldown: 4.2, rocketType: 'ROCKET_MEDIUM', phase: 1.4 },
        ],
        items: [
            { id: 'orrery_shield_lower_west', type: 'item_shield', pickupType: 'SHIELD', x: -122, y: 28, z: -88, weight: 1.2 },
            { id: 'orrery_shield_middle_east', type: 'item_shield', pickupType: 'SHIELD', x: 122, y: 88, z: 88, weight: 1.2 },
            { id: 'orrery_shield_crown_west', type: 'item_shield', pickupType: 'SHIELD', x: -122, y: 148, z: 88, weight: 1.1 },
            { id: 'orrery_rocket_astrolabe', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: 38, z: 18, weight: 0.9 },
            { id: 'orrery_rocket_meridian', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 52, y: 98, z: 26, weight: 0.9 },
            { id: 'orrery_rocket_eclipse', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: 158, z: 18, weight: 0.6 },
            { id: 'orrery_speed_lower', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 28, z: -118, weight: 1.1 },
            { id: 'orrery_speed_middle', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 88, z: 118, weight: 1.1 },
            { id: 'orrery_ghost_crown', type: 'item_coin', pickupType: 'GHOST', x: 88, y: 148, z: -88, weight: 0.8 },
            { id: 'orrery_thick_core', type: 'item_coin', pickupType: 'THICK', x: 0, y: 92, z: 42, weight: 0.8 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 260 }, weight: 1.4 },
            { type: 'KILL_COUNT', params: { target: 5 }, weight: 1.3 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'aetherion_orrery_v1',
            rules: {
                ordered: true,
                bidirectionalCheckpoints: false,
                resetOnDeath: false,
                resetToLastValid: true,
                respawnOnDeath: true,
                lastCheckpointRespawns: 3,
                respawnDelaySeconds: 3,
                maxSegmentTimeMs: 32000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                wrongOrderPenaltyMs: 2400,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
                showGhost: true,
            },
            checkpoints: AETHERION_CHECKPOINTS,
            finish: { id: 'FINISH', type: 'finish', pos: [0, 158, 0], radius: 7.4, forward: [-0.7, 0, 0.7] },
        },
    },
};
