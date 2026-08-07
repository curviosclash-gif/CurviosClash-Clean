function landmark(id, pack, model, position, targetSize, rotateY = 0) {
    return {
        id: `eclipse-foundry-${id}`,
        url: `assets/models/downloaded_cc0/${pack}/${model}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function animatedLandmark(id, file, position, targetSize, rotateY = 0) {
    return {
        id: `eclipse-foundry-${id}`,
        url: `assets/maps/chrono_forge/glb/${file}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

const ECLIPSE_FOUNDRY_LANDMARKS = [
    // Sector 1: orbital freight lock.
    landmark('arrival-station', 'pm-aero-system', 'Aero_Station_01_Art', [-194, 0, -45], 42, 0.45),
    animatedLandmark('arrival-crane', '01_hangar_crane', [-165, 11, 42], 30, 1.25),
    animatedLandmark('arrival-drones', '07_drone_swarm', [-142, 30, -28], 18, 0.4),
    landmark('freight-door', 'pm-aero-system', 'Aero_Door_01', [-126, 7, 0], 22, Math.PI / 2),

    // Sector 2: bifurcated furnace.
    animatedLandmark('furnace-core', '02_machine_core', [-92, 34, 0], 30, Math.PI / 2),
    landmark('furnace-column-blue', 'pm-chromatic-chaos', 'Column_Vapor_02', [-91, 5, -42], 34),
    landmark('furnace-column-orange', 'pm-chromatic-chaos', 'Column_Vapor_03', [-91, 5, 42], 34),
    animatedLandmark('furnace-gates', '05_temple_gates', [-61, 43, 0], 30, Math.PI / 2),

    // Sector 3: fractured lens climb.
    landmark('lens-arch', 'pm-crystal-crossroads', 'Arc', [-15, 48, -8], 30, Math.PI / 2),
    animatedLandmark('lens-shards', '03_crystal_shards', [18, 63, 4], 24, -0.4),
    landmark('lens-crystal', 'pm-crystal-crossroads', 'Crystal_ClusterSurrounded', [43, 58, 22], 26, 0.7),

    // Sector 4: twin-orbit refinery.
    animatedLandmark('orbit-clock', '04_chronometer', [68, 78, 0], 38),
    landmark('orbit-ring-blue', 'pm-aero-system', 'Aero_Station_PinkRing_Art', [78, 75, -43], 27, Math.PI / 2),
    landmark('orbit-ring-orange', 'pm-aero-system', 'Aero_Station_YellowRing_Art', [78, 84, 39], 25, Math.PI / 2),
    animatedLandmark('orbit-core', '08_time_core', [105, 72, 0], 32),

    // Sector 5: eclipse temple and upper shipyard.
    landmark('temple-dome', 'pm-abm', 'Dome04_Art', [146, 68, 18], 42, -0.6),
    animatedLandmark('temple-gates', '05_temple_gates', [151, 91, 52], 31),
    landmark('temple-altar', 'pm-abm', 'Altar01_Art', [130, 89, 90], 24, Math.PI),
    animatedLandmark('shipyard-airship', '06_airship', [91, 111, 109], 43, 2.5),
    animatedLandmark('shipyard-drones', '07_drone_swarm', [61, 117, 84], 20, -0.8),

    // Sector 6: inverted crown and final descent.
    landmark('crown-island-one', 'pm-aero-system', 'Floating_Island_01_Art', [26, 105, 91], 37, 0.4),
    landmark('crown-island-two', 'pm-aero-system', 'Floating_Island_01_Art', [-34, 96, 54], 33, -0.8),
    animatedLandmark('crown-shards', '03_crystal_shards', [-60, 89, 4], 22, 0.9),
    animatedLandmark('descent-clock', '04_chronometer', [-34, 70, -38], 30, Math.PI / 2),
    animatedLandmark('eclipse-heart', '08_time_core', [0, 43, -8], 48),
    landmark('finish-ring', 'pm-aero-system', 'Aero_Station_Ring_Art', [0, 61, -10], 26, Math.PI / 2),
];

const ECLIPSE_FOUNDRY_OBSTACLES = [
    // Sector 1: launch runway, crane slalom and a guarded lock.
    { pos: [-195, 8, 0], size: [34, 3, 52] },
    { pos: [-165, 10, 0], size: [28, 3, 34] },
    { pos: [-140, 12, 0], size: [22, 3, 30] },
    { pos: [-181, 17, -12], size: [7, 18, 7] },
    { pos: [-169, 17, 12], size: [7, 18, 7] },
    { pos: [-157, 17, -12], size: [7, 18, 7] },
    { pos: [-126, 18, 0], size: [10, 36, 56], tunnel: { radius: 6.2, axis: 'x' } },

    // Sector 2: a wide lower lane and a short elevated precision lane.
    { pos: [-113, 17, 0], size: [18, 3, 38] },
    { pos: [-99, 21, -29], size: [22, 3, 17] },
    { pos: [-80, 28, -29], size: [18, 3, 15] },
    { pos: [-64, 37, -20], size: [15, 3, 13] },
    { shape: 'tube', kind: 'hard', start: [-105, 19, 14], end: [-86, 35, 27], radius: 4.2 },
    { pos: [-78, 39, 27], size: [13, 3, 10] },
    { pos: [-62, 43, 13], size: [12, 3, 10] },
    { pos: [-52, 45, 0], size: [22, 4, 25] },
    { pos: [-84, 7, 0], size: [70, 3, 74], kind: 'foam' },
    { pos: [-91, 27, -48], size: [7, 54, 7] },
    { pos: [-91, 27, 48], size: [7, 54, 7] },

    // Sector 3: corkscrew ascent through a crystal iris.
    { shape: 'tube', kind: 'hard', start: [-43, 46, 0], end: [-24, 51, -15], radius: 5.0 },
    { pos: [-20, 51, -16], size: [18, 3, 16] },
    { pos: [-4, 55, -27], size: [14, 3, 12] },
    { pos: [10, 60, -18], size: [13, 3, 11] },
    { pos: [22, 64, 0], size: [14, 3, 12] },
    { pos: [35, 67, 18], size: [14, 3, 12] },
    { pos: [47, 68, 5], size: [17, 3, 16] },
    { shape: 'tube', kind: 'hard', start: [-18, 52, -13], end: [42, 68, 7], radius: 3.3 },
    { pos: [8, 28, 0], size: [106, 4, 82], kind: 'foam' },

    // Sector 4: two complete orbital lanes around the chronometer.
    { pos: [58, 71, 0], size: [19, 4, 22] },
    { pos: [68, 72, -30], size: [18, 3, 20] },
    { pos: [82, 74, -48], size: [18, 3, 16] },
    { pos: [99, 78, -35], size: [15, 3, 13] },
    { shape: 'tube', kind: 'hard', start: [57, 70, -10], end: [98, 79, -31], radius: 4.5 },
    { pos: [67, 79, 25], size: [15, 3, 14] },
    { pos: [80, 85, 42], size: [13, 3, 12] },
    { pos: [96, 87, 29], size: [12, 3, 11] },
    { shape: 'tube', kind: 'hard', start: [57, 72, 10], end: [98, 87, 25], radius: 3.5 },
    { pos: [110, 84, 0], size: [22, 4, 24] },
    { pos: [80, 43, 0], size: [82, 4, 104], kind: 'foam' },

    // Sector 5: temple turn, portal balcony and technical high road.
    { shape: 'tube', kind: 'hard', start: [110, 84, 0], end: [143, 90, 28], radius: 5.2 },
    { pos: [148, 89, 32], size: [28, 4, 25] },
    { pos: [146, 92, 62], size: [24, 4, 24] },
    { pos: [126, 95, 84], size: [24, 4, 20] },
    { pos: [105, 98, 94], size: [20, 4, 18] },
    { pos: [85, 103, 78], size: [12, 3, 11] },
    { pos: [70, 108, 88], size: [11, 3, 10] },
    { pos: [61, 113, 108], size: [18, 4, 17] },
    { shape: 'tube', kind: 'hard', start: [100, 98, 96], end: [61, 113, 108], radius: 3.4 },
    { pos: [32, 112, 94], size: [30, 4, 28] },
    { shape: 'tube', kind: 'hard', start: [58, 113, 107], end: [35, 112, 96], radius: 5.0 },
    { pos: [105, 53, 84], size: [112, 4, 75], kind: 'foam' },

    // Sector 6: inverted crown and multi-stage descent to the heart.
    { pos: [4, 113, 74], size: [19, 3, 17] },
    { pos: [-18, 106, 66], size: [17, 3, 15] },
    { pos: [-39, 99, 49], size: [16, 3, 14] },
    { pos: [-58, 90, 22], size: [15, 3, 13] },
    { pos: [-65, 84, 0], size: [18, 4, 16] },
    { pos: [-53, 77, -23], size: [14, 3, 13] },
    { pos: [-35, 69, -38], size: [13, 3, 12] },
    { pos: [-14, 62, -28], size: [12, 3, 11] },
    { pos: [0, 57, -10], size: [24, 4, 20] },
    { shape: 'tube', kind: 'hard', start: [29, 112, 92], end: [3, 113, 75], radius: 4.8 },
    { shape: 'tube', kind: 'hard', start: [-40, 99, 48], end: [-63, 85, 3], radius: 4.2 },
    { shape: 'tube', kind: 'hard', start: [-63, 83, -3], end: [-36, 70, -36], radius: 3.8 },
    { pos: [0, 27, -8], size: [20, 54, 20] },
];

const ECLIPSE_FOUNDRY_PORTALS = [
    { a: [-102, 22, -29], b: [-78, 40, 27], color: 0x22aaff },
    { a: [80, 76, -47], b: [80, 87, 41], color: 0xff8811 },
    { a: [104, 101, 96], b: [61, 116, 108], color: 0xaa66ff },
    { a: [-58, 93, 22], b: [-34, 72, -38], color: 0x44ffbb },
];

const ECLIPSE_FOUNDRY_GATES = [
    { id: 'eclipse_launch_boost', type: 'boost', pos: [-190, 12, 0], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 42, bonusSpeed: 50, cooldown: 0.9 } },
    { id: 'eclipse_furnace_sling', type: 'slingshot', pos: [-112, 18, 10], forward: [0.72, 0.55, 0.42], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 31, liftImpulse: 13, cooldown: 1.2 } },
    { id: 'eclipse_lens_boost', type: 'boost', pos: [-20, 54, -16], forward: [0.85, 0.25, -0.4], params: { duration: 1.0, forwardImpulse: 37, bonusSpeed: 46, cooldown: 0.8 } },
    { id: 'eclipse_orbit_blue', type: 'boost', pos: [68, 75, -30], forward: [0.62, 0.1, -0.78], params: { duration: 0.9, forwardImpulse: 35, bonusSpeed: 44, cooldown: 0.7 } },
    { id: 'eclipse_orbit_orange', type: 'slingshot', pos: [67, 82, 25], forward: [0.62, 0.35, 0.68], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 32, liftImpulse: 11, cooldown: 1.0 } },
    { id: 'eclipse_temple_boost', type: 'boost', pos: [143, 92, 30], forward: [0.1, 0.15, 0.98], params: { duration: 0.9, forwardImpulse: 39, bonusSpeed: 48, cooldown: 0.8 } },
    { id: 'eclipse_shipyard_sling', type: 'slingshot', pos: [101, 100, 95], forward: [-0.75, 0.38, 0.38], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 33, liftImpulse: 14, cooldown: 1.1 } },
    { id: 'eclipse_crown_boost', type: 'boost', pos: [28, 115, 92], forward: [-0.82, -0.15, -0.46], params: { duration: 0.8, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.7 } },
    { id: 'eclipse_descent_boost', type: 'boost', pos: [-58, 91, 20], forward: [-0.18, -0.38, -0.9], params: { duration: 0.8, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.7 } },
];

const ECLIPSE_FOUNDRY_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-202, 12, 0], radius: 7.0, forward: [1, 0, 0] },
    { id: 'CP02', type: 'freight_lock', pos: [-146, 15, 0], radius: 6.3, forward: [1, 0.05, 0] },
    { id: 'CP03', type: 'branch_entry', pos: [-113, 20, 0], radius: 6.0, forward: [1, 0.1, 0], nextIds: ['CP04_SAFE', 'CP04_FAST'] },
    { id: 'CP04_SAFE', type: 'safe_blue', pos: [-81, 31, -29], radius: 5.5, forward: [0.9, 0.25, 0.2], nextIds: ['CP05'] },
    { id: 'CP04_FAST', type: 'fast_orange', pos: [-78, 42, 27], radius: 4.5, forward: [0.8, 0.2, -0.5], nextIds: ['CP05'] },
    { id: 'CP05', type: 'furnace_merge', pos: [-52, 48, 0], radius: 6.1, forward: [1, 0.15, -0.1] },
    { id: 'CP06', type: 'crystal_iris', pos: [22, 67, 0], radius: 5.8, forward: [0.8, 0.15, 0.45] },
    { id: 'CP07', type: 'branch_entry', pos: [50, 71, 5], radius: 5.8, forward: [1, 0.1, 0], nextIds: ['CP08_BLUE', 'CP08_ORANGE'] },
    { id: 'CP08_BLUE', type: 'orbit_blue', pos: [82, 78, -47], radius: 5.2, forward: [0.5, 0.1, -0.85], nextIds: ['CP09'] },
    { id: 'CP08_ORANGE', type: 'orbit_orange', pos: [80, 89, 41], radius: 4.6, forward: [0.7, 0.2, -0.6], nextIds: ['CP09'] },
    { id: 'CP09', type: 'orbit_merge', pos: [110, 87, 0], radius: 6.0, forward: [0.7, 0.1, 0.7] },
    { id: 'CP10', type: 'eclipse_temple', pos: [147, 94, 60], radius: 5.8, forward: [-0.2, 0.1, 1] },
    { id: 'CP11', type: 'branch_entry', pos: [105, 101, 94], radius: 5.7, forward: [-0.8, 0.2, 0.3], nextIds: ['CP12_PORTAL', 'CP12_TECH'] },
    { id: 'CP12_PORTAL', type: 'void_portal', pos: [61, 116, 108], radius: 5.0, forward: [-1, 0, -0.2], nextIds: ['CP13'] },
    { id: 'CP12_TECH', type: 'technical_high', pos: [70, 111, 88], radius: 4.3, forward: [-0.8, 0.25, 0.4], nextIds: ['CP13'] },
    { id: 'CP13', type: 'crown_merge', pos: [32, 116, 94], radius: 5.8, forward: [-0.9, 0, -0.4] },
    { id: 'CP14', type: 'inverted_crown', pos: [-39, 102, 49], radius: 5.3, forward: [-0.7, -0.25, -0.65] },
    { id: 'CP15', type: 'descent', pos: [-65, 87, 0], radius: 5.0, forward: [0.15, -0.35, -0.92] },
    { id: 'CP16', type: 'heart_approach', pos: [-35, 72, -38], radius: 4.7, forward: [0.8, -0.25, 0.45] },
];

export const ECLIPSE_FOUNDRY_MAP = {
    eclipse_foundry: {
        name: 'Eclipse Foundry',
        size: [440, 140, 300],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [18, 44, 68, 90, 114],
        obstacles: ECLIPSE_FOUNDRY_OBSTACLES,
        portals: ECLIPSE_FOUNDRY_PORTALS,
        gates: ECLIPSE_FOUNDRY_GATES,
        glbModels: ECLIPSE_FOUNDRY_LANDMARKS,
        // The animatedLandmark() setpieces collide via their animated mesh colliders; the
        // static CC0 landmarks stay on the authored box obstacles.
        glbColliderMode: 'dynamic',
        glbLoadConcurrency: 3,
        playerSpawn: { x: -210, y: 12, z: 0 },
        botSpawns: [
            { x: -210, y: 12, z: -13 },
            { x: -210, y: 12, z: 13 },
            { x: -196, y: 12, z: -20 },
            { x: -196, y: 12, z: 20 },
        ],
        items: [
            { id: 'eclipse_speed_launch', type: 'item_battery', pickupType: 'SPEED_UP', x: -168, y: 14, z: 0, weight: 1.3 },
            { id: 'eclipse_shield_safe', type: 'item_shield', pickupType: 'SHIELD', x: -91, y: 25, z: -29, weight: 1.2 },
            { id: 'eclipse_ghost_fast', type: 'item_coin', pickupType: 'GHOST', x: -78, y: 42, z: 27, weight: 0.8 },
            { id: 'eclipse_speed_lens', type: 'item_battery', pickupType: 'SPEED_UP', x: 9, y: 62, z: -18, weight: 1.1 },
            { id: 'eclipse_rare_lens', type: 'item_crystal', pickupType: 'SHIELD', x: 35, y: 70, z: 18, weight: 0.6 },
            { id: 'eclipse_rocket_blue', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 82, y: 78, z: -47, weight: 0.9 },
            { id: 'eclipse_thick_orange', type: 'item_coin', pickupType: 'THICK', x: 80, y: 89, z: 41, weight: 0.8 },
            { id: 'eclipse_speed_temple', type: 'item_battery', pickupType: 'SPEED_UP', x: 147, y: 95, z: 60, weight: 1.2 },
            { id: 'eclipse_shield_portal', type: 'item_shield', pickupType: 'SHIELD', x: 61, y: 116, z: 108, weight: 1.0 },
            { id: 'eclipse_ghost_tech', type: 'item_coin', pickupType: 'GHOST', x: 70, y: 111, z: 88, weight: 0.8 },
            { id: 'eclipse_rocket_crown', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: -39, y: 102, z: 49, weight: 0.7 },
            { id: 'eclipse_shield_descent', type: 'item_shield', pickupType: 'SHIELD', x: -53, y: 80, z: -23, weight: 0.9 },
        ],
        aircraft: [
            { id: 'eclipse_freighter', jetId: 'ship8', x: -155, y: 39, z: 55, scale: 1.2, rotateY: 0.4 },
            { id: 'eclipse_orbit_patrol', jetId: 'ship4', x: 72, y: 101, z: -67, scale: 0.9, rotateY: -1.2 },
            { id: 'eclipse_temple_guard', jetId: 'ship6', x: 165, y: 111, z: 76, scale: 1.0, rotateY: 2.4 },
            { id: 'eclipse_crown_scout', jetId: 'ship3', x: -24, y: 125, z: 70, scale: 0.75, rotateY: -0.6 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 275 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'eclipse_foundry_v1',
            rules: {
                ordered: true,
                bidirectionalCheckpoints: false,
                resetOnDeath: false,
                resetToLastValid: true,
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
            checkpoints: ECLIPSE_FOUNDRY_CHECKPOINTS,
            finish: { id: 'FINISH', type: 'finish', pos: [0, 61, -10], radius: 7.2, forward: [1, 0, 0] },
        },
    },
};
