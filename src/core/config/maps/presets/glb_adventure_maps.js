function glbModel(pack, name, position, targetSize, rotateY = 0, placementId = '') {
    return Object.freeze({
        id: `${pack}/${name}${placementId ? `#${placementId}` : ''}`,
        url: `assets/models/downloaded_cc0/${pack}/${name}.glb`,
        position: Object.freeze(position),
        rotation: Object.freeze([0, rotateY, 0]),
        targetSize,
    });
}

const RIFT_BAZAAR_MODELS = Object.freeze([
    glbModel('pm-crystal-crossroads', 'Crystal_Base', [0, 0, 0], 24),
    glbModel('pm-crystal-crossroads', 'Crystal_Cluster', [0, 4, 0], 18, 0.35),
    glbModel('pm-aero-system', 'Aero_Station_Ring_Art', [0, 20, 0], 28),

    glbModel('pm-chromatic-chaos', 'Building_Vapor_Ramp_01', [-48, 0, -48], 30, 0.5),
    glbModel('pm-chromatic-chaos', 'Building_Rect_01', [-25, 0, -52], 25, -0.2),
    glbModel('pm-chromatic-chaos', 'Computer_Retro', [-46, 8, -27], 8, 0.7),
    glbModel('pm-chromatic-chaos', 'David_Retro', [-27, 8, -29], 10, -0.6),

    glbModel('pm-lunar-year', 'ArchBanner', [48, 0, -42], 26, -Math.PI / 2),
    glbModel('pm-lunar-year', 'BellStructure', [43, 0, -57], 27, 0.2),
    glbModel('pm-lunar-year', 'Dragon', [58, 18, -26], 24, 2.4),
    glbModel('pm-lunar-year', 'Column', [26, 0, -55], 17),

    glbModel('pm-medieval-fair', 'CenterPlatform', [42, 0, 48], 30),
    glbModel('pm-medieval-fair', 'Booth_Food01', [18, 0, 54], 18, Math.PI),
    glbModel('pm-medieval-fair', 'Booth_Wearables', [58, 0, 52], 18, Math.PI),
    glbModel('pm-medieval-fair', 'Cart', [42, 0, 27], 13, -0.5),

    glbModel('pm-aero-system', 'Aero_Station_01_Art', [-49, 0, 43], 34, 0.3),
    glbModel('pm-aero-system', 'Aero_Station_Mini_Platform_Art', [-25, 0, 56], 22),
    glbModel('pm-aero-system', 'Aero_Airship_01', [-54, 22, 21], 29, 1.1),
    glbModel('pm-aero-system', 'Floating_Island_01_Art', [-64, 10, 57], 25, -0.4),
    glbModel('pm-aero-system', 'Aero_Lampost_01', [-29, 0, 29], 11),
]);

const RIFT_BAZAAR_OBSTACLES = Object.freeze([
    // Risky reactor in the center; four tunnel walls keep every cardinal lane readable.
    { pos: [0, 9, 0], size: [18, 18, 18] },
    { pos: [0, 14, -27], size: [46, 24, 6], compileWithGlb: true, tunnel: { radius: 5.5, axis: 'z' } },
    { pos: [0, 14, 27], size: [46, 24, 6], compileWithGlb: true, kind: 'foam', tunnel: { radius: 5.5, axis: 'z' } },
    { pos: [-27, 14, 0], size: [6, 24, 46], compileWithGlb: true, kind: 'foam', tunnel: { radius: 5.5, axis: 'x' } },
    { pos: [27, 14, 0], size: [6, 24, 46], compileWithGlb: true, tunnel: { radius: 5.5, axis: 'x' } },

    // Four districts use symmetric collision footprints although their art differs.
    { pos: [-47, 11, -48], size: [24, 22, 20] },
    { pos: [47, 11, -48], size: [24, 22, 20], kind: 'foam' },
    { pos: [47, 11, 48], size: [24, 22, 20] },
    { pos: [-47, 11, 48], size: [24, 22, 20], kind: 'foam' },
    { pos: [-25, 7, -52], size: [16, 14, 14], kind: 'foam' },
    { pos: [25, 7, -52], size: [16, 14, 14] },
    { pos: [25, 7, 52], size: [16, 14, 14], kind: 'foam' },
    { pos: [-25, 7, 52], size: [16, 14, 14] },

    // Elevated cross routes reward vertical movement without sealing the lower ring.
    { pos: [-42, 25, 0], size: [24, 4, 12], kind: 'foam' },
    { pos: [42, 25, 0], size: [24, 4, 12] },
    { pos: [0, 25, -42], size: [12, 4, 24] },
    { pos: [0, 25, 42], size: [12, 4, 24], kind: 'foam' },
    { shape: 'tube', kind: 'hard', start: [-54, 22, -12], end: [-34, 25, 8], radius: 4.6 },
    { shape: 'tube', kind: 'hard', start: [54, 22, 12], end: [34, 25, -8], radius: 4.6 },

    // Outer pylons break long sightlines while leaving a fast perimeter lane.
    { pos: [-62, 13, 0], size: [7, 26, 7] },
    { pos: [62, 13, 0], size: [7, 26, 7] },
    { pos: [0, 13, -62], size: [7, 26, 7], kind: 'foam' },
    { pos: [0, 13, 62], size: [7, 26, 7], kind: 'foam' },
]);

const AETHER_RELAY_MODELS = Object.freeze([
    glbModel('pm-aero-system', 'Aero_Station_Mini_Platform_Art', [-48, 0, -38], 23, 0.2),
    glbModel('pm-aero-system', 'Aero_Lampost_01', [-42, 0, -43], 10, 0, 'launch-left'),
    glbModel('pm-aero-system', 'Aero_Lampost_01', [-52, 0, -31], 10, Math.PI, 'launch-right'),

    glbModel('pm-crystal-crossroads', 'Arc', [-31, 0, -20], 22, 0.7),
    glbModel('pm-crystal-crossroads', 'Crystal_ClusterSurrounded', [-36, 0, -12], 14),
    glbModel('pm-crystal-crossroads', 'Crystal_Small_04', [-25, 0, -27], 10, 0.8),

    glbModel('pm-chromatic-chaos', 'Building_Vapor_Ramp_02', [-16, 0, -8], 25, -0.5),
    glbModel('pm-chromatic-chaos', 'Column_Vapor_02', [0, 0, 0], 18),
    glbModel('pm-aero-system', 'Floating_Island_01_Art', [13, 20, -17], 19, 0.4),
    glbModel('pm-aero-system', 'Aero_Airship_01', [12, 39, -20], 22, 2.1),

    glbModel('pm-lunar-year', 'ArchBanner', [28, 0, 3], 27, -Math.PI / 2),
    glbModel('pm-lunar-year', 'BellStructure', [41, 0, 23], 23, 0.4),
    glbModel('pm-lunar-year', 'Dragon', [29, 31, 9], 23, -2.2),
    glbModel('pm-lunar-year', 'ColumnBase', [30, 0, 35], 13),

    glbModel('pm-medieval-fair', 'Booth_Pretzelgame', [28, 0, 44], 17, -0.9),
    glbModel('pm-medieval-fair', 'Booth_Food02', [7, 0, 48], 17, -0.2),
    glbModel('pm-medieval-fair', 'CenterPlatform', [-36, 0, 25], 25, 0.2),
    glbModel('pm-medieval-fair', 'Balloon_Interactible_Red', [-43, 7, 32], 10),
    glbModel('pm-medieval-fair', 'Balloon_Interactible_Yellow', [-28, 7, 35], 10),
]);

const AETHER_RELAY_OBSTACLES = Object.freeze([
    // Launch dock and crystal canyon.
    { pos: [-48, 9, -38], size: [24, 3, 20], kind: 'foam' },
    { pos: [-36, 15, -28], size: [7, 24, 7] },
    { pos: [-26, 15, -13], size: [7, 24, 7], kind: 'foam' },
    { pos: [-34, 8, -12], size: [9, 16, 9] },
    { pos: [-25, 7, -27], size: [8, 14, 8], kind: 'foam' },

    // The first precision wall has one authored tunnel and a clear approach line.
    { pos: [-16, 20, -8], size: [8, 30, 30], compileWithGlb: true, tunnel: { radius: 5.0, axis: 'x' } },
    { pos: [0, 22, 0], size: [18, 3, 18], kind: 'foam' },

    // Branch A climbs over floating slabs; branch B threads a lower tube.
    { pos: [8, 29, -9], size: [14, 3, 12] },
    { pos: [13, 32, -17], size: [16, 3, 14], kind: 'foam' },
    { pos: [21, 30, -8], size: [10, 16, 5] },
    { shape: 'tube', kind: 'hard', compileWithGlb: true, start: [3, 21, 5], end: [15, 19, 18], radius: 4.5 },
    { pos: [15, 17, 18], size: [14, 3, 12], kind: 'foam' },

    // Both branches merge on the lunar gate before a descending chicane.
    { pos: [28, 24, 3], size: [19, 3, 20] },
    { pos: [36, 16, 15], size: [5, 26, 5] },
    { pos: [43, 16, 28], size: [5, 26, 5], kind: 'foam' },
    { pos: [28, 16, 40], size: [18, 3, 15], kind: 'foam' },
    { pos: [8, 13, 44], size: [17, 3, 15] },
    { pos: [-14, 11, 35], size: [17, 3, 15], kind: 'foam' },

    // Fairground finish island and guide pylons.
    { pos: [-36, 10, 25], size: [24, 4, 22], kind: 'foam' },
    { pos: [-45, 14, 10], size: [5, 28, 5] },
    { pos: [-23, 14, 22], size: [5, 28, 5] },
]);

export const GLB_ADVENTURE_MAPS = Object.freeze({
    rift_bazaar: Object.freeze({
        name: 'Rift-Bazaar',
        size: Object.freeze([150, 58, 150]),
        scaleAuthoredAnchors: true,
        glbModels: RIFT_BAZAAR_MODELS,
        glbLoadConcurrency: 3,
        glbColliderMode: 'mesh',
        preferAuthoredPortals: true,
        portalLevels: Object.freeze([12, 25, 38]),
        obstacles: RIFT_BAZAAR_OBSTACLES,
        portals: Object.freeze([
            { a: [-61, 12, -58], b: [61, 34, 58], color: 0x22ddff },
            { a: [61, 12, -58], b: [-61, 34, 58], color: 0xff66cc },
        ]),
        gates: Object.freeze([
            { id: 'bazaar_north_boost', type: 'boost', pos: [0, 12, -66], forward: [1, 0, 0], params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.9 } },
            { id: 'bazaar_east_boost', type: 'boost', pos: [66, 12, 0], forward: [0, 0, 1], params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.9 } },
            { id: 'bazaar_south_boost', type: 'boost', pos: [0, 12, 66], forward: [-1, 0, 0], params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.9 } },
            { id: 'bazaar_west_boost', type: 'boost', pos: [-66, 12, 0], forward: [0, 0, -1], params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.9 } },
            { id: 'bazaar_core_sling', type: 'slingshot', pos: [0, 12, -38], forward: [0, 0.35, 1], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 30, liftImpulse: 9, cooldown: 1.3 } },
        ]),
        playerSpawn: Object.freeze({ x: 65, y: 16, z: 65 }),
        botSpawns: Object.freeze([
            { x: -65, y: 16, z: -65 },
            { x: 45, y: 14, z: 62 },
            { x: -45, y: 14, z: -62 },
            { x: 45, y: 30, z: 45 },
        ]),
        items: Object.freeze([
            { id: 'bazaar_speed_tech', type: 'item_battery', pickupType: 'SPEED_UP', x: -34, y: 16, z: -34, weight: 1.3 },
            { id: 'bazaar_shield_lunar', type: 'item_shield', pickupType: 'SHIELD', x: 34, y: 16, z: -34, weight: 1.0 },
            { id: 'bazaar_rocket_fair', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 34, y: 16, z: 34, weight: 0.9 },
            { id: 'bazaar_ghost_dock', type: 'item_coin', pickupType: 'GHOST', x: -34, y: 16, z: 34, weight: 0.8 },
            { id: 'bazaar_core_reward', type: 'item_crystal', pickupType: 'SHIELD', x: 0, y: 31, z: 0, weight: 1.2 },
        ]),
        missions: Object.freeze([
            { type: 'KILL_COUNT', params: { target: 5 }, weight: 1.4 },
            { type: 'SURVIVE_DURATION', params: { target: 50 }, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 3 }, weight: 0.8 },
        ]),
    }),

    aether_relay: Object.freeze({
        name: 'Aether-Relay',
        size: Object.freeze([120, 55, 110]),
        scaleAuthoredAnchors: true,
        glbModels: AETHER_RELAY_MODELS,
        glbLoadConcurrency: 3,
        glbColliderMode: 'mesh',
        preferAuthoredPortals: true,
        portalLevels: Object.freeze([12, 22, 34]),
        obstacles: AETHER_RELAY_OBSTACLES,
        portals: Object.freeze([]),
        gates: Object.freeze([
            { id: 'relay_launch_boost', type: 'boost', pos: [-38, 16, -28], forward: [0.65, 0.35, 0.7], params: { duration: 1.1, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.8 } },
            { id: 'relay_branch_sling', type: 'slingshot', pos: [0, 24, 0], forward: [0.55, 0.45, -0.7], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 32, liftImpulse: 11, cooldown: 1.1 } },
            { id: 'relay_high_boost', type: 'boost', pos: [13, 34, -17], forward: [0.55, -0.3, 0.75], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 44, cooldown: 0.8 } },
            { id: 'relay_merge_boost', type: 'boost', pos: [28, 28, 3], forward: [0.5, -0.2, 0.85], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 46, cooldown: 0.8 } },
            { id: 'relay_finish_boost', type: 'boost', pos: [-14, 13, 35], forward: [-0.9, -0.1, -0.4], params: { duration: 0.9, forwardImpulse: 32, bonusSpeed: 40, cooldown: 0.7 } },
        ]),
        playerSpawn: Object.freeze({ x: -52, y: 15, z: -18 }),
        botSpawns: Object.freeze([
            { x: -54, y: 12, z: -35 },
            { x: -47, y: 12, z: -46 },
            { x: -58, y: 12, z: -42 },
        ]),
        items: Object.freeze([
            { id: 'relay_speed_canyon', type: 'item_battery', pickupType: 'SPEED_UP', x: -31, y: 20, z: -20, weight: 1.3 },
            { id: 'relay_shield_low', type: 'item_shield', pickupType: 'SHIELD', x: 15, y: 20, z: 18, weight: 1.0 },
            { id: 'relay_ghost_merge', type: 'item_coin', pickupType: 'GHOST', x: 28, y: 28, z: 3, weight: 1.0 },
            { id: 'relay_speed_chicane', type: 'item_battery', pickupType: 'SPEED_UP', x: 28, y: 20, z: 40, weight: 1.2 },
            { id: 'relay_rocket_finish', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -14, y: 15, z: 35, weight: 0.8 },
        ]),
        missions: Object.freeze([
            { type: 'TIME_TRIAL', params: { target: 52 }, weight: 1.7 },
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 4 }, weight: 0.8 },
        ]),
        parcours: Object.freeze({
            enabled: true,
            routeId: 'aether_relay_v1',
            rules: Object.freeze({
                ordered: true,
                resetOnDeath: false,
                resetToLastValid: true,
                maxSegmentTimeMs: 13000,
                cooldownMs: 400,
                wrongOrderCooldownMs: 600,
                wrongOrderPenaltyMs: 2200,
                errorIndicatorMs: 1300,
                allowLaneAliases: true,
                bidirectionalCheckpoints: false,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
                showGhost: true,
            }),
            checkpoints: Object.freeze([
                { id: 'CP01', type: 'entry', pos: [-44, 12, -34], radius: 6.3, forward: [0.7, 0, -0.7] },
                { id: 'CP02', type: 'canyon', pos: [-31, 20, -20], radius: 5.3, forward: [0.7, 0.2, 0.7] },
                { id: 'CP03', type: 'tunnel', pos: [-16, 20, -8], radius: 4.8, forward: [0.8, 0.2, 0.6] },
                {
                    id: 'CP04',
                    type: 'branch_entry',
                    pos: [0, 24, 0],
                    radius: 5.2,
                    forward: [0.9, 0.2, 0.4],
                    nextIds: ['CP05A_HIGH', 'CP05B_LOW'],
                },
                {
                    id: 'CP05A_HIGH',
                    type: 'branch_high',
                    params: { label: 'Hoch: Luftinseln', height: 'high', color: 0xffbf45 },
                    pos: [13, 34, -17],
                    radius: 4.7,
                    forward: [0.55, 0.45, -0.7],
                    nextIds: ['CP06'],
                },
                {
                    id: 'CP05B_LOW',
                    type: 'branch_tube',
                    params: { label: 'Tief: Tunnel', height: 'low', color: 0x4da6ff },
                    pos: [19, 19, 23],
                    radius: 4.5,
                    forward: [0.6, -0.2, 0.75],
                    nextIds: ['CP06'],
                },
                { id: 'CP06', type: 'merge', pos: [28, 28, 3], radius: 5.2, forward: [1, 0, 0] },
                { id: 'CP07', type: 'chicane', pos: [39, 22, 22], radius: 4.7, forward: [0.5, -0.2, 0.85] },
                { id: 'CP08', type: 'descent', pos: [28, 18, 40], radius: 4.8, forward: [-0.5, -0.2, 0.85] },
                { id: 'CP09', type: 'market', pos: [8, 15, 44], radius: 4.9, forward: [-0.98, -0.1, 0.2] },
                { id: 'CP10', type: 'finish_pre', pos: [-14, 13, 35], radius: 5.1, forward: [-0.9, -0.1, -0.4] },
            ]),
            finish: Object.freeze({ id: 'FINISH', type: 'finish', pos: [-36, 12, 25], radius: 6.8, forward: [-0.9, -0.1, -0.4] }),
        }),
    }),
});
