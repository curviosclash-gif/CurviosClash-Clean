// ============================================
// MapPresetCatalogBaseData.js - Basis-Map-Presets
// ============================================

import { TEST_HANGAR_GLB_DATA_URI } from './EmbeddedGlbMapAssets.js';
import { startPoints } from './MapPresetStartPoints.js';
import { authoredWorld, CLASSIC_WORLD_APPEARANCE, STANDARD_WORLD_LIGHTING } from './presets/world_appearance.js';
import { BATTLEFIELD_SUNSET_LIGHTING, PYRAMID_SUN_LIGHTING, CLEAR_DAY_LIGHTING, FLOODLIT_PIT_LIGHTING, FOREST_DAY_LIGHTING, GOLDEN_HOUR_LIGHTING, HALL_TORCHLIGHT_LIGHTING, PORTAL_PSYCHEDELIC_LIGHTING, REACTOR_GLOW_LIGHTING, TWILIGHT_BEACON_LIGHTING } from './presets/map_lighting_profiles.js';
import { STANDARD_GIANT_WORM } from '../../../shared/contracts/StandardGiantWormContract.js';

// Storm and ambience share one shelter list; the volumes are the interiors built by
// scripts/generate_pyramid_map_assets.py (tests/pyramid-blender-assets.contract.test.mjs).
const PYRAMID_SANDSTORM = {
    enabled: true,
    initialDelaySeconds: [45, 90],
    repeatDelaySeconds: [90, 150],
    warningSeconds: 20,
    // 20 s swell, 30 s peak, 20 s ease-off.
    activeSeconds: 70,
    ingressSeconds: 20,
    egressSeconds: 20,
    outdoorNear: 1.6,
    outdoorFar: 8,
    shelterNear: 18,
    shelterFar: 85,
    proximityCueRange: 18,
    shelterVolumes: [
        { id: 'king-hall', min: [-35.5, 1, -95.5], max: [35.5, 33.5, -24.5] },
        { id: 'king-gallery-lower', min: [-31.5, 36.5, -91.5], max: [31.5, 47, -28.5] },
        { id: 'king-atrium', min: [-23, 47, -83], max: [23, 71.5, -37] },
        { id: 'king-gallery-upper', min: [-15, 73.5, -75], max: [15, 96.5, -45] },
        { id: 'dawn-hall', min: [53, 1, 30], max: [103, 33.5, 80] },
        { id: 'dawn-atrium', min: [62, 36.5, 39], max: [94, 65.5, 71] },
        { id: 'dawn-portal-chamber', min: [68, 67.5, 45], max: [88, 89.5, 65] },
        { id: 'dusk-hall', min: [-103, 1, 30], max: [-53, 33.5, 80] },
        { id: 'dusk-atrium', min: [-94, 36.5, 39], max: [-62, 65.5, 71] },
        { id: 'dusk-portal-chamber', min: [-88, 67.5, 45], max: [-68, 89.5, 65] },
        { id: 'sun-pavilion', min: [-19.5, 0.8, 3.8], max: [19.5, 13.2, 28.2] },
    ],
};

export const MAP_PRESET_CATALOG_BASE_DATA = {
    standard: {
        name: 'Standard Arena',
        size: [80, 30, 80],
        glbModels: [{ id: 'standard-world', url: 'assets/maps/standard/glb/01_world.glb',
            position: [0, -0.12, 0], scale: 1 }],
        glbColliderMode: 'dynamic',
        glbAuthoredObstaclesCollisionOnly: true,
        lighting: STANDARD_WORLD_LIGHTING,
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
        mapUnits: [STANDARD_GIANT_WORM],
    },
    custom: {
        name: 'Custom (Editor gespeichert)',
        size: [80, 30, 80],
        obstacles: [],
        portals: [],
    },
    empty: {
        name: 'Leer',
        size: [80, 30, 80],
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
        ...CLASSIC_WORLD_APPEARANCE.maze,
        name: 'Labyrinth',
        size: [80, 25, 80],
        ...startPoints('maze'),
        obstacles: [
            { pos: [-20, 12.45, -20], size: [20, 24.9, 2] },
            { pos: [20, 12.45, -20], size: [20, 24.9, 2] },
            { pos: [0, 12.45, 0], size: [30, 24.9, 2] },
            { pos: [-20, 12.45, 20], size: [20, 24.9, 2] },
            { pos: [20, 12.45, 20], size: [20, 24.9, 2] },
            { pos: [-20, 12.45, 0], size: [2, 24.9, 20] },
            { pos: [20, 12.45, 0], size: [2, 24.9, 20] },
            { pos: [0, 12.45, -20], size: [2, 24.9, 15] },
            { pos: [0, 12.45, 20], size: [2, 24.9, 15] },
        ],
        portals: [
            { a: [-30, 10, -30], b: [30, 10, 30], color: 0xff66ff },
            { a: [30, 10, -30], b: [-30, 10, 30], color: 0x66ccff },
        ]
    },
    complex: {
        ...CLASSIC_WORLD_APPEARANCE.complex,
        name: 'Komplex',
        size: [90, 30, 90],
        ...startPoints('complex'),
        obstacles: [
            { pos: [0, 5, 0], size: [6, 12, 6] },
            { pos: [-25, 15.45, -25], size: [10, 28.9, 2] },
            { pos: [25, 15.45, -25], size: [2, 28.9, 10] },
            { pos: [-25, 15.45, 25], size: [2, 28.9, 10] },
            { pos: [25, 15.45, 25], size: [10, 28.9, 2] },
            { pos: [-15, 13.7, 0], size: [2, 32.4, 15] },
            { pos: [15, 13.7, 0], size: [2, 32.4, 15] },
            { pos: [0, 13.7, -15], size: [15, 32.4, 2] },
            { pos: [0, 13.7, 15], size: [15, 32.4, 2] },
            { pos: [-30, 3, 0], size: [5, 6, 5] },
            { pos: [30, 3, 0], size: [5, 6, 5] },
        ],
        portals: [
            { a: [-35, 12, -35], b: [35, 12, 35], color: 0xffaa00 },
            { a: [35, 12, -35], b: [-35, 12, 35], color: 0x00aaff },
        ]
    },
    pyramid: {
        name: 'Krone des Sonnengottes',
        size: [260, 160, 260],
        scaleAuthoredAnchors: true,
        glbModels: [
            // Positions are the bounding-box anchors printed by scripts/generate_pyramid_map_assets.py.
            { id: 'sun-crown-terrain', url: 'assets/maps/pyramid/glb/01_terrain.glb', position: [0, 0.1, 0], scale: 1 },
            { id: 'sun-king-exterior', url: 'assets/maps/pyramid/glb/02_sun_king_exterior.glb', position: [0, 0, -56.85], scale: 1 },
            { id: 'sun-king-interior', url: 'assets/maps/pyramid/glb/03_sun_king_interior.glb', position: [0, 0, -60], scale: 1 },
            { id: 'dawn-pyramid', url: 'assets/maps/pyramid/glb/04_dawn_pyramid.glb', position: [78, 0, 55], scale: 1 },
            { id: 'dusk-pyramid', url: 'assets/maps/pyramid/glb/05_dusk_pyramid.glb', position: [-78, 0, 55], scale: 1 },
            { id: 'sun-plaza', url: 'assets/maps/pyramid/glb/06_sun_plaza.glb', position: [0, 0, 40.1], scale: 1 },
            { id: 'sun-crown-beacons', url: 'assets/maps/pyramid/glb/07_beacons_portals.glb', position: [0, 0, -4], scale: 1 },
        ],
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        lighting: PYRAMID_SUN_LIGHTING,
        obstacles: [
            { pos: [0, -1, 0], size: [260, 2, 260], kind: 'foam', compileWithGlb: true },
            { pos: [0, 18, -60], size: [100, 36, 100] },
            { pos: [0, 52, -60], size: [72, 32, 72] },
            { pos: [0, 84, -60], size: [46, 32, 46] },
            { pos: [0, 118, -60], size: [22, 36, 22] },
            { pos: [78, 24, 55], size: [78, 48, 78] },
            { pos: [78, 78, 55], size: [38, 60, 38] },
            { pos: [-78, 24, 55], size: [78, 48, 78] },
            { pos: [-78, 76, 55], size: [38, 56, 38] },
        ],
        // The two portals hang free in the upper chambers of the side pyramids, seen through the windows.
        portals: [
            { a: [-78, 80, 55], b: [78, 80, 55], color: 0x21e6ff },
        ],
        playerSpawn: { x: 0, y: 18, z: 112 },
        botSpawns: [
            { x: 104, y: 18, z: 12 }, { x: -104, y: 18, z: 12 },
            { x: 92, y: 24, z: -88 }, { x: -92, y: 24, z: -88 },
            { x: 42, y: 18, z: 105 }, { x: -42, y: 18, z: 105 },
            { x: 0, y: 52, z: -60 },
            // Open sky east and west of the king pyramid: the ninth and tenth start of a full round.
            { x: 104, y: 20, z: -42 }, { x: -104, y: 20, z: -42 },
        ],
        // Half outdoors, half in a shelter (pavilion, both halls, king gallery).
        items: [
            { pos: [0, 7, 16] }, { pos: [0, 40, -88] },
            { pos: [-104, 18, -18] }, { pos: [104, 18, -18] },
            { pos: [-78, 16, 38] }, { pos: [78, 16, 38] },
            { pos: [-40, 12, 60] }, { pos: [40, 12, 60] },
        ],
        sandstorm: PYRAMID_SANDSTORM,
        audioProfile: {
            id: 'sandstorm',
            warningSeconds: PYRAMID_SANDSTORM.warningSeconds,
            activeSeconds: PYRAMID_SANDSTORM.activeSeconds,
            ingressSeconds: PYRAMID_SANDSTORM.ingressSeconds,
            shelterVolumes: PYRAMID_SANDSTORM.shelterVolumes,
        },
    },
    vertical_maze: {
        ...CLASSIC_WORLD_APPEARANCE.vertical_maze,
        name: 'Vertikales Labyrinth',
        size: [100, 45, 100],
        ...startPoints('vertical_maze'),
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
        ...CLASSIC_WORLD_APPEARANCE.trench,
        name: 'Der Graben',
        size: [54, 40, 160],
        ...startPoints('trench'),
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
        ...authoredWorld('foam_forest'),
        name: 'Schaumwald',
        lighting: FOREST_DAY_LIGHTING,
        size: [100, 30, 100],
        ...startPoints('foam_forest'),
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
        lighting: BATTLEFIELD_SUNSET_LIGHTING,
        size: [120, 40, 120],
        ...startPoints('crossfire'),
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
        lighting: CLEAR_DAY_LIGHTING,
        size: [100, 40, 100],
        ...startPoints('checkerboard'),
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
        lighting: FLOODLIT_PIT_LIGHTING,
        size: [120, 30, 120],
        ...startPoints('the_pit'),
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
        lighting: REACTOR_GLOW_LIGHTING,
        size: [100, 40, 100],
        ...startPoints('core_fusion'),
        obstacles: [
            { pos: [0, 20, 0], size: [50, 20, 50], kind: 'foam' }
        ],
        portals: [
            { a: [-45, 10, -45], b: [45, 30, 45], color: 0x00ff00 },
            { a: [45, 10, -45], b: [-45, 30, 45], color: 0xff8800 }
        ]
    },
    pillar_hall: {
        name: 'Säulen-Halle',
        lighting: HALL_TORCHLIGHT_LIGHTING,
        size: [100, 30, 100],
        ...startPoints('pillar_hall'),
        obstacles: [
            { pos: [-30, 15, -30], size: [4, 30, 4] }, { pos: [-30, 15, 0], size: [4, 30, 4] }, { pos: [-30, 15, 30], size: [4, 30, 4] },
            { pos: [0, 15, -30], size: [4, 30, 4] }, { pos: [0, 15, 0], size: [4, 30, 4] }, { pos: [0, 15, 30], size: [4, 30, 4] },
            { pos: [30, 15, -30], size: [4, 30, 4] }, { pos: [30, 15, 0], size: [4, 30, 4] }, { pos: [30, 15, 30], size: [4, 30, 4] }
        ],
        portals: []
    },
    spiral_tower: {
        ...authoredWorld('spiral_tower'),
        name: 'Spiralen-Turm',
        lighting: TWILIGHT_BEACON_LIGHTING,
        size: [80, 70, 80],
        ...startPoints('spiral_tower'),
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
        lighting: PORTAL_PSYCHEDELIC_LIGHTING,
        size: [100, 40, 100],
        ...startPoints('portal_madness'),
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
        ...authoredWorld('the_loop'),
        name: 'Die Schleife',
        lighting: GOLDEN_HOUR_LIGHTING,
        size: [120, 30, 120],
        ...startPoints('the_loop'),
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
    item_showcase: {
        name: 'Item Showcase',
        size: [140, 40, 140],
        obstacles: [],
        portals: [],
        playerSpawn: { x: 0, y: 12, z: 55 },
        botSpawns: [
            { x: 0, y: 12, z: -55 },
        ],
        itemSpawnMode: 'anchor-only',
        keepAuthoredItemsAvailable: true,
        items: [
            { id: 'item_showcase_speed', pickupType: 'SPEED_UP', x: -48, y: 12, z: -18 },
            { id: 'item_showcase_slow', pickupType: 'SLOW_DOWN', x: -32, y: 12, z: -18 },
            { id: 'item_showcase_thick', pickupType: 'THICK', x: -16, y: 12, z: -18 },
            { id: 'item_showcase_thin', pickupType: 'THIN', x: 0, y: 12, z: -18 },
            { id: 'item_showcase_shield', pickupType: 'SHIELD', x: 16, y: 12, z: -18 },
            { id: 'item_showcase_health', pickupType: 'HEALTH', x: 32, y: 12, z: -18 },
            { id: 'item_showcase_ghost', pickupType: 'GHOST', x: 48, y: 12, z: -18 },
            { id: 'item_showcase_invert', pickupType: 'INVERT', x: -48, y: 12, z: 18 },
            { id: 'item_showcase_slow_time', pickupType: 'SLOW_TIME', x: -32, y: 12, z: 18 },
            { id: 'item_showcase_turret', pickupType: 'MG_TURRET', x: -16, y: 12, z: 18 },
            { id: 'item_showcase_rocket_weak', pickupType: 'ROCKET_WEAK', x: 0, y: 12, z: 18 },
            { id: 'item_showcase_rocket_medium', pickupType: 'ROCKET_MEDIUM', x: 16, y: 12, z: 18 },
            { id: 'item_showcase_rocket_heavy', pickupType: 'ROCKET_HEAVY', x: 32, y: 12, z: 18 },
            { id: 'item_showcase_rocket_mega', pickupType: 'ROCKET_MEGA', x: 48, y: 12, z: 18 },
            { id: 'item_showcase_rocket_guided', pickupType: 'ROCKET_GUIDED', x: 64, y: 12, z: 18 },
            { id: 'item_showcase_trail_gap', pickupType: 'TRAIL_GAP', x: -48, y: 12, z: 0 },
            { id: 'item_showcase_emp', pickupType: 'EMP', x: -32, y: 12, z: 0 },
            { id: 'item_showcase_magnet', pickupType: 'MAGNET', x: -16, y: 12, z: 0 },
            { id: 'item_showcase_decoy', pickupType: 'DECOY', x: 0, y: 12, z: 0 },
            { id: 'item_showcase_swap', pickupType: 'SWAP', x: 32, y: 12, z: 0 },
            { id: 'item_showcase_mine', pickupType: 'MINE', x: 48, y: 12, z: 0 },
            { id: 'item_showcase_rocket_turret', pickupType: 'ROCKET_TURRET', x: -32, y: 12, z: 36 },
            { id: 'item_showcase_fog', pickupType: 'FOG', x: -16, y: 12, z: 36 },
            { id: 'item_showcase_fan_3', pickupType: 'FAN_3', x: 0, y: 12, z: 36 },
            { id: 'item_showcase_fan_4', pickupType: 'FAN_4', x: 16, y: 12, z: 36 },
            { id: 'item_showcase_fan_5', pickupType: 'FAN_5', x: 32, y: 12, z: 36 },
            { id: 'item_showcase_flamethrower', pickupType: 'FLAMETHROWER', x: 48, y: 12, z: 36 },
            { id: 'item_showcase_lightning', pickupType: 'LIGHTNING', x: 64, y: 12, z: 36 },
            { id: 'item_showcase_railgun', pickupType: 'RAILGUN', x: 80, y: 12, z: 36 },
            { id: 'item_showcase_repair_drone', pickupType: 'REPAIR_DRONE', x: -48, y: 12, z: 36 },
            { id: 'item_showcase_bomber_strike', pickupType: 'BOMBER_STRIKE', x: -64, y: 12, z: 36 },
        ],
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
            { id: 'showcase_speed_lane', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 30, z: -12, weight: 2 },
            { id: 'showcase_rocket_cross', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 20, y: 26, z: 18, weight: 1 },
            { id: 'showcase_shield_upper', type: 'item_shield', pickupType: 'SHIELD', x: -20, y: 40, z: 22, weight: 1.5 },
            { id: 'showcase_random_lane', x: 40, y: 12, z: -28, weight: 0.8 },
        ],
        aircraft: [
            { id: 'showcase_air_1', jetId: 'ship3', x: -28, y: 34, z: -46, scale: 1.2, rotateY: 0.6 },
            { id: 'showcase_air_2', jetId: 'ship6', x: 34, y: 20, z: 12, scale: 1.05, rotateY: -1.15 },
            { id: 'showcase_air_3', jetId: 'aircraft', x: 0, y: 46, z: 48, scale: 1.35, rotateY: 3.14159 },
        ],
    },
};
