import { skyLadderRules } from './SkyLadderShared.js';

// Himmelsleiter II: Uhrwerkschacht — a tall vertical shaft inside a giant
// clockwork tower. The route spirals up around a central axle past gear
// hubs, a pendulum slalom, piston-plate portholes and a chain-guided boost
// run, then bursts out through the clock face at the top. After the first
// gear the route forks: the hollow axle (fast, narrow) or the outer gear
// rim (safe, wider) — both rejoin before the pendulum zone. A rescue portal
// under the branch catches a fall and returns the ship to the merge point;
// it is never the only way through — the spiral itself always works with
// portals disabled. The exit portal waits on the dial, ready for Stage III.

// Deterministic gear-tooth ring generator: places `count` small boxes evenly
// around a circle at `radius`/`y`, each rotated to face outward.
function gearTeeth(count, radius, y, toothSize, opts = {}) {
    const cx = opts.cx || 0;
    const cz = opts.cz || 0;
    const startAngle = opts.startAngle || 0;
    const teeth = [];
    for (let i = 0; i < count; i += 1) {
        const angle = startAngle + (i * (Math.PI * 2)) / count;
        const x = Math.round((cx + radius * Math.cos(angle)) * 100) / 100;
        const z = Math.round((cz + radius * Math.sin(angle)) * 100) / 100;
        teeth.push({ pos: [x, y, z], size: toothSize, rotateY: Math.round(angle * 1000) / 1000 });
    }
    return teeth;
}

export const SKY_LADDER_FOUNDRY_MAP = {
    name: 'Himmelsleiter II: Uhrwerkschacht',
    size: [110, 220, 110],
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    itemSpawnMode: 'anchor-only',
    itemRespawnSeconds: 30,
    itemRespawnOnDeath: true,
    // Above the dial's centre hole: finish below the face, exit just over it.
    fivePortalsExit: { pos: [0, 210, 0], color: 0xffcc44 },
    portalLevels: [20, 60, 100, 140, 180],
    obstacles: [
        // Foundation gear pit: landing pad and the first gear's hub disc.
        { pos: [0, 8, 0], size: [60, 4, 60], kind: 'foam' },
        { pos: [0, 18, 0], size: [70, 6, 70], tunnel: { radius: 9, axis: 'y' } },
        ...gearTeeth(12, 32, 18, [5, 9, 3]),
        // Branch: hollow axle (inner, narrow) and outer gear rim (safe, wider).
        // Thin collar so the diagonal approach into the hole never clips the rim.
        { pos: [0, 55, 0], size: [18, 2, 18], tunnel: { radius: 6, axis: 'y' } },
        { pos: [18, 60, -24], size: [30, 6, 30], tunnel: { radius: 7, axis: 'y' } },
        ...gearTeeth(10, 12, 60, [4, 6, 3], { cx: 18, cz: -24 }),
        // Escapement safety net below the branch, feeding the rescue portal.
        { pos: [0, 40, 0], size: [50, 4, 50], kind: 'foam' },
        // Pendulum arms swing in the opposite quadrant from the flight line —
        // decoration and silhouette, never crossing the route.
        { shape: 'tube', kind: 'hard', start: [20, 80, -35], end: [45, 92, -5], radius: 5 },
        { shape: 'tube', kind: 'hard', start: [38, 95, 15], end: [15, 108, 35], radius: 5 },
        { pos: [-23, 94, 1], size: [3, 4, 3] },
        { pos: [-33, 94, 9], size: [3, 4, 3] },
        // Piston plates: two porthole discs the ship threads on the way up.
        // Thin so the steep diagonal approach stays inside the porthole.
        { pos: [-10, 111, 26], size: [26, 3, 26], tunnel: { radius: 6, axis: 'y' } },
        { pos: [14, 124, 22], size: [26, 3, 26], tunnel: { radius: 6, axis: 'y' } },
        // Spring coil below the launch gate, offset off the flight line.
        { pos: [34, 133, 0], size: [6, 5, 6] },
        // Chain rails along the outer wall, guiding the boost run visually.
        { shape: 'tube', kind: 'hard', start: [45, 140, -10], end: [45, 160, -10], radius: 2 },
        { shape: 'tube', kind: 'hard', start: [-45, 150, 20], end: [-45, 170, 20], radius: 2 },
        // Shaft corner pillars, well outside the flight radius.
        { pos: [48, 105, 48], size: [4, 210, 4] },
        { pos: [-48, 105, 48], size: [4, 210, 4] },
        { pos: [48, 105, -48], size: [4, 210, 4] },
        { pos: [-48, 105, -48], size: [4, 210, 4] },
        // Clock face at the top with a hole for the finish and hour-mark teeth.
        { pos: [0, 200, 0], size: [90, 6, 90], tunnel: { radius: 10, axis: 'y' } },
        ...gearTeeth(12, 40, 203, [5, 6, 3]),
    ],
    portals: [
        // Escapement rescue: catches a fall from the branch zone and returns
        // the ship to the merge checkpoint. Optional — the spiral itself
        // never requires it.
        { a: [0, 43, 0], b: [10, 78, -15], color: 0x4488ff },
    ],
    gates: [
        {
            id: 'clockshaft_boost_gears',
            type: 'boost',
            pos: [26, 34, 17],
            forward: [0.3, 0.5, -0.8],
            params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.8 },
        },
        {
            id: 'clockshaft_spring_launch',
            type: 'boost',
            pos: [26, 138, 0],
            forward: [-0.5, 0.4, -0.7],
            params: { duration: 1.0, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 },
        },
        {
            id: 'clockshaft_chime_sling',
            type: 'slingshot',
            pos: [-16, 168, -16],
            forward: [0.2, 0.4, 0.9],
            up: [0, 1, 0],
            params: { duration: 1.4, forwardImpulse: 28, liftImpulse: 12, cooldown: 1.1 },
        },
    ],
    playerSpawn: { x: 0, y: 12, z: -14 },
    botSpawns: [
        { x: 8, y: 12, z: -14 },
        { x: -8, y: 12, z: -14 },
        { x: 0, y: 12, z: -22 },
    ],
    aircraft: [
        { id: 'clockshaft_drone', jetId: 'ship3', x: 34, y: 58, z: -10, scale: 0.5, rotateY: 1.2 },
    ],
    items: [
        { id: 'clockshaft_speed_gears', type: 'item_battery', pickupType: 'SPEED_UP', x: 18, y: 32, z: 10, weight: 1.2 },
        { id: 'clockshaft_shield_merge', type: 'item_shield', pickupType: 'SHIELD', x: 2, y: 74, z: -28, weight: 1.1 },
        { id: 'clockshaft_rocket_piston', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -10, y: 113, z: 22, weight: 0.8 },
        { id: 'clockshaft_speed_spring', type: 'item_battery', pickupType: 'SPEED_UP', x: 24, y: 140, z: 2, weight: 1.3 },
        { id: 'clockshaft_ghost_chime', type: 'item_coin', pickupType: 'GHOST', x: -14, y: 168, z: -16, weight: 0.9 },
        { id: 'clockshaft_shield_dial', type: 'item_shield', pickupType: 'SHIELD', x: 10, y: 192, z: 6, weight: 1.0 },
    ],
    missions: [
        { type: 'TIME_TRIAL', params: { target: 72 }, weight: 1.4 },
        { type: 'TRAIL_MASTER', params: { target: 160 }, weight: 0.8 },
    ],
    parcours: {
        enabled: true,
        routeId: 'sky_ladder_foundry_v1',
        rules: skyLadderRules({
            maxSegmentTimeMs: 20000,
            wrongOrderCooldownMs: 650,
            wrongOrderPenaltyMs: 2200,
            errorIndicatorMs: 1400,
        }),
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [0, 18, 0], radius: 7.0, forward: [0.8, 0.4, 0.5] },
            { id: 'CP02', type: 'gate', pos: [22, 30, 15], radius: 5.5, forward: [0.3, 0.5, -0.8] },
            {
                id: 'CP03',
                type: 'branch_entry',
                pos: [30, 46, -10],
                radius: 5.5,
                forward: [-0.6, 0.6, 0.1],
                nextIds: ['CP04_INNER', 'CP04_OUTER'],
            },
            {
                id: 'CP04_INNER',
                type: 'branch_precision',
                pos: [0, 55, 0],
                radius: 4.0,
                forward: [0, 0.5, -0.9],
                nextIds: ['CP05'],
            },
            {
                id: 'CP04_OUTER',
                type: 'branch_gate',
                pos: [18, 60, -24],
                radius: 6.0,
                forward: [-0.8, 0.5, -0.3],
                nextIds: ['CP05'],
            },
            { id: 'CP05', type: 'gate', pos: [0, 72, -30], radius: 5.5, forward: [-0.8, 0.5, 0.4] },
            { id: 'CP06', type: 'gate', pos: [-20, 85, -20], radius: 5.0, forward: [-0.3, 0.4, 0.8] },
            { id: 'CP07', type: 'precision', pos: [-28, 98, 5], radius: 5.0, forward: [0.6, 0.4, 0.7] },
            { id: 'CP08', type: 'tunnel', pos: [-10, 111, 26], radius: 5.0, forward: [0.9, 0.5, -0.1] },
            { id: 'CP09', type: 'tunnel', pos: [14, 124, 22], radius: 5.0, forward: [0.4, 0.5, -0.8] },
            { id: 'CP10', type: 'boost', pos: [26, 138, 0], radius: 5.5, forward: [-0.5, 0.4, -0.7] },
            { id: 'CP11', type: 'gate', pos: [10, 152, -24], radius: 5.5, forward: [-0.9, 0.5, 0.2] },
            { id: 'CP12', type: 'gate', pos: [-16, 166, -18], radius: 5.5, forward: [0.2, 0.4, 0.9] },
            { id: 'CP13', type: 'finish_pre', pos: [-10, 180, 10], radius: 5.5, forward: [0.8, 0.5, -0.3] },
            { id: 'CP14', type: 'precision', pos: [8, 190, 4], radius: 4.5, forward: [-0.8, 0.5, -0.4] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [0, 195, 0], radius: 7.0, forward: [0, 1, 0] },
    },
};
