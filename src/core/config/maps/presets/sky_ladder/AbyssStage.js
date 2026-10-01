import { skyLadderRules } from './SkyLadderShared.js';

// Himmelsleiter I: Tiefseeschlund — the entry stage of the portal chain that climbs from the
// sea floor to the stars. The route rises steadily from a trench at the sea bed, through a kelp
// forest slalom, a branch around a shipwreck (fast tunnel) or through more kelp (safe), a whale
// skeleton's rib arches, a rising bubble column, and out near the surface where the exit portal
// waits (activated once the finish is reached, see FivePortalsRuntime / PortalLayoutBuilder).
export const SKY_LADDER_ABYSS_MAP = {
    name: 'Himmelsleiter I: Tiefseeschlund',
    size: [280, 140, 100],
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    portalLevels: [20, 55, 95],
    itemSpawnMode: 'anchor-only',
    itemRespawnSeconds: 30,
    itemRespawnOnDeath: true,
    fivePortalsExit: { pos: [130, 114, 10], color: 0x66ffee },
    obstacles: [
        // Trench floor under the spawn point.
        { pos: [-84, 13, 0], size: [22, 4, 22], kind: 'foam' },

        // Kelp forest slalom (CP01 -> CP03): tall, thin foam stalks flanking the route.
        { pos: [-68, 24, -16], size: [3, 44, 3], kind: 'foam' },
        { pos: [-64, 26, 18], size: [3, 48, 3], kind: 'foam' },
        { pos: [-58, 28, -20], size: [3, 52, 3], kind: 'foam' },
        { pos: [-50, 30, 20], size: [3, 56, 3], kind: 'foam' },
        { pos: [-42, 31, -22], size: [3, 58, 3], kind: 'foam' },

        // Branch A: a porthole in the shipwreck hull (CP04_WRECK sits in the hole). The wall stays thin
        // because the line bends through it: a deep tunnel would force an S-curve inside the bore.
        { pos: [-14, 30, -22], size: [4, 26, 16], tunnel: { radius: 3.6, axis: 'x' } },
        { pos: [-24, 28, -30], size: [16, 20, 8], kind: 'hard' },
        { pos: [-4, 32, -34], size: [14, 18, 8], kind: 'hard' },

        // Branch B: more kelp, a wider and safer lane (CP04_KELP).
        { pos: [-24, 34, 28], size: [3, 50, 3], kind: 'foam' },
        { pos: [-10, 35, 22], size: [3, 52, 3], kind: 'foam' },
        { pos: [2, 36, 30], size: [3, 54, 3], kind: 'foam' },

        // Whale skeleton: two rib arches to fly through (CP06, CP08 — the second is tighter).
        { pos: [26, 38, 0], size: [10, 42, 34], tunnel: { radius: 5.5, axis: 'x' } },
        { pos: [60, 42, 0], size: [10, 40, 28], tunnel: { radius: 4.2, axis: 'x' } },

        // Bubble column: thin stalks marking the vertical shaft between CP09 and CP10.
        { pos: [68, 75, 4], size: [2, 40, 2], kind: 'foam' },
        { pos: [84, 75, 4], size: [2, 40, 2], kind: 'foam' },
        { pos: [76, 75, -4], size: [2, 40, 2], kind: 'foam' },
        { pos: [76, 75, 12], size: [2, 40, 2], kind: 'foam' },

        // Final gate before surfacing (CP12), a thin arch for the same reason as the porthole.
        { pos: [100, 98, -14], size: [3, 20, 26], tunnel: { radius: 4.4, axis: 'x' } },
    ],
    // Whirlpool shortcut: an optional current that sweeps a diver from the ribs straight up near
    // the surface, skipping the bubble column. The route stays fully flyable with portals off.
    portals: [
        { a: [50, 44, 18], b: [92, 94, 10], color: 0x2fd8ff },
    ],
    gates: [
        {
            id: 'sl_bubble_boost_low',
            type: 'boost',
            pos: [74, 48, 6],
            forward: [0.2, 1, 0.1],
            params: { duration: 1.0, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.9 },
        },
        {
            id: 'sl_bubble_boost_high',
            type: 'boost',
            pos: [78, 66, 4],
            forward: [0.1, 1, -0.1],
            params: { duration: 0.9, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.8 },
        },
    ],
    playerSpawn: { x: -84, y: 16, z: 0 },
    botSpawns: [
        { x: -84, y: 16, z: -8 },
        { x: -84, y: 16, z: 8 },
        { x: -80, y: 16, z: 0 },
    ],
    items: [
        { id: 'sl_speed_kelp', type: 'item_battery', pickupType: 'SPEED_UP', x: -54, y: 24, z: 6, weight: 1.2 },
        { id: 'sl_shield_branch', type: 'item_shield', pickupType: 'SHIELD', x: -36, y: 28, z: -6, weight: 1.1 },
        { id: 'sl_rocket_wreck', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -6, y: 31, z: -20, weight: 1.0 },
        { id: 'sl_ghost_ribs', type: 'item_coin', pickupType: 'GHOST', x: 44, y: 41, z: 2, weight: 0.9 },
        { id: 'sl_speed_bubble', type: 'item_battery', pickupType: 'SPEED_UP', x: 76, y: 70, z: 4, weight: 1.3 },
        { id: 'sl_shield_final', type: 'item_shield', pickupType: 'SHIELD', x: 106, y: 103, z: -9, weight: 1.0 },
    ],
    missions: [
        { type: 'TIME_TRIAL', params: { target: 65 }, weight: 1.6 },
        { type: 'TRAIL_MASTER', params: { target: 140 }, weight: 0.9 },
    ],
    parcours: {
        enabled: true,
        routeId: 'sky_ladder_abyss_v1',
        rules: skyLadderRules({
            maxSegmentTimeMs: 16000,
            cooldownMs: 420,
            wrongOrderCooldownMs: 600,
            wrongOrderPenaltyMs: 1800,
            errorIndicatorMs: 1200,
        }),
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [-72, 18, 0], radius: 7.0, forward: [1, 0.15, 0] },
            { id: 'CP02', type: 'gate', pos: [-54, 23, 6], radius: 6.0, forward: [1, 0.2, 0.3] },
            {
                id: 'CP03',
                type: 'branch_entry',
                pos: [-36, 27, -6],
                radius: 5.6,
                forward: [1, 0.2, -0.5],
                nextIds: ['CP04_WRECK', 'CP04_KELP'],
            },
            {
                id: 'CP04_WRECK',
                type: 'branch_precision',
                pos: [-14, 30, -22],
                radius: 4.2,
                forward: [1, 0.15, -0.6],
                nextIds: ['CP05'],
            },
            {
                id: 'CP04_KELP',
                type: 'branch_gate',
                pos: [-14, 32, 22],
                radius: 5.8,
                forward: [1, 0.15, 0.6],
                nextIds: ['CP05'],
            },
            { id: 'CP05', type: 'gate', pos: [6, 34, 0], radius: 5.4, forward: [1, 0.15, 0] },
            { id: 'CP06', type: 'tunnel', pos: [26, 38, 0], radius: 5.5, forward: [1, 0.15, 0] },
            { id: 'CP07', type: 'gate', pos: [44, 40, 0], radius: 5.0, forward: [1, 0.1, 0.1] },
            { id: 'CP08', type: 'precision', pos: [60, 42, 0], radius: 4.2, forward: [1, 0.15, 0] },
            { id: 'CP09', type: 'gate', pos: [74, 50, 6], radius: 5.5, forward: [0.4, 1, 0.2] },
            { id: 'CP10', type: 'gate', pos: [78, 82, 2], radius: 5.5, forward: [0.2, 1, -0.2] },
            { id: 'CP11', type: 'gate', pos: [90, 92, -6], radius: 5.2, forward: [0.8, 0.4, -0.6] },
            { id: 'CP12', type: 'tunnel', pos: [100, 98, -14], radius: 4.6, forward: [0.8, 0.3, -0.5] },
            { id: 'CP13', type: 'finish_pre', pos: [108, 104, -8], radius: 5.4, forward: [0.7, 0.5, 0.5] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [114, 108, -2], radius: 7.0, forward: [0.6, 0.5, 0.6] },
    },
};
