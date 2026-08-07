function landmark(id, pack, model, position, targetSize, rotateY = 0) {
    return {
        id: `chrono-forge-${id}`,
        url: `assets/models/downloaded_cc0/${pack}/${model}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function animatedLandmark(id, file, position, targetSize, rotateY = 0) {
    return {
        id: `chrono-forge-${id}`,
        url: `assets/maps/chrono_forge/glb/${file}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

const CHRONO_FORGE_LANDMARKS = [
    // Zone 1: arrival dock
    landmark('dock-station', 'pm-aero-system', 'Aero_Station_01_Art', [-164, 0, -38], 38, 0.4),
    animatedLandmark('dock-crane', '01_hangar_crane', [-132, 8, 42], 28, 1.2),
    landmark('dock-door', 'pm-aero-system', 'Aero_Door_01', [-101, 0, 0], 20, Math.PI / 2),

    // Zone 2: machine cathedral
    landmark('machine-ring-low', 'pm-aero-system', 'Aero_Station_YellowRing_Art', [-58, 24, 0], 28),
    animatedLandmark('machine-core', '02_machine_core', [-38, 40, 0], 24, Math.PI / 2),
    landmark('machine-column-left', 'pm-chromatic-chaos', 'Column_Vapor_02', [-72, 0, -42], 30),
    landmark('machine-column-right', 'pm-chromatic-chaos', 'Column_Vapor_03', [-72, 0, 42], 30),

    // Zone 3: crystal rift
    landmark('rift-arch', 'pm-crystal-crossroads', 'Arc', [13, 38, -8], 28, Math.PI / 2),
    landmark('rift-cluster', 'pm-crystal-crossroads', 'Crystal_ClusterSurrounded', [42, 28, 9], 24, 0.6),
    animatedLandmark('rift-shards', '03_crystal_shards', [68, 42, 52], 20, -0.5),

    // Zone 4: reversal temple
    animatedLandmark('temple-gates', '05_temple_gates', [83, 45, 54], 32, Math.PI / 2),
    animatedLandmark('temple-chronometer', '04_chronometer', [104, 65, 78], 34),
    landmark('temple-clock-inner', 'pm-aero-system', 'Aero_Station_PinkRing_Art', [104, 65, 78], 22, Math.PI / 2),
    landmark('temple-door', 'pm-abm', 'EntranceDoor01_Art', [126, 63, 45], 22, -Math.PI / 2),

    // Zone 5: sky shipyard
    landmark('sky-island-one', 'pm-aero-system', 'Floating_Island_01_Art', [95, 77, 10], 36, 0.4),
    landmark('sky-island-two', 'pm-aero-system', 'Floating_Island_01_Art', [55, 89, -25], 34, -0.7),
    landmark('sky-island-three', 'pm-aero-system', 'Floating_Island_01_Art', [20, 95, -10], 30, 1.1),
    animatedLandmark('sky-airship', '06_airship', [58, 104, 35], 38, 2.4),
    animatedLandmark('sky-drones', '07_drone_swarm', [72, 98, 24], 18, -0.8),

    // Zone 6: time core
    animatedLandmark('time-core', '08_time_core', [0, 26, 0], 42),
    landmark('finish-ring', 'pm-aero-system', 'Aero_Station_Ring_Art', [0, 74, -20], 24, Math.PI / 2),
];

const CHRONO_FORGE_OBSTACLES = [
    // Zone 1: broad dock and container slalom.
    { pos: [-165, 8, 0], size: [38, 3, 48] },
    { pos: [-134, 8, 0], size: [30, 3, 28] },
    { pos: [-108, 10, 0], size: [24, 3, 32] },
    { pos: [-148, 15, -9], size: [8, 14, 8] },
    { pos: [-136, 15, 9], size: [8, 14, 8] },
    { pos: [-124, 15, -9], size: [8, 14, 8] },

    // Zone 2: safe lower maintenance route and narrow upper bridge.
    { pos: [-90, 14, 0], size: [22, 3, 36] },
    { pos: [-70, 18, -26], size: [24, 3, 16] },
    { pos: [-48, 24, -26], size: [22, 3, 16] },
    { shape: 'tube', kind: 'hard', start: [-38, 25, -24], end: [-25, 40, 0], radius: 5.2 },
    { pos: [-67, 34, 18], size: [17, 3, 8] },
    { pos: [-48, 39, 18], size: [17, 3, 7] },
    { pos: [-25, 40, 0], size: [24, 4, 28] },
    { pos: [-82, 28, -45], size: [7, 56, 7] },
    { pos: [-82, 28, 45], size: [7, 56, 7] },
    { pos: [-55, 8, 0], size: [62, 3, 64], kind: 'foam' },

    // Zone 3: ascending canyon spiral, crystal tunnel and reward shortcut.
    { shape: 'tube', kind: 'hard', start: [-16, 42, 0], end: [5, 46, -8], radius: 5.4 },
    { pos: [7, 45, -8], size: [22, 3, 20] },
    { pos: [24, 48, -22], size: [20, 3, 16] },
    { pos: [42, 51, 0], size: [20, 3, 16] },
    { pos: [56, 54, 25], size: [18, 3, 16] },
    { pos: [70, 56, 45], size: [18, 3, 18] },
    { pos: [82, 58, 52], size: [24, 28, 24], tunnel: { radius: 5.4, axis: 'x' } },
    { shape: 'tube', kind: 'hard', start: [22, 50, -18], end: [72, 58, 42], radius: 3.4 },
    { pos: [42, 20, 12], size: [94, 4, 82], kind: 'foam' },
    { pos: [25, 42, -54], size: [7, 36, 7] },
    { pos: [54, 48, 67], size: [8, 42, 8] },

    // Zone 4: symmetric temple split; safe blue lane is wider, orange lane is shorter.
    { pos: [94, 58, 54], size: [25, 4, 24] },
    { pos: [84, 61, 84], size: [18, 4, 28] },
    { pos: [98, 65, 102], size: [24, 4, 18] },
    { pos: [115, 70, 76], size: [12, 3, 14] },
    { pos: [126, 76, 47], size: [26, 4, 25] },
    { shape: 'tube', kind: 'hard', start: [100, 65, 98], end: [126, 76, 47], radius: 5.0 },
    { shape: 'tube', kind: 'hard', start: [117, 71, 73], end: [126, 76, 47], radius: 3.8 },
    { pos: [105, 29, 76], size: [74, 4, 74], kind: 'foam' },
    { pos: [70, 55, 74], size: [7, 46, 7] },
    { pos: [137, 55, 74], size: [7, 46, 7] },

    // Zone 5: three main islands plus a small technical ascent.
    { shape: 'tube', kind: 'hard', start: [123, 78, 42], end: [96, 87, 10], radius: 5.0 },
    { pos: [95, 86, 10], size: [34, 4, 30] },
    { pos: [80, 92, -7], size: [11, 3, 11] },
    { pos: [68, 96, -19], size: [10, 3, 10] },
    { pos: [55, 98, -25], size: [30, 4, 28] },
    { shape: 'tube', kind: 'hard', start: [82, 88, 16], end: [58, 98, -20], radius: 5.5 },
    { pos: [20, 104, -10], size: [28, 4, 26] },
    { shape: 'tube', kind: 'hard', start: [48, 100, -24], end: [24, 104, -11], radius: 4.8 },
    { pos: [55, 39, -25], size: [54, 4, 54], kind: 'foam' },

    // Zone 6: descending spiral and short precision finale around the time core.
    { pos: [5, 98, 15], size: [16, 3, 15] },
    { pos: [-15, 91, 23], size: [14, 3, 14] },
    { pos: [-27, 83, 8], size: [12, 3, 12] },
    { pos: [-22, 76, -10], size: [10, 3, 10] },
    { pos: [-8, 71, -22], size: [9, 3, 9] },
    { pos: [0, 70, -20], size: [22, 4, 18] },
    { shape: 'tube', kind: 'hard', start: [18, 103, -6], end: [6, 98, 14], radius: 4.2 },
    { shape: 'tube', kind: 'hard', start: [4, 98, 15], end: [-15, 91, 23], radius: 4.0 },
    { shape: 'tube', kind: 'hard', start: [-15, 91, 23], end: [-27, 83, 8], radius: 3.8 },
    { pos: [0, 34, 0], size: [18, 68, 18] },
];

const CHRONO_FORGE_PORTALS = [
    { a: [-73, 20, -27], b: [-65, 37, 18], color: 0x22aaff },
    { a: [82, 63, 96], b: [116, 72, 71], color: 0xff8811 },
    { a: [55, 43, -25], b: [55, 102, -25], color: 0x55ddff },
];

const CHRONO_FORGE_GATES = [
    { id: 'chrono_dock_boost', type: 'boost', pos: [-153, 12, 0], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 } },
    { id: 'chrono_cathedral_sling', type: 'slingshot', pos: [-84, 17, 12], forward: [0.7, 0.55, 0.4], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 29, liftImpulse: 12, cooldown: 1.2 } },
    { id: 'chrono_rift_boost', type: 'boost', pos: [25, 51, -20], forward: [0.7, 0.1, 0.7], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
    { id: 'chrono_temple_boost', type: 'boost', pos: [116, 73, 70], forward: [0.25, 0.15, -0.95], params: { duration: 0.9, forwardImpulse: 38, bonusSpeed: 48, cooldown: 0.8 } },
    { id: 'chrono_shipyard_sling', type: 'slingshot', pos: [123, 80, 42], forward: [-0.7, 0.4, -0.6], up: [0, 1, 0], params: { duration: 1.7, forwardImpulse: 31, liftImpulse: 14, cooldown: 1.2 } },
    { id: 'chrono_core_boost_one', type: 'boost', pos: [6, 100, 14], forward: [-0.65, -0.25, 0.7], params: { duration: 0.8, forwardImpulse: 34, bonusSpeed: 43, cooldown: 0.7 } },
    { id: 'chrono_core_boost_two', type: 'boost', pos: [-24, 85, 9], forward: [0.15, -0.35, -0.92], params: { duration: 0.8, forwardImpulse: 32, bonusSpeed: 40, cooldown: 0.7 } },
];

const CHRONO_FORGE_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-170, 12, 0], radius: 6.8, forward: [1, 0, 0] },
    { id: 'CP02', type: 'boost', pos: [-126, 12, 0], radius: 6.2, forward: [1, 0, 0] },
    { id: 'CP03', type: 'branch_entry', pos: [-91, 17, 0], radius: 6.0, forward: [1, 0.1, 0], nextIds: ['CP04_SAFE', 'CP04_FAST'] },
    { id: 'CP04_SAFE', type: 'safe_blue', pos: [-50, 28, -26], radius: 5.4, forward: [0.8, 0.3, 0.5], nextIds: ['CP05'] },
    { id: 'CP04_FAST', type: 'fast_orange', pos: [-49, 42, 18], radius: 4.5, forward: [1, 0.2, -0.3], nextIds: ['CP05'] },
    { id: 'CP05', type: 'reactor', pos: [-25, 45, 0], radius: 6.0, forward: [1, 0.1, 0] },
    { id: 'CP06', type: 'rift', pos: [8, 49, -8], radius: 5.7, forward: [0.8, 0.1, -0.4] },
    { id: 'CP07', type: 'crystal_tunnel', pos: [72, 60, 45], radius: 5.2, forward: [0.9, 0.1, 0.2] },
    { id: 'CP08', type: 'branch_entry', pos: [94, 62, 54], radius: 5.8, forward: [0.1, 0.1, 1], nextIds: ['CP09_SAFE', 'CP09_FAST'] },
    { id: 'CP09_SAFE', type: 'safe_blue', pos: [98, 69, 99], radius: 5.4, forward: [0.1, 0.2, 1], nextIds: ['CP10'] },
    { id: 'CP09_FAST', type: 'fast_orange', pos: [116, 74, 76], radius: 4.6, forward: [0.7, 0.3, 0.7], nextIds: ['CP10'] },
    { id: 'CP10', type: 'merge', pos: [126, 80, 47], radius: 5.8, forward: [-0.6, 0.3, -0.7] },
    { id: 'CP11', type: 'sky_island', pos: [95, 91, 10], radius: 5.6, forward: [-0.7, 0.2, -0.7] },
    { id: 'CP12', type: 'shipyard', pos: [55, 103, -25], radius: 5.6, forward: [-0.9, 0.1, 0.3] },
    { id: 'CP13', type: 'time_core_entry', pos: [20, 109, -10], radius: 5.4, forward: [-0.5, -0.2, 0.8] },
    { id: 'CP14', type: 'precision', pos: [-16, 94, 23], radius: 4.5, forward: [-0.7, -0.3, -0.2] },
];

export const CHRONO_FORGE_NEXUS_MAP = {
    chrono_forge_nexus: {
        name: 'Chrono-Forge Nexus',
        size: [380, 120, 260],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [18, 42, 62, 82, 102],
        obstacles: CHRONO_FORGE_OBSTACLES,
        portals: CHRONO_FORGE_PORTALS,
        gates: CHRONO_FORGE_GATES,
        glbModels: CHRONO_FORGE_LANDMARKS,
        // Moving setpieces (gears, pistons, gates, drones) collide via their animated mesh
        // colliders; the static dressing stays on CHRONO_FORGE_OBSTACLES.
        glbColliderMode: 'dynamic',
        glbLoadConcurrency: 3,
        playerSpawn: { x: -178, y: 12, z: 0 },
        botSpawns: [
            { x: -178, y: 12, z: -12 },
            { x: -178, y: 12, z: 12 },
            { x: -166, y: 12, z: -18 },
            { x: -166, y: 12, z: 18 },
        ],
        items: [
            { id: 'chrono_speed_dock', type: 'item_battery', pickupType: 'SPEED_UP', x: -136, y: 12, z: 0, weight: 1.3 },
            { id: 'chrono_shield_safe', type: 'item_shield', pickupType: 'SHIELD', x: -58, y: 22, z: -26, weight: 1.2 },
            { id: 'chrono_ghost_fast', type: 'item_coin', pickupType: 'GHOST', x: -49, y: 44, z: 18, weight: 0.8 },
            { id: 'chrono_speed_rift', type: 'item_battery', pickupType: 'SPEED_UP', x: 42, y: 55, z: 0, weight: 1.1 },
            { id: 'chrono_rare_rift', type: 'item_crystal', pickupType: 'SHIELD', x: 50, y: 56, z: 15, weight: 0.6 },
            { id: 'chrono_rocket_temple', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 84, y: 65, z: 84, weight: 0.9 },
            { id: 'chrono_thick_fast', type: 'item_coin', pickupType: 'THICK', x: 116, y: 76, z: 76, weight: 0.8 },
            { id: 'chrono_speed_sky', type: 'item_battery', pickupType: 'SPEED_UP', x: 80, y: 95, z: -7, weight: 1.2 },
            { id: 'chrono_shield_airship', type: 'item_shield', pickupType: 'SHIELD', x: 55, y: 103, z: -25, weight: 1.0 },
            { id: 'chrono_rocket_core', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: -22, y: 86, z: 8, weight: 0.7 },
        ],
        aircraft: [
            { id: 'chrono_drone_one', jetId: 'ship3', x: -120, y: 32, z: -48, scale: 0.7, rotateY: 0.5 },
            { id: 'chrono_drone_two', jetId: 'ship6', x: 46, y: 76, z: 72, scale: 0.8, rotateY: -1.1 },
            { id: 'chrono_shipyard_patrol', jetId: 'ship1', x: 88, y: 108, z: 48, scale: 1.2, rotateY: 2.2 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 240 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.8 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 0.7 },
        ],
        parcours: {
            enabled: true,
            routeId: 'chrono_forge_nexus_v1',
            rules: {
                ordered: true,
                bidirectionalCheckpoints: false,
                resetOnDeath: false,
                resetToLastValid: true,
                maxSegmentTimeMs: 28000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                wrongOrderPenaltyMs: 2200,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
                showGhost: true,
            },
            checkpoints: CHRONO_FORGE_CHECKPOINTS,
            finish: { id: 'FINISH', type: 'finish', pos: [0, 74, -20], radius: 7.0, forward: [1, 0, 0] },
        },
    },
};
