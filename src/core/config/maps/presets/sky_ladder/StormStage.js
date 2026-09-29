import { skyLadderRules } from './SkyLadderShared.js';

// Himmelsleiter III: Sturmkrone — floating islands climbing through a wide
// thunderstorm sky. Two lanes after the junction island: a risky "eye" run
// threading tight between lightning-rod beams (boosted), and a safe "outer"
// run looping around the islands. Both merge before the wind-channel boost
// chain and the cloud wall, then thread the crown — a ring of tall pillars
// around the storm's eye — before the finish and the exit portal to Stage IV.
export const SKY_LADDER_STORM_MAP = {
    name: 'Himmelsleiter III: Sturmkrone',
    size: [360, 150, 220],
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    itemSpawnMode: 'anchor-only',
    itemRespawnSeconds: 30,
    itemRespawnOnDeath: true,
    fivePortalsExit: { pos: [162, 80, -12], color: 0xffcc44 },
    portalLevels: [30, 60, 90, 120],
    obstacles: [
        { pos: [-112, 23, 0], size: [30, 5, 30], kind: 'foam' },
        { pos: [-95, 25, 0], size: [22, 5, 22], kind: 'foam' },
        // Landing pad sits well below the CP01->CP02 approach line, not just below the ring.
        { pos: [-66, 25, -16], size: [24, 5, 24], kind: 'foam' },
        // Decorative lightning rod: offset well clear of CP02's ring on the x axis.
        { pos: [-78, 55, -16], size: [2, 50, 2] },
        // Cloud wall either side of the CP03 gap (z -4..22, 26 units wide).
        { pos: [-38, 44, -22], size: [8, 34, 36], kind: 'foam' },
        { pos: [-38, 44, 36], size: [8, 30, 28], kind: 'foam' },
        // Junction pad lowered so the CP03->CP04 approach clears its top.
        { pos: [-8, 40, 0], size: [26, 5, 26], kind: 'foam' },
        // Risky-lane beams flanking the eye corridor (z -18 and 6, ring at -6).
        { pos: [20, 68, -18], size: [2, 44, 2] },
        { pos: [20, 68, 6], size: [2, 44, 2] },
        // Outer-branch pad lowered so the CP04->CP05_OUTER approach clears its top.
        { pos: [18, 46, 34], size: [24, 5, 24], kind: 'foam' },
        // Merge pad lowered so both incoming branches clear its top.
        { pos: [48, 55, 12], size: [22, 5, 22], kind: 'foam' },
        // Wind-channel funnel walls (z -50..-30 and -10..10, ring at -20).
        { pos: [76, 74, -40], size: [6, 26, 20], kind: 'foam' },
        { pos: [76, 74, 0], size: [6, 26, 20], kind: 'foam' },
        { pos: [100, 80, 20], size: [16, 5, 16], kind: 'foam' },
        // Crown ring pillars: CP09/CP09_R thread the wide outer gap either side of pillar A/C.
        { pos: [122, 95, -30], size: [3, 70, 3] },
        { pos: [122, 95, 30], size: [3, 70, 3] },
        // Inner crown pillars: CP10 threads the eye-centre gap (24 wide).
        { pos: [110, 95, -12], size: [3, 60, 3] },
        { pos: [110, 95, 17], size: [3, 60, 3] },
        // Descent pad lowered so the CP11->CP12 approach clears its top.
        { pos: [130, 78, 0], size: [20, 5, 20], kind: 'foam' },
        // Finish pad lowered so the FINISH->EXIT approach clears its top.
        { pos: [150, 68, 0], size: [24, 5, 24], kind: 'foam' },
        // Deco storm clouds, far from every ring.
        { pos: [-50, 110, -80], size: [20, 6, 14], kind: 'foam' },
        { pos: [50, 120, 80], size: [18, 6, 12], kind: 'foam' },
    ],
    portals: [
        // "Blitzsprung": skips straight from the eye corridor to the merge island.
        { a: [24, 74, -6], b: [46, 72, 10], color: 0x8866ff },
    ],
    gates: [
        {
            id: 'sc_sling_ascent',
            type: 'slingshot',
            pos: [-8, 50, 0],
            forward: [1, 0.5, 0],
            up: [0, 1, 0],
            params: { duration: 1.5, forwardImpulse: 26, liftImpulse: 16, cooldown: 1.3 },
        },
        {
            id: 'sc_boost_eye_entry',
            type: 'boost',
            pos: [6, 58, -6],
            forward: [1, 0.25, -0.1],
            params: { duration: 1.0, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 },
        },
        {
            id: 'sc_boost_eye_mid',
            type: 'boost',
            pos: [20, 64, -6],
            forward: [1, 0.15, 0],
            params: { duration: 0.8, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.85 },
        },
        {
            id: 'sc_boost_wind1',
            type: 'boost',
            pos: [70, 74, -34],
            forward: [1, 0.1, 0.3],
            params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 40, cooldown: 0.85 },
        },
        {
            id: 'sc_boost_wind2',
            type: 'boost',
            pos: [82, 80, -6],
            forward: [1, 0.05, 0.35],
            params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 40, cooldown: 0.85 },
        },
        {
            id: 'sc_boost_crown',
            type: 'boost',
            pos: [116, 92, 0],
            forward: [1, 0, 0],
            params: { duration: 0.8, forwardImpulse: 32, bonusSpeed: 38, cooldown: 0.8 },
        },
    ],
    playerSpawn: { x: -112, y: 28, z: 0 },
    botSpawns: [
        { x: -112, y: 28, z: -10 },
        { x: -112, y: 28, z: 10 },
        { x: -100, y: 28, z: 0 },
    ],
    staticTurrets: [
        { id: 'sc_mg_windguard', weapon: 'mg', pos: [76, 90, -20], range: 38, cooldown: 1.6, damage: 2, phase: 0.5, destructible: true, maxHp: 55, allowedModes: ['HUNT', 'ARCADE'] },
        { id: 'sc_mg_crownguard', weapon: 'mg', pos: [100, 86, 20], range: 40, cooldown: 1.7, damage: 2, phase: 1.2, destructible: true, maxHp: 55, allowedModes: ['HUNT', 'ARCADE'] },
    ],
    items: [
        { id: 'sc_speed_ascent', type: 'item_battery', pickupType: 'SPEED_UP', x: -38, y: 50, z: 9, weight: 1.2 },
        { id: 'sc_shield_outer', type: 'item_shield', pickupType: 'SHIELD', x: 18, y: 58, z: 34, weight: 1.1 },
        { id: 'sc_rocket_eye', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 20, y: 66, z: -6, weight: 0.9 },
        { id: 'sc_speed_wind', type: 'item_battery', pickupType: 'SPEED_UP', x: 76, y: 80, z: -20, weight: 1.1 },
        { id: 'sc_shield_crown', type: 'item_shield', pickupType: 'SHIELD', x: 130, y: 88, z: 0, weight: 1.0 },
    ],
    missions: [
        { type: 'TIME_TRIAL', params: { target: 78 }, weight: 1.4 },
        { type: 'CLOSE_CALL', params: { target: 3 }, weight: 0.8 },
    ],
    parcours: {
        enabled: true,
        routeId: 'sky_ladder_storm_v1',
        rules: skyLadderRules({
            maxSegmentTimeMs: 16000,
            wrongOrderCooldownMs: 650,
            wrongOrderPenaltyMs: 2200,
            errorIndicatorMs: 1400,
        }),
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [-95, 30, 0], radius: 7.0, forward: [1, 0.1, 0] },
            { id: 'CP02', type: 'gate', pos: [-66, 38, -16], radius: 6.0, forward: [1, 0.2, -0.4] },
            { id: 'CP03', type: 'gate', pos: [-38, 46, 9], radius: 5.4, forward: [1, 0.2, 0.5] },
            {
                id: 'CP04',
                type: 'branch_entry',
                pos: [-8, 54, 0],
                radius: 5.6,
                forward: [1, 0.1, 0],
                nextIds: ['CP05_EYE', 'CP05_OUTER'],
            },
            {
                id: 'CP05_EYE',
                type: 'branch_precision',
                pos: [20, 64, -6],
                radius: 4.0,
                forward: [1, 0.15, 0],
                nextIds: ['CP06'],
            },
            {
                id: 'CP05_OUTER',
                type: 'branch_gate',
                pos: [18, 60, 34],
                radius: 6.2,
                forward: [1, 0.1, 0.4],
                nextIds: ['CP06'],
            },
            { id: 'CP06', type: 'gate', pos: [48, 70, 12], radius: 5.6, forward: [1, 0.15, -0.3] },
            { id: 'CP07', type: 'gate', pos: [76, 78, -20], radius: 5.4, forward: [1, 0.1, -0.5] },
            { id: 'CP08', type: 'gate', pos: [100, 84, 4], radius: 4.2, forward: [1, 0.1, 0.4] },
            { id: 'CP09', type: 'split', pos: [122, 90, -16], radius: 4.8, forward: [0.6, 0.1, -0.8] },
            { id: 'CP09_R', type: 'split', aliasOf: 'CP09', pos: [122, 90, 16], radius: 4.8, forward: [0.6, 0.1, 0.8] },
            { id: 'CP10', type: 'precision', pos: [110, 96, 0], radius: 4.2, forward: [1, 0.05, 0] },
            { id: 'CP11', type: 'gate', pos: [130, 90, 0], radius: 5.2, forward: [1, -0.05, 0] },
            { id: 'CP12', type: 'finish_pre', pos: [142, 86, 0], radius: 5.4, forward: [1, -0.1, 0] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [150, 84, 0], radius: 7.0, forward: [1, -0.1, 0] },
    },
};
