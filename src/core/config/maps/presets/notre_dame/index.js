// Notre-Dame de Paris as a flyable map, rebuilt from measurements rather than invented: 127.5 m
// long, 48 m across the transept, towers at 69 m, nave vault at 33 m, spire tip at 96 m. What
// moves on it is the reconstruction site that stood around the building -- tower crane, hoists,
// scaffold lifts, sheeting -- because a cathedral is not a machine, and pretending otherwise
// would have cost the very thing that makes the map worth flying.
//
// The map is the same size as the largest existing one, Kinetic Tide, and everything is laid out
// so the spire tip clears the ceiling: 8 units of island, plus 96 m at 1.4 units per metre, is
// 142.4 of the 150 available.

import { NOTRE_DAME_MODELS, NOTRE_DAME_BEAT_SECONDS } from './NotreDameModels.js';
import {
    GROUND,
    NOTRE_DAME_OBSTACLES,
    NOTRE_DAME_PORTALS,
    NOTRE_DAME_GATES,
    NOTRE_DAME_ITEMS,
    NOTRE_DAME_AIRCRAFT,
} from './NotreDameStructure.js';
import {
    NOTRE_DAME_CHECKPOINTS,
    NOTRE_DAME_FINISH,
    NOTRE_DAME_PARCOURS_RULES,
} from './NotreDameRoute.js';

const MAP_SIZE = [460, 150, 320];

// Shared by both maps on this building: the fabric, the site, and the collision that makes the
// interior flyable.
const NOTRE_DAME_COMMON = {
    size: MAP_SIZE,
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    portalLevels: [GROUND + 12, GROUND + 30, GROUND + 54, GROUND + 76, GROUND + 100],
    obstacles: NOTRE_DAME_OBSTACLES,
    portals: NOTRE_DAME_PORTALS,
    gates: NOTRE_DAME_GATES,
    glbModels: NOTRE_DAME_MODELS,
    // One beat for the whole site; each piece states its own offset against it.
    glbAnimationClock: { beatSeconds: NOTRE_DAME_BEAT_SECONDS },
    // Only the moving site equipment gets mesh colliders. The building carries its collision on
    // the authored boxes and hollow bores in NotreDameStructure, because a mesh collider is an
    // axis-aligned box per mesh and would fill every arch it touches.
    glbColliderMode: 'dynamic',
    // Those authored boxes describe collision already drawn by the cathedral GLBs. Keeping them
    // out of the render stage prevents coplanar surfaces and transparent depth writes from
    // flickering, while a partial or failed GLB load still restores the visible fallback boxes.
    glbAuthoredObstaclesCollisionOnly: true,
    glbLoadConcurrency: 3,
    items: NOTRE_DAME_ITEMS,
    aircraft: NOTRE_DAME_AIRCRAFT,
};

export const NOTRE_DAME_MAPS = {
    notre_dame: {
        ...NOTRE_DAME_COMMON,
        name: 'Notre-Dame',
        // Late afternoon from the west, which is the side the facade was built to be seen from and
        // the side the route flies in on. The fog is pushed out as far as the contract allows: this
        // is the longest map in the pack, and the spire has to stay readable from the river.
        // Only the route map carries this. The arena variant is deliberately left on the default
        // for now, so the two can be compared side by side before the profile is shared.
        lighting: {
            key: { direction: [-60, 40, 15], color: 0xffe2b8, intensity: 1.45 },
            fill: { direction: [30, 25, -20], color: 0x8fb4e0, intensity: 0.38 },
            rim: { direction: [-35, 18, -45], color: 0x7fd0ff, intensity: 0.5 },
            hemisphere: { skyColor: 0xbcd8f5, groundColor: 0x6a6055 },
            fog: { color: 0x1a2338, near: 90, far: 200 },
            skyDome: { zenithColor: 0x0a1a3a, horizonColor: 0xd8a468, nadirColor: 0x0a0d16 },
            starsVisible: false,
            exposureOffset: 0.1,
        },
        playerSpawn: { x: -210, y: GROUND + 14, z: 0 },
        botSpawns: [
            { x: -210, y: GROUND + 14, z: -13 },
            { x: -210, y: GROUND + 14, z: 13 },
            { x: -198, y: GROUND + 14, z: -20 },
            { x: -198, y: GROUND + 14, z: 20 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 270 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'notre_dame_v1',
            rules: NOTRE_DAME_PARCOURS_RULES,
            checkpoints: NOTRE_DAME_CHECKPOINTS,
            finish: NOTRE_DAME_FINISH,
        },
    },

    // The same building flown as a free arena. It reuses the fabric, the site and the collision
    // unchanged -- the expensive part of this map is the geometry, and a second route through it
    // would not have justified a second set. What differs is the intent: no ordered checkpoints, so
    // the nave, the aisles, the attic and the buttress runs become a connected fighting space rather
    // than a sequence, and the spawns ring the building instead of queueing on the river.
    notre_dame_arena: {
        ...NOTRE_DAME_COMMON,
        name: 'Notre-Dame Arena',
        playerSpawn: { x: -112, y: GROUND + 16, z: 0 },
        botSpawns: [
            { x: -112, y: GROUND + 16, z: -24 },
            { x: -112, y: GROUND + 16, z: 24 },
            { x: 17, y: GROUND + 30, z: -52 },
            { x: 17, y: GROUND + 30, z: 52 },
            { x: 110, y: GROUND + 14, z: 0 },
            { x: -40, y: GROUND + 28, z: 0 },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
    },
};
