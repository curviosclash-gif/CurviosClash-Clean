// Neon-Jahrmarkt: a night fair floating in the dark, flown as one parcours through ten animated
// rides. Everything moves on one three second "waltz" beat, and every setpiece states where in
// that beat it runs, so the rides form a rhythm a player can learn.
//
// The models come from scripts/generate_neon_carnival_assets.py. They are authored at map scale
// (one Blender unit is one authored unit, placed with scale 1) and centred on their own origin,
// so a ride is placed by naming the point on its flight line - the anchor below, in Blender
// coordinates - and where that point has to sit on the route. place() turns that into the slot
// position the loader expects. The contract test loads the placed models and checks that every
// anchor lands where the route says.
//
// The map runs glbColliderMode 'scene': the drawn geometry is the collision. The authored boxes
// below are marked compileWithGlb and only add a soft floor and the spawn deck.

const BEAT_SECONDS = 3;
const MODEL_ROOT = 'assets/maps/neon_carnival/glb/';

export const NEON_CARNIVAL_SETPIECES = Object.freeze({
    marquee: Object.freeze({ file: '01_marquee_arch', clip: 'MarqueeArchLoop', anchor: [0, 0, 14] }),
    clown: Object.freeze({ file: '02_clown_gate', clip: 'ClownGateLoop', anchor: [0, 0, 14] }),
    hammer: Object.freeze({ file: '03_hammer_strike', clip: 'HammerStrikeLoop', anchor: [0, 0, 12] }),
    ducks: Object.freeze({ file: '04_duck_gallery', clip: 'DuckGalleryLoop', anchor: [0, 0, 12] }),
    swing: Object.freeze({ file: '05_swing_ride', clip: 'SwingRideLoop', anchor: [-4, 0, 19] }),
    wheel: Object.freeze({ file: '06_ferris_wheel', clip: 'FerrisWheelLoop', anchor: [0, 0, 17] }),
    loop: Object.freeze({ file: '07_coaster_loop', clip: 'CoasterLoopLoop', anchor: [0, 0, 19] }),
    carousel: Object.freeze({ file: '08_horse_carousel', clip: 'HorseCarouselLoop', anchor: [8.75, 0, 6.8] }),
    tower: Object.freeze({ file: '09_drop_tower', clip: 'DropTowerLoop', anchor: [0, 0, 20] }),
    bigTop: Object.freeze({ file: '10_big_top', clip: 'BigTopLoop', anchor: [0, 0, 26] }),
});

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Places a ride so that its anchor lands on `at`, with the flight line through it running along
 * `heading` ([dx, dz] in world X/Z). The model's front (Blender -Y, three.js +Z) turns to face the
 * approaching player, which is the yaw that maps local +Z onto -heading.
 */
function place(id, kind, at, heading, phaseOffsetBeats = 0, extra = {}) {
    const spec = NEON_CARNIVAL_SETPIECES[kind];
    const yaw = Math.atan2(-heading[0], -heading[1]);
    // Blender (x, y, z) is three.js (x, z, -y) inside the model; the slot then turns it by yaw.
    const [bx, by, bz] = spec.anchor;
    const offsetX = bx * Math.cos(yaw) - by * Math.sin(yaw);
    const offsetZ = -bx * Math.sin(yaw) - by * Math.cos(yaw);
    return {
        id: `neon-carnival-${id}`,
        url: `${MODEL_ROOT}${spec.file}.glb`,
        position: [round(at[0] - offsetX), round(at[1] - bz), round(at[2] - offsetZ)],
        rotation: [0, round(yaw), 0],
        scale: 1,
        animationClock: { clipName: spec.clip, phaseOffsetBeats },
        ...extra,
    };
}

const EAST = [1, 0];
const NORTH = [0, 1];
const WEST = [-1, 0];

// Where each ride's flight line sits on the route, in authored units.
export const NEON_CARNIVAL_ROUTE_ANCHORS = Object.freeze({
    marquee: [-194, 18, -90],
    clown: [-172, 18, -90],
    hammerOne: [-148, 18, -90],
    hammerTwo: [-133, 18, -90],
    hammerThree: [-118, 18, -90],
    ducks: [-66, 14, -114],
    swing: [-66, 30, -66],
    wheel: [0, 26, -90],
    loop: [50, 30, -90],
    carousel: [96, 32, -14],
    tower: [56, 38, 60],
    bigTop: [-10, 28, 60],
});

const A = NEON_CARNIVAL_ROUTE_ANCHORS;

const NEON_CARNIVAL_MODELS = [
    // Sector 1, the midway: under the marquee, through the clown's mouth, then three hammers.
    place('marquee', 'marquee', A.marquee, EAST),
    place('clown', 'clown', A.clown, EAST),
    // Fifteen authored units are 45 world units, one second at base speed, a third of a beat.
    // Each hammer therefore runs a third of a beat *behind* the one before it: a player at base
    // speed meets every hammer at the same point of its swing, and one good entry carries through.
    place('hammer-one', 'hammer', A.hammerOne, EAST, 0),
    place('hammer-two', 'hammer', A.hammerTwo, EAST, 2 / 3),
    place('hammer-three', 'hammer', A.hammerThree, EAST, 1 / 3),

    // Sector 2: the low lane threads the shooting gallery, the high lane crosses the swing ride.
    place('ducks', 'ducks', A.ducks, EAST),
    place('swing', 'swing', A.swing, EAST, 0.5),

    // Sectors 3 and 4: through the lower half of the Ferris wheel, then the centre of the loop.
    place('wheel', 'wheel', A.wheel, EAST),
    place('loop', 'loop', A.loop, EAST),

    // Sector 5: flat through the horse carousel, or over its roof.
    place('carousel', 'carousel', A.carousel, NORTH),

    // Sector 6: past the drop tower and down through the big top's crown to the finish inside.
    place('tower', 'tower', A.tower, WEST, 0.25),
    place('big-top', 'bigTop', A.bigTop, WEST),

    // Two more rides on the skyline. They only glow: collision: false keeps them out of the race.
    place('skyline-wheel', 'wheel', [160, 36, 118], [0, -1], 0.5, { collision: false }),
    place('skyline-swing', 'swing', [-168, 24, 64], [0, -1], 0.75, { collision: false }),
];

const NEON_CARNIVAL_OBSTACLES = [
    { pos: [0, 1, 0], size: [480, 2, 300], kind: 'foam', compileWithGlb: true },
    { pos: [-222, 10, -90], size: [22, 3, 40], compileWithGlb: true },
];

// Rescue portals: each ground end sits under a sector, the high end beside the route before it,
// a little off the racing line so nobody drops into one by accident.
const NEON_CARNIVAL_PORTALS = [
    { a: [-150, 8, -62], b: [-104, 24, -76], color: 0xff2d95 },
    { a: [-10, 8, -62], b: [-28, 30, -76], color: 0x2fd8ff },
    { a: [80, 8, -20], b: [84, 38, -60], color: 0xffc21a },
    { a: [40, 8, 92], b: [84, 48, 40], color: 0x9b4dff },
];

const NEON_CARNIVAL_GATES = [
    { id: 'carnival_launch_boost', type: 'boost', pos: [-206, 18, -90], forward: [1, 0, 0], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.9 } },
    { id: 'carnival_ride_sling', type: 'slingshot', pos: [-96, 20, -82], forward: [0.8, 0.45, 0.4], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 30, liftImpulse: 12, cooldown: 1.1 } },
    { id: 'carnival_wheel_boost', type: 'boost', pos: [-18, 23, -90], forward: [1, 0.1, 0], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.8 } },
    { id: 'carnival_loop_boost', type: 'boost', pos: [30, 29, -90], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
    { id: 'carnival_roof_sling', type: 'slingshot', pos: [88, 34, -40], forward: [0.15, 0.65, 0.75], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 30, liftImpulse: 14, cooldown: 1.1 } },
    { id: 'carnival_tower_boost', type: 'boost', pos: [74, 40, 56], forward: [-0.95, 0, 0.3], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.8 } },
    { id: 'carnival_dive_boost', type: 'boost', pos: [-10, 42, 60], forward: [0, -1, 0], params: { duration: 0.8, forwardImpulse: 30, bonusSpeed: 36, cooldown: 0.9 } },
];

const NEON_CARNIVAL_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-212, 18, -90], radius: 7.0, forward: [1, 0, 0] },
    { id: 'CP02', type: 'clown_mouth', pos: [-160, 18, -90], radius: 5.5, forward: [1, 0, 0] },
    { id: 'CP03', type: 'branch_entry', pos: [-104, 18, -90], radius: 6.0, forward: [1, 0, 0], nextIds: ['CP04_DUCKS', 'CP04_SWING'] },
    { id: 'CP04_DUCKS', type: 'gallery_low', pos: [-54, 14, -114], radius: 4.5, forward: [1, 0, 0], nextIds: ['CP05'] },
    { id: 'CP04_SWING', type: 'swing_high', pos: [-48, 30, -66], radius: 5.5, forward: [1, 0, 0], nextIds: ['CP05'] },
    { id: 'CP05', type: 'midway_merge', pos: [-28, 22, -90], radius: 6.0, forward: [1, 0.1, 0] },
    { id: 'CP06', type: 'ferris_wheel', pos: [14, 27, -90], radius: 5.5, forward: [1, 0, 0] },
    // Inside the loop: the train hangs on the inside of the rails but never comes closer to the
    // centre than eleven units, so this ring is always clear.
    { id: 'CP07', type: 'coaster_loop', pos: [50, 30, -90], radius: 6.0, forward: [1, 0, 0] },
    { id: 'CP08', type: 'branch_entry', pos: [96, 32, -48], radius: 6.0, forward: [0.6, 0, 0.8], nextIds: ['CP09_RIDE', 'CP09_ROOF'] },
    { id: 'CP09_RIDE', type: 'carousel_ride', pos: [96, 32, 8], radius: 4.4, forward: [0, 0, 1], nextIds: ['CP10'] },
    { id: 'CP09_ROOF', type: 'carousel_roof', pos: [96, 54, -14], radius: 5.0, forward: [0, 0.2, 1], nextIds: ['CP10'] },
    { id: 'CP10', type: 'tower_approach', pos: [84, 40, 52], radius: 6.0, forward: [-0.8, 0, 0.6] },
    { id: 'CP11', type: 'drop_tower', pos: [44, 38, 60], radius: 5.5, forward: [-1, 0, 0] },
];

export const NEON_CARNIVAL_MAP = {
    neon_carnival: {
        name: 'Neon-Jahrmarkt',
        size: [480, 140, 300],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [8, 18, 30, 40, 54],
        // A fair at night: the rides are the light. The sky stays dark violet, and the key light is
        // cool and low so the neon reads as the brightest thing on screen.
        lighting: {
            key: { direction: [20, 50, 25], color: 0xc4b8ff, intensity: 1.0 },
            fill: { direction: [-25, 20, -15], color: 0xff4fa8, intensity: 0.5 },
            rim: { direction: [-30, 14, -45], color: 0x35e0ff, intensity: 0.9 },
            hemisphere: { skyColor: 0x3a2c6a, groundColor: 0x1a0b24 },
            fog: {
                color: 0x140a28, near: 60, far: 240, height: 20, heightFalloff: 0.012, turbulence: 0.15,
                skyBlend: 1, colorHigh: 0x0d0820, colorLow: 0x1c0d2e, clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0x03020c, horizonColor: 0x2c1250, nadirColor: 0x07040f },
            starsVisible: true,
            exposureOffset: -0.1,
        },
        obstacles: NEON_CARNIVAL_OBSTACLES,
        portals: NEON_CARNIVAL_PORTALS,
        gates: NEON_CARNIVAL_GATES,
        glbModels: NEON_CARNIVAL_MODELS,
        glbAnimationClock: { beatSeconds: BEAT_SECONDS },
        glbColliderMode: 'scene',
        glbLoadConcurrency: 3,
        playerSpawn: { x: -226, y: 18, z: -90 },
        botSpawns: [
            { x: -226, y: 18, z: -102 },
            { x: -226, y: 18, z: -78 },
            { x: -216, y: 18, z: -106 },
            { x: -216, y: 18, z: -74 },
        ],
        items: [
            { id: 'carnival_speed_gate', type: 'item_battery', pickupType: 'SPEED_UP', x: -184, y: 18, z: -90, weight: 1.2 },
            { id: 'carnival_shield_hammers', type: 'item_shield', pickupType: 'SHIELD', x: -110, y: 22, z: -90, weight: 1.1 },
            { id: 'carnival_ghost_gallery', type: 'item_coin', pickupType: 'GHOST', x: -48, y: 14, z: -114, weight: 0.8 },
            { id: 'carnival_speed_swing', type: 'item_battery', pickupType: 'SPEED_UP', x: -42, y: 30, z: -66, weight: 1.0 },
            { id: 'carnival_rocket_wheel', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 22, y: 28, z: -90, weight: 0.9 },
            { id: 'carnival_shield_loop', type: 'item_shield', pickupType: 'SHIELD', x: 64, y: 30, z: -90, weight: 1.0 },
            { id: 'carnival_thick_ride', type: 'item_coin', pickupType: 'THICK', x: 96, y: 32, z: 16, weight: 0.8 },
            { id: 'carnival_rare_roof', type: 'item_crystal', pickupType: 'SHIELD', x: 96, y: 56, z: -4, weight: 0.6 },
            { id: 'carnival_speed_tower', type: 'item_battery', pickupType: 'SPEED_UP', x: 36, y: 38, z: 60, weight: 1.1 },
            { id: 'carnival_rocket_finale', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 20, y: 44, z: 60, weight: 0.7 },
        ],
        aircraft: [
            { id: 'carnival_blimp_scout', jetId: 'ship8', x: -120, y: 70, z: 40, scale: 1.2, rotateY: 0.6 },
            { id: 'carnival_midway_patrol', jetId: 'ship4', x: 20, y: 80, z: -140, scale: 0.9, rotateY: -1.4 },
            { id: 'carnival_finale_guard', jetId: 'ship6', x: -60, y: 76, z: 110, scale: 1.0, rotateY: 2.2 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 210 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'neon_carnival_v1',
            rules: {
                ordered: true,
                bidirectionalCheckpoints: false,
                resetOnDeath: false,
                resetToLastValid: true,
                respawnOnDeath: true,
                lastCheckpointRespawns: 3,
                respawnDelaySeconds: 3,
                maxSegmentTimeMs: 30000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                wrongOrderPenaltyMs: 2400,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
                showGhost: true,
            },
            checkpoints: NEON_CARNIVAL_CHECKPOINTS,
            // Inside the big top, flat under the crown: the way in is the dive through the petals.
            finish: { id: 'FINISH', type: 'finish', pos: [-10, 18, 60], radius: 6.5, forward: [0, -1, 0] },
        },
    },
};
