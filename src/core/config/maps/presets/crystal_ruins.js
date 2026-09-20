// ============================================
// Crystal Ruins - Wüsten-Arena mit Kristallen
// CC0-inspiriert von pm-crystal-crossroads Assets
// ============================================

import { mushroomPatch } from './glowing_mushrooms.js';

const CRYSTAL_RUINS_PROP_ROOT = 'assets/maps/crystal_ruins/props';
// The arena is 140 across, so nothing here is ever far enough away to be worth culling by
// distance; the value exists to keep the models out of a long view down a corridor.
const FUNGUS_RENDER_DISTANCE = 120;

function ruinProp(id, family, objectId, variant, position, targetSize, rotateY = 0) {
    const stem = `crystal-ruins-${objectId}-v${String(variant).padStart(2, '0')}`;
    return {
        id: `crystal-ruins-${id}`,
        url: `${CRYSTAL_RUINS_PROP_ROOT}/${family}/${stem}/runtime.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

const CRYSTAL_RUINS_PROP_MODELS = [
    // Four decorative arches sit inside the authored tunnel voids. Their `_nocol` masonry
    // makes each cardinal crossing readable without narrowing the existing flight corridor.
    ruinProp('north-gate-arch', 'broken-arches', 'broken-arch', 3, [0, 0, -40], 19),
    ruinProp('south-gate-arch', 'broken-arches', 'broken-arch', 6, [0, 0, 40], 18, Math.PI),
    ruinProp('east-gate-arch', 'broken-arches', 'broken-arch', 2, [40, 0, 0], 17, Math.PI / 2),
    ruinProp('west-gate-arch', 'broken-arches', 'broken-arch', 5, [-40, 0, 0], 18, -Math.PI / 2),

    // These two large arches and two massive columns are the only new static prop obstacles.
    // They live in corner ensembles, at least twenty units off the cardinal boost lanes.
    ruinProp('northwest-ensemble-arch', 'broken-arches', 'broken-arch', 1, [-50, 0, -24], 15, Math.PI / 4),
    ruinProp('southeast-ensemble-arch', 'broken-arches', 'broken-arch', 4, [50, 0, 24], 16, -3 * Math.PI / 4),
    ruinProp('northwest-marker-column', 'damaged-columns', 'damaged-column', 3, [-57, 0, -34], 12, 0.18),
    ruinProp('southeast-marker-column', 'damaged-columns', 'damaged-column', 7, [57, 0, 34], 11, -0.22),

    // Broken column rows lead the eye towards the wall crossings. These variants are purely
    // decorative, so neither a fallen drum nor a crystal spur can create collision.
    ruinProp('north-column-west', 'damaged-columns', 'damaged-column', 1, [-22, 0, -48], 8, 0.1),
    ruinProp('north-column-east', 'damaged-columns', 'damaged-column', 2, [22, 0, -48], 7, -0.2),
    ruinProp('south-column-west', 'damaged-columns', 'damaged-column', 4, [-22, 0, 48], 8, Math.PI - 0.1),
    ruinProp('south-column-east', 'damaged-columns', 'damaged-column', 6, [22, 0, 48], 9, Math.PI + 0.18),

    // Rubble hugs wall ends and corner ruins rather than being distributed evenly.
    ruinProp('northwest-rubble-a', 'rubble-clusters', 'rubble-cluster', 5, [-45, 0, -33], 8, 0.3),
    ruinProp('northwest-rubble-b', 'rubble-clusters', 'rubble-cluster', 2, [-58, 0, -18], 6, -0.4),
    ruinProp('southeast-rubble-a', 'rubble-clusters', 'rubble-cluster', 7, [44, 0, 34], 8, -0.5),
    ruinProp('southeast-rubble-b', 'rubble-clusters', 'rubble-cluster', 10, [59, 0, 18], 6, 0.6),
    ruinProp('west-wall-rubble', 'rubble-clusters', 'rubble-cluster', 3, [-47, 0, 27], 7, Math.PI / 2),
    ruinProp('east-wall-rubble', 'rubble-clusters', 'rubble-cluster', 4, [47, 0, -27], 7, -Math.PI / 2),

    // Crystal growths mark the central portal, bridge choices, and two outer ensembles.
    // Every mesh in this family is `_nocol`; emission stays in the material, never in lights.
    ruinProp('central-growth-west', 'crystal-growths', 'crystal-growth', 2, [-9, 4, 7], 7, 0.3),
    ruinProp('central-growth-east', 'crystal-growths', 'crystal-growth', 6, [9, 4, -7], 8, -0.5),
    ruinProp('bridge-growth-north', 'crystal-growths', 'crystal-growth', 3, [-4, 26.5, -32], 7, 0.2),
    ruinProp('bridge-growth-south', 'crystal-growths', 'crystal-growth', 8, [4, 26.5, 32], 7, Math.PI),
    ruinProp('northwest-growth', 'crystal-growths', 'crystal-growth', 5, [-44, 0, -20], 10, 0.7),
    ruinProp('southeast-growth', 'crystal-growths', 'crystal-growth', 10, [44, 0, 20], 10, -2.4),

    // Fungus in the two corners the ensembles leave empty, in the shade of the wall ends.
    //
    // Amber, and never teal: the crystal growths already emit across the whole cool half of the
    // spectrum, and a teal mushroom beside a teal crystal is not a second thing, it is the same
    // thing at the wrong size. Amber is also the desert's own colour, which is what keeps this
    // reading as something that grew here rather than as more crystal.
    //
    // Deliberately the smallest planting of the four maps that carry this family: the arena is
    // 140 across under a desert sky, so a glow has the least to win here and these earn their
    // place by silhouette in the shade rather than by light.
    ...mushroomPatch({
        id: 'crystal-ruins-fungus-southwest',
        centre: [-55, 0, 45],
        radius: 7,
        count: 3,
        size: [4, 7],
        forms: ['cap', 'coral'],
        hues: ['amber'],
        seed: 2204,
        maxRenderDistance: FUNGUS_RENDER_DISTANCE,
    }),
    ...mushroomPatch({
        id: 'crystal-ruins-fungus-northeast',
        centre: [55, 0, -45],
        radius: 7,
        count: 3,
        size: [4, 7],
        forms: ['coral', 'cap'],
        hues: ['amber'],
        seed: 8815,
        maxRenderDistance: FUNGUS_RENDER_DISTANCE,
    }),
];

export const CRYSTAL_RUINS_MAP = {
    crystal_ruins: {
        name: 'Crystal Ruins',
        size: [140, 60, 140],
        preferAuthoredPortals: true,
        portalLevels: [10, 25, 42],
        glbModels: CRYSTAL_RUINS_PROP_MODELS,
        glbColliderMode: 'scene',
        glbLoadConcurrency: 3,
        obstacles: [
            // --- Boden-Ebene: Zentrale Ruinen-Plattform ---
            { pos: [0, 2, 0], size: [22, 4, 22], kind: 'foam' },

            // --- Kristall-Säulen (4 Hauptkristalle um das Zentrum) ---
            { pos: [30, 12, 30], size: [5, 24, 5] },
            { pos: [-30, 12, -30], size: [5, 24, 5] },
            { pos: [30, 12, -30], size: [5, 24, 5] },
            { pos: [-30, 12, 30], size: [5, 24, 5] },

            // --- Kleine Kristallformationen (Boden) ---
            { pos: [15, 3, 0], size: [3, 6, 3], kind: 'foam' },
            { pos: [-15, 3, 0], size: [3, 6, 3], kind: 'foam' },
            { pos: [0, 3, 15], size: [3, 6, 3], kind: 'foam' },
            { pos: [0, 3, -15], size: [3, 6, 3], kind: 'foam' },

            // --- Ruinen-Mauern mit Durchflug-Tunneln ---
            { pos: [0, 8, -40], size: [50, 16, 5], tunnel: { radius: 5.5, axis: 'z' } },
            { pos: [0, 8, 40], size: [50, 16, 5], tunnel: { radius: 5.5, axis: 'z' } },
            { pos: [40, 8, 0], size: [5, 16, 50], tunnel: { radius: 5.5, axis: 'x' } },
            { pos: [-40, 8, 0], size: [5, 16, 50], tunnel: { radius: 5.5, axis: 'x' } },

            // --- Mittlere Ebene: Schwebende Ruinen-Brücken ---
            { pos: [0, 25, -25], size: [8, 3, 30] },
            { pos: [0, 25, 25], size: [8, 3, 30] },
            { pos: [-25, 25, 0], size: [30, 3, 8] },
            { pos: [25, 25, 0], size: [30, 3, 8] },

            // --- Kristall-Cluster auf den Brücken ---
            { pos: [0, 28, -40], size: [4, 6, 4], kind: 'foam' },
            { pos: [0, 28, 40], size: [4, 6, 4], kind: 'foam' },
            { pos: [-40, 28, 0], size: [4, 6, 4], kind: 'foam' },
            { pos: [40, 28, 0], size: [4, 6, 4], kind: 'foam' },

            // --- Obere Ebene: Kristall-Käfig ---
            { pos: [0, 42, 0], size: [12, 6, 12], tunnel: { radius: 4.0, axis: 'y' } },

            // --- Eck-Türme (Wächter-Kristalle) ---
            { pos: [-55, 20, -55], size: [8, 40, 8] },
            { pos: [55, 20, -55], size: [8, 40, 8] },
            { pos: [-55, 20, 55], size: [8, 40, 8] },
            { pos: [55, 20, 55], size: [8, 40, 8] },

            // --- Verbindungs-Tubes zwischen Eck-Türmen (obere Ebene) ---
            { shape: 'tube', kind: 'hard', start: [-55, 36, -55], end: [55, 36, -55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [-55, 36, 55], end: [55, 36, 55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [-55, 36, -55], end: [-55, 36, 55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [55, 36, -55], end: [55, 36, 55], radius: 3.8 },

            // --- Diagonale Kristall-Rampen ---
            { pos: [20, 14, 20], size: [16, 3, 4], kind: 'foam' },
            { pos: [-20, 14, -20], size: [16, 3, 4], kind: 'foam' },
            { pos: [20, 14, -20], size: [4, 3, 16], kind: 'foam' },
            { pos: [-20, 14, 20], size: [4, 3, 16], kind: 'foam' },

            // --- Plattformen auf Eck-Türmen ---
            { pos: [-55, 41, -55], size: [14, 2, 14] },
            { pos: [55, 41, -55], size: [14, 2, 14] },
            { pos: [-55, 41, 55], size: [14, 2, 14] },
            { pos: [55, 41, 55], size: [14, 2, 14] },

            // --- Schwebende Kristall-Inseln (obere Ebene) ---
            { pos: [0, 50, 30], size: [6, 3, 6], kind: 'foam' },
            { pos: [0, 50, -30], size: [6, 3, 6], kind: 'foam' },
            { pos: [30, 50, 0], size: [6, 3, 6], kind: 'foam' },
            { pos: [-30, 50, 0], size: [6, 3, 6], kind: 'foam' },
        ].map((obstacle) => ({ ...obstacle, compileWithGlb: true })),
        portals: [
            // Boden ↔ Obere Ebene (Zentral)
            { a: [0, 5, 0], b: [0, 48, 0], color: 0x88ffcc },
            // Diagonale Verbindungen
            { a: [-50, 10, -50], b: [50, 42, 50], color: 0xcc44ff },
            { a: [50, 10, -50], b: [-50, 42, 50], color: 0x44ccff },
            // Brücken-Level Portale
            { a: [-45, 25, 0], b: [45, 25, 0], color: 0xffaa44 },
            { a: [0, 25, -45], b: [0, 25, 45], color: 0xff4488 },
            // Turm-Hopper
            { a: [-55, 42, -55], b: [55, 42, 55], color: 0x44ff88 },
        ],
        gates: [
            // Boost-Gates an den Tunnel-Mauern
            {
                type: 'boost',
                pos: [0, 10, -50],
                forward: [0, 0, 1],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [0, 10, 50],
                forward: [0, 0, -1],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [50, 10, 0],
                forward: [-1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [-50, 10, 0],
                forward: [1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            // Slingshot im Zentrum (nach oben)
            {
                type: 'slingshot',
                pos: [0, 26, 0],
                forward: [0, 0, 1],
                up: [0, 1, 0],
                params: { duration: 2.2, forwardImpulse: 20, liftImpulse: 18 }
            },
            // Slingshot auf oberer Ebene
            {
                type: 'slingshot',
                pos: [0, 48, 0],
                forward: [0, 0, -1],
                up: [0, 1, 0],
                params: { duration: 2.0, forwardImpulse: 25, liftImpulse: 12 }
            },
        ],
        playerSpawn: { x: -60, y: 10, z: 0 },
        botSpawns: [
            { x: 60, y: 10, z: 0 },
            { x: 0, y: 10, z: -60 },
            { x: 0, y: 10, z: 60 },
            { x: -55, y: 42, z: -55 },
            { x: 55, y: 42, z: 55 },
            { x: 0, y: 50, z: 0 },
        ],
        items: [
            // Boden-Ebene Items
            { id: 'cr_rocket_center', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: 5, z: 0, weight: 1.5 },
            { id: 'cr_shield_north', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 5, z: -25, weight: 1.2 },
            { id: 'cr_speed_south', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 5, z: 25, weight: 1.3 },
            // Brücken-Ebene Items
            { id: 'cr_ghost_bridge', type: 'item_coin', pickupType: 'GHOST', x: -25, y: 27, z: 0, weight: 1.4 },
            { id: 'cr_thick_bridge', type: 'item_coin', pickupType: 'THICK', x: 25, y: 27, z: 0, weight: 1.0 },
            { id: 'cr_shield_bridge', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 27, z: -25, weight: 1.1 },
            // Obere Ebene Items
            { id: 'cr_rocket_top', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: 52, z: 0, weight: 0.7 },
            { id: 'cr_speed_tower', type: 'item_battery', pickupType: 'SPEED_UP', x: 55, y: 44, z: 55, weight: 1.6 },
        ],
        aircraft: [
            { id: 'cr_air_1', jetId: 'ship2', x: 0, y: 35, z: -30, scale: 1.2, rotateY: 0.5 },
            { id: 'cr_air_2', jetId: 'ship7', x: 30, y: 45, z: 30, scale: 1.1, rotateY: -1.0 },
            { id: 'cr_air_3', jetId: 'aircraft', x: -40, y: 50, z: 0, scale: 1.3, rotateY: 1.57 },
        ],
        exitPortal: { pos: [0, 52, 0], color: 0x00ff88, activateOnClear: true },
        missions: [
            { type: 'KILL_COUNT', params: { target: 7 }, weight: 1.5 },
            { type: 'SURVIVE_DURATION', params: { target: 55 }, weight: 1 },
            { type: 'TIME_TRIAL', params: { target: 40 }, weight: 1.5 },
            { type: 'REACH_PORTAL', params: {}, weight: 1 },
        ],
    },
};
