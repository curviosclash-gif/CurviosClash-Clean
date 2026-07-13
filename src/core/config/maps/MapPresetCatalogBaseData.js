// ============================================
// MapPresetCatalogBaseData.js - Basis-Map-Presets
// ============================================

import { TEST_HANGAR_GLB_DATA_URI } from './EmbeddedGlbMapAssets.js';

export const MAP_PRESET_CATALOG_BASE_DATA = {
    standard: {
        name: 'Standard Arena',
        size: [80, 30, 80],
        obstacles: [
            { pos: [0, 5, 0], size: [4, 10, 4] },
            { pos: [20, 5, 20], size: [3, 10, 3] },
            { pos: [-20, 5, -20], size: [3, 10, 3] },
            { pos: [20, 5, -20], size: [3, 10, 3] },
            { pos: [-20, 5, 20], size: [3, 10, 3] },
        ],
        portals: [
            { a: [-30, 12, 0], b: [30, 12, 0], color: 0x00ffcc },
        ],
        exitPortal: { pos: [0, 25, 0], color: 0x00ff88, activateOnClear: true },
        missions: [
            { type: 'KILL_COUNT', params: { target: 3 }, weight: 2 },
            { type: 'SURVIVE_DURATION', params: { target: 30 }, weight: 1 },
        ],
    },
    custom: {
        name: 'Custom (Editor gespeichert)',
        size: [80, 30, 80],
        obstacles: [],
        portals: [],
    },
    empty: {
        name: 'Leer',
        size: [50, 25, 50],
        obstacles: [],
        portals: []
    },
    glb_hangar: {
        name: 'GLB Test Hangar',
        size: [60, 25, 60],
        glbModel: TEST_HANGAR_GLB_DATA_URI,
        glbLoadDelayMs: 140,
        obstacles: [
            { pos: [-6, 4, 0], size: [2, 8, 10] },
            { pos: [6, 4, 0], size: [2, 8, 10], kind: 'foam' },
        ],
        portals: []
    },
    maze: {
        name: 'Labyrinth',
        size: [80, 25, 80],
        obstacles: [
            { pos: [-20, 5, -20], size: [20, 10, 2] },
            { pos: [20, 5, -20], size: [20, 10, 2] },
            { pos: [0, 5, 0], size: [30, 10, 2] },
            { pos: [-20, 5, 20], size: [20, 10, 2] },
            { pos: [20, 5, 20], size: [20, 10, 2] },
            { pos: [-20, 5, 0], size: [2, 10, 20] },
            { pos: [20, 5, 0], size: [2, 10, 20] },
            { pos: [0, 5, -20], size: [2, 10, 15] },
            { pos: [0, 5, 20], size: [2, 10, 15] },
        ],
        portals: [
            { a: [-30, 10, -30], b: [30, 10, 30], color: 0xff66ff },
            { a: [30, 10, -30], b: [-30, 10, 30], color: 0x66ccff },
        ]
    },
    complex: {
        name: 'Komplex',
        size: [90, 30, 90],
        obstacles: [
            { pos: [0, 5, 0], size: [6, 12, 6] },
            { pos: [-25, 5, -25], size: [10, 8, 2] },
            { pos: [25, 5, -25], size: [2, 8, 10] },
            { pos: [-25, 5, 25], size: [2, 8, 10] },
            { pos: [25, 5, 25], size: [10, 8, 2] },
            { pos: [-15, 5, 0], size: [2, 15, 15] },
            { pos: [15, 5, 0], size: [2, 15, 15] },
            { pos: [0, 5, -15], size: [15, 15, 2] },
            { pos: [0, 5, 15], size: [15, 15, 2] },
            { pos: [-30, 3, 0], size: [5, 6, 5] },
            { pos: [30, 3, 0], size: [5, 6, 5] },
        ],
        portals: [
            { a: [-35, 12, -35], b: [35, 12, 35], color: 0xffaa00 },
            { a: [35, 12, -35], b: [-35, 12, 35], color: 0x00aaff },
        ]
    },
    pyramid: {
        name: 'Pyramide',
        size: [80, 35, 80],
        obstacles: [
            { pos: [0, 2, 0], size: [20, 4, 20] },
            { pos: [0, 6, 0], size: [15, 4, 15] },
            { pos: [0, 10, 0], size: [10, 4, 10] },
            { pos: [0, 14, 0], size: [5, 4, 5] },
            { pos: [-30, 5, -30], size: [3, 10, 3] },
            { pos: [30, 5, -30], size: [3, 10, 3] },
            { pos: [-30, 5, 30], size: [3, 10, 3] },
            { pos: [30, 5, 30], size: [3, 10, 3] },
        ],
        portals: [
            { a: [0, 25, -30], b: [0, 25, 30], color: 0xff44ff },
        ]
    },
    vertical_maze: {
        name: 'Vertikales Labyrinth',
        size: [100, 45, 100],
        obstacles: [
            { pos: [30, 15, 30], size: [8, 30, 8] },
            { pos: [-30, 15, -30], size: [8, 30, 8] },
            { pos: [-30, 15, 30], size: [8, 30, 8] },
            { pos: [30, 15, -30], size: [8, 30, 8] },
            { pos: [0, 35, 0], size: [24, 20, 24] },
            { pos: [-40, 35, 0], size: [4, 20, 60] },
            { pos: [40, 10, 0], size: [4, 20, 60] },
            { pos: [0, 35, 40], size: [60, 20, 4] },
            { pos: [0, 10, -40], size: [60, 20, 4] }
        ],
        portals: [
            { a: [-40, 10, -40], b: [40, 35, 40], color: 0x00ffcc },
            { a: [40, 10, -40], b: [-40, 35, 40], color: 0xff00ff }
        ]
    },
    trench: {
        name: 'Der Graben',
        size: [60, 40, 160],
        obstacles: [
            { pos: [-25, 20, 0], size: [4, 40, 160] },
            { pos: [25, 20, 0], size: [4, 40, 160] },
            { pos: [0, 10, -40], size: [20, 4, 4] },
            { pos: [0, 30, 0], size: [20, 4, 4] },
            { pos: [0, 10, 40], size: [20, 4, 4] },
        ],
        portals: []
    },
    foam_forest: {
        name: 'Schaumwald',
        size: [100, 30, 100],
        obstacles: [
            { pos: [15, 15, 15], size: [3, 30, 3], kind: 'foam' },
            { pos: [-15, 15, 15], size: [3, 30, 3], kind: 'foam' },
            { pos: [15, 15, -15], size: [3, 30, 3], kind: 'foam' },
            { pos: [-15, 15, -15], size: [3, 30, 3], kind: 'foam' },
            { pos: [30, 15, 0], size: [3, 30, 3], kind: 'foam' },
            { pos: [-30, 15, 0], size: [3, 30, 3], kind: 'foam' },
            { pos: [0, 15, 30], size: [3, 30, 3], kind: 'foam' },
            { pos: [0, 15, -30], size: [3, 30, 3], kind: 'foam' },
            { pos: [0, 8, 0], size: [10, 16, 10], kind: 'foam' }
        ],
        portals: []
    },
    crossfire: {
        name: 'Kreuzfeuer',
        size: [120, 40, 120],
        obstacles: [
            { pos: [0, 20, 0], size: [120, 20, 4] },
            { pos: [0, 20, 0], size: [4, 20, 120] },
        ],
        portals: [
            { a: [-50, 20, -50], b: [50, 20, 50], color: 0xffff00 },
            { a: [50, 20, -50], b: [-50, 20, 50], color: 0x00ffff }
        ]
    },
    checkerboard: {
        name: 'Schachbrett',
        size: [100, 40, 100],
        obstacles: [
            { pos: [-25, 10, -25], size: [15, 20, 15] },
            { pos: [25, 10, 25], size: [15, 20, 15] },
            { pos: [25, 30, -25], size: [15, 20, 15] },
            { pos: [-25, 30, 25], size: [15, 20, 15] }
        ],
        portals: []
    },
    the_pit: {
        name: 'Die Arena',
        size: [120, 30, 120],
        obstacles: [
            { pos: [0, 4, 0], size: [40, 8, 40], kind: 'foam' }
        ],
        portals: [
            { a: [-55, 15, 0], b: [55, 15, 0], color: 0xff0000 },
            { a: [0, 15, -55], b: [0, 15, 55], color: 0x0000ff }
        ]
    },
    core_fusion: {
        name: 'Kern-Fusion',
        size: [100, 40, 100],
        obstacles: [
            { pos: [0, 20, 0], size: [50, 20, 50], kind: 'foam' }
        ],
        portals: [
            { a: [-45, 10, -45], b: [45, 30, 45], color: 0x00ff00 },
            { a: [45, 10, -45], b: [-45, 30, 45], color: 0xff8800 }
        ]
    },
    pillar_hall: {
        name: 'Saeulen-Halle',
        size: [100, 30, 100],
        obstacles: [
            { pos: [-30, 15, -30], size: [4, 30, 4] }, { pos: [-30, 15, 0], size: [4, 30, 4] }, { pos: [-30, 15, 30], size: [4, 30, 4] },
            { pos: [0, 15, -30], size: [4, 30, 4] }, { pos: [0, 15, 0], size: [4, 30, 4] }, { pos: [0, 15, 30], size: [4, 30, 4] },
            { pos: [30, 15, -30], size: [4, 30, 4] }, { pos: [30, 15, 0], size: [4, 30, 4] }, { pos: [30, 15, 30], size: [4, 30, 4] }
        ],
        portals: []
    },
    spiral_tower: {
        name: 'Spiralen-Turm',
        size: [80, 70, 80],
        obstacles: [
            { pos: [0, 10, 20], size: [20, 4, 10] },
            { pos: [20, 25, 0], size: [10, 4, 20] },
            { pos: [0, 40, -20], size: [20, 4, 10] },
            { pos: [-20, 55, 0], size: [10, 4, 20] }
        ],
        portals: [
            { a: [0, 5, 0], b: [0, 65, 0], color: 0xffffff }
        ]
    },
    portal_madness: {
        name: 'Portal-Wahnsinn',
        size: [100, 40, 100],
        obstacles: [
            { pos: [0, 20, 0], size: [10, 10, 10] }
        ],
        portals: [
            { a: [-40, 10, 0], b: [40, 10, 0], color: 0xff0000 },
            { a: [0, 10, -40], b: [0, 10, 40], color: 0x00ff00 },
            { a: [-40, 30, 0], b: [40, 30, 0], color: 0x0000ff },
            { a: [0, 30, -40], b: [0, 30, 40], color: 0xffff00 },
            { a: [-30, 20, -30], b: [30, 20, 30], color: 0xff00ff },
            { a: [30, 20, -30], b: [-30, 20, 30], color: 0x00ffff }
        ]
    },
    the_loop: {
        name: 'Die Schleife',
        size: [120, 30, 120],
        obstacles: [
            { pos: [0, 15, 0], size: [60, 30, 60] },
            { pos: [0, 25, 55], size: [120, 10, 4] },
            { pos: [0, 25, -55], size: [120, 10, 4] },
            { pos: [55, 25, 0], size: [4, 10, 120] },
            { pos: [-55, 25, 0], size: [4, 10, 120] }
        ],
        portals: []
    },
    upgrade_showcase: {
        name: 'Upgrade Showcase',
        size: [100, 40, 100],
        obstacles: [
            { pos: [0, 2, 0], size: [20, 4, 20], kind: 'foam' }
        ],
        gates: [
            {
                type: 'boost',
                pos: [0, 12, -20],
                forward: [0, 0, -1],
                params: { duration: 1.5, forwardImpulse: 45, bonusSpeed: 60 }
            },
            {
                type: 'slingshot',
                pos: [20, 15, 0],
                forward: [1, 0, 0],
                up: [0, 1, 0],
                params: { duration: 2.0, forwardImpulse: 30, liftImpulse: 8 }
            },
            {
                type: 'boost',
                pos: [0, 20, 20],
                forward: [0, 0, 1],
                params: { duration: 1.2, forwardImpulse: 40 }
            }
        ],
        portals: []
    },
    showcase_nexus: {
        name: 'Showcase Nexus',
        size: [130, 52, 130],
        glbModel: TEST_HANGAR_GLB_DATA_URI,
        glbLoadDelayMs: 180,
        glbColliderMode: 'fallbackOnly',
        preferAuthoredPortals: true,
        portalLevels: [12, 26, 40],
        obstacles: [
            { pos: [0, 4, 0], size: [24, 8, 24], kind: 'foam' },
            { pos: [-36, 10, 0], size: [6, 20, 44] },
            { pos: [36, 10, 0], size: [6, 20, 44], kind: 'foam' },
            { pos: [0, 12, -34], size: [40, 18, 6], tunnel: { radius: 4.8, axis: 'x' } },
            { pos: [0, 28, 30], size: [36, 10, 6], kind: 'foam', tunnel: { radius: 3.9, axis: 'x' } },
            { pos: [-20, 24, 34], size: [8, 18, 18] },
            { pos: [22, 20, 34], size: [10, 14, 20], kind: 'foam' },
            { shape: 'tube', kind: 'hard', start: [-44, 18, -26], end: [44, 18, -26], radius: 4.2 },
            { shape: 'tube', kind: 'hard', start: [0, 10, 44], end: [0, 34, 44], radius: 3.6 },
        ],
        portals: [
            { a: [-52, 12, -52], b: [52, 26, 52], color: 0x00ffcc },
            { a: [52, 12, -48], b: [-52, 40, 48], color: 0xff88cc },
        ],
        gates: [
            {
                type: 'boost',
                pos: [0, 12, -50],
                forward: [0, 0, -1],
                params: { duration: 1.4, forwardImpulse: 46, bonusSpeed: 62 }
            },
            {
                type: 'slingshot',
                pos: [-48, 26, 0],
                forward: [1, 0, 0],
                up: [0, 1, 0],
                params: { duration: 1.8, forwardImpulse: 34, liftImpulse: 10 }
            },
            {
                type: 'boost',
                pos: [48, 40, 0],
                forward: [-1, 0, 0],
                params: { duration: 1.2, forwardImpulse: 42, bonusSpeed: 54 }
            }
        ],
        playerSpawn: { x: -54, y: 12, z: 18 },
        botSpawns: [
            { x: 54, y: 12, z: 18 },
            { x: 54, y: 26, z: -20 },
            { x: -54, y: 40, z: -18 },
            { x: 0, y: 12, z: 56 },
        ],
        items: [
            { id: 'showcase_speed_lane', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 12, z: -12, weight: 2 },
            { id: 'showcase_rocket_cross', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 20, y: 26, z: 18, weight: 1 },
            { id: 'showcase_shield_upper', type: 'item_shield', pickupType: 'SHIELD', x: -20, y: 40, z: 22, weight: 1.5 },
            { id: 'showcase_random_lane', type: 'item_coin', x: 40, y: 12, z: -28, weight: 0.8 },
        ],
        aircraft: [
            { id: 'showcase_air_1', jetId: 'ship3', x: -28, y: 34, z: -46, scale: 1.2, rotateY: 0.6 },
            { id: 'showcase_air_2', jetId: 'ship6', x: 34, y: 20, z: 12, scale: 1.05, rotateY: -1.15 },
            { id: 'showcase_air_3', jetId: 'aircraft', x: 0, y: 46, z: 48, scale: 1.35, rotateY: 3.14159 },
        ],
    },
};
