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
    NOTRE_DAME_ARENA_GATES,
    NOTRE_DAME_ARENA_ITEMS,
    NOTRE_DAME_AIRCRAFT,
} from './NotreDameStructure.js';
import {
    NOTRE_DAME_CHECKPOINTS,
    NOTRE_DAME_FINISH,
    NOTRE_DAME_PARCOURS_RULES,
} from './NotreDameRoute.js';

const MAP_SIZE = [460, 150, 320];
const NOTRE_DAME_AUDIO_PROFILE = Object.freeze({
    id: 'notre_dame',
    interiorBounds: Object.freeze({
        min: Object.freeze([-76.65, GROUND, -29.5]),
        max: Object.freeze([89.25, GROUND + 64, 29.5]),
    }),
    constructionCenters: Object.freeze([
        Object.freeze([-150, GROUND + 16, 0]),
        Object.freeze([-40, GROUND + 24, 45]),
        Object.freeze([17, GROUND + 30, -52]),
        Object.freeze([130, GROUND + 34, 0]),
    ]),
    constructionRadius: 48,
    bell: Object.freeze({
        position: Object.freeze([-83, GROUND + 70, -20.3]),
        intervalSeconds: 6,
        phaseOffsetSeconds: 4,
        audibleRadius: 150,
    }),
});

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
    // Static fabric uses the loader's triangle/BVH collider, so every portal, gallery and arch
    // follows the surface that is actually drawn. Moving site meshes remain dynamic colliders.
    glbColliderMode: 'scene',
    // Those authored boxes describe collision already drawn by the cathedral GLBs. Keeping them
    // out of the render stage prevents coplanar surfaces and transparent depth writes from
    // flickering, while a partial or failed GLB load still restores the visible fallback boxes.
    glbAuthoredObstaclesCollisionOnly: true,
    glbLoadConcurrency: 3,
    audioProfile: NOTRE_DAME_AUDIO_PROFILE,
    items: NOTRE_DAME_ITEMS,
    aircraft: NOTRE_DAME_AIRCRAFT,
    // Warm light inside the nave, running the length of the building between the west front and the
    // apse. The lamps sit above head height so the vaults catch them, and they deliberately do not
    // cast shadows - the point is that some of this reaches the outside through the portals, the
    // rose and the clerestory, which a shadow-casting light would stop at the first wall.
    lights: [
        // Right behind the west front, close enough that the facade itself picks the glow up and the
        // portals and the rose read as lit from within when the map is approached from the river.
        { id: 'nd_west_front', x: -72, y: GROUND + 26, z: 0, color: 0xff8c3a, intensity: 6000, distance: 70 },
        { id: 'nd_nave_west', x: -60, y: GROUND + 16, z: 0, color: 0xff7a26, intensity: 4000, distance: 55 },
        { id: 'nd_nave_mid', x: -28, y: GROUND + 16, z: 0, color: 0xff8a34, intensity: 4000, distance: 55 },
        { id: 'nd_crossing', x: 4, y: GROUND + 22, z: 0, color: 0xffa04a, intensity: 5200, distance: 65 },
        { id: 'nd_choir', x: 38, y: GROUND + 16, z: 0, color: 0xff7a26, intensity: 4000, distance: 55 },
        { id: 'nd_apse', x: 72, y: GROUND + 14, z: 0, color: 0xff6a1c, intensity: 3400, distance: 50 },
    ],
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
        lighting: {
            key: { direction: [45, 55, -35], color: 0xcfe8ff, intensity: 1.35 },
            fill: { direction: [-40, 24, 30], color: 0xffc98c, intensity: 0.34 },
            rim: { direction: [10, 28, 55], color: 0x7fdcff, intensity: 0.62 },
            hemisphere: { skyColor: 0x9ebbd8, groundColor: 0x4b4d54 },
            fog: { color: 0x142238, near: 78, far: 190 },
            skyDome: { zenithColor: 0x08172e, horizonColor: 0x7898b7, nadirColor: 0x080c14 },
            starsVisible: false,
            exposureOffset: 0.04,
        },
        gates: NOTRE_DAME_ARENA_GATES,
        items: NOTRE_DAME_ARENA_ITEMS,
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
