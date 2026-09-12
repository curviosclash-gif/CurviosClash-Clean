// The Eiffel Tower as a flyable map, built from measurements rather than invented: a 125 m base
// square, the first gallery at 57.63 m, the second at 115.73 m, the top platform at 276.1 m and
// the antenna tip at 330 m. What moves on it is what actually moves on the tower -- the inclined
// lifts in the legs, the summit lift in the shaft, the beacon on the mast -- plus one thing that
// does not: the illumination iris under the middle, which turns the way up into a timing problem.
//
// This is the first map in the pack that is flown vertically. Everything is laid out so the
// antenna clears the ceiling: 8 units of esplanade, plus 330 m at 0.6 units per metre, is 206 of
// the 220 available.

import { EIFFEL_TOWER_MODELS, EIFFEL_TOWER_BEAT_SECONDS } from './EiffelTowerModels.js';
import {
    GROUND,
    up,
    FIRST_DECK,
    SECOND_DECK,
    TOP_DECK,
    FIRST_SPREAD,
    BASE_SPREAD,
    EIFFEL_TOWER_OBSTACLES,
    EIFFEL_TOWER_PORTALS,
    EIFFEL_TOWER_GATES,
    EIFFEL_TOWER_ITEMS,
    EIFFEL_TOWER_ARENA_GATES,
    EIFFEL_TOWER_ARENA_ITEMS,
    EIFFEL_TOWER_AIRCRAFT,
} from './EiffelTowerStructure.js';
import {
    EIFFEL_TOWER_CHECKPOINTS,
    EIFFEL_TOWER_FINISH,
    EIFFEL_TOWER_PARCOURS_RULES,
} from './EiffelTowerRoute.js';

const MAP_SIZE = [200, 220, 200];

// Shared by both maps on this structure: the iron, the machines and the collision that makes the
// lattice flyable.
const EIFFEL_TOWER_COMMON = {
    size: MAP_SIZE,
    exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
    scaleAuthoredAnchors: true,
    preferAuthoredPortals: true,
    portalLevels: [up(20), up(58), up(120), up(200), up(280)],
    obstacles: EIFFEL_TOWER_OBSTACLES,
    portals: EIFFEL_TOWER_PORTALS,
    gates: EIFFEL_TOWER_GATES,
    glbModels: EIFFEL_TOWER_MODELS,
    // One beat for the whole tower; each machine states its own offset against it.
    glbAnimationClock: { beatSeconds: EIFFEL_TOWER_BEAT_SECONDS },
    // Triangle/BVH collision off the exported iron. On a lattice this is not a refinement but the
    // only workable option: the openings between the members are the level, and an authored box
    // either seals one or describes nothing.
    glbColliderMode: 'scene',
    // The authored boxes describe collision the GLBs already draw. Keeping them out of the render
    // stage prevents coplanar surfaces from flickering, while a partial or failed GLB load still
    // restores the visible fallback tower.
    glbAuthoredObstaclesCollisionOnly: true,
    glbLoadConcurrency: 3,
    items: EIFFEL_TOWER_ITEMS,
    aircraft: EIFFEL_TOWER_AIRCRAFT,
};

export const EIFFEL_TOWER_MAPS = {
    eiffel_tower: {
        ...EIFFEL_TOWER_COMMON,
        name: 'Eiffelturm',
        // Blue hour from the west, which is the side the route flies in on and the hour the tower
        // was built to be looked at in. The fog is pushed out as far as the contract allows: this
        // is the tallest map in the pack, and the antenna has to stay readable from the ground.
        lighting: {
            key: { direction: [-55, 30, 20], color: 0xffd9a8, intensity: 1.3 },
            fill: { direction: [25, 35, -25], color: 0x6f9ee0, intensity: 0.42 },
            rim: { direction: [-30, 20, -50], color: 0xffb45f, intensity: 0.66 },
            hemisphere: { skyColor: 0x86a8d8, groundColor: 0x4a4436 },
            // Pushed out as far as the contract allows, so the gardens haze out while the antenna
            // stays readable from the esplanade -- which is the whole point of looking up here.
            // The layer sits low: the tower has to rise clear of it.
            fog: {
                color: 0x111a2e, near: 70, far: 200,
                // Gentler than the 0.016 it started at: the tower still rises clear of the layer,
                // but the gardens no longer stay sharp at 200 metres just because the camera happens
                // to sit above the haze.
                height: 8.7, heightFalloff: 0.03, turbulence: 0.14, skyBlend: 1,
                // The early start the Eiffel work tuned for: this fog is thin, so it needs the long
                // blend to reach full density without a boundary. It is stated here now instead of
                // being a shared constant, which was forcing it onto every other map too.
                colorHigh: 0x111a2e, colorLow: 0x111a2e, clipClosureStart: 0.5,
            },
            skyDome: { zenithColor: 0x081638, horizonColor: 0xd99a5c, nadirColor: 0x090c15 },
            starsVisible: true,
            exposureOffset: 0.08,
        },
        playerSpawn: { x: -84, y: up(20.0), z: 0 },
        botSpawns: [
            { x: -84, y: up(20.0), z: -14 },
            { x: -84, y: up(20.0), z: 14 },
            { x: -74, y: up(24.0), z: -22 },
            { x: -74, y: up(24.0), z: 22 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 240 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'eiffel_tower_v1',
            rules: EIFFEL_TOWER_PARCOURS_RULES,
            checkpoints: EIFFEL_TOWER_CHECKPOINTS,
            finish: EIFFEL_TOWER_FINISH,
        },
    },

    // The same iron fought as a free arena. It reuses the structure, the machines and the
    // collision unchanged -- the expensive part of this map is the geometry -- but drops the
    // ordered climb. What that changes is the shape of the fight: the two galleries become floors
    // to circle, the open middles become the lifts between them, and the spawns ring the tower at
    // three heights instead of queueing on the esplanade.
    eiffel_tower_arena: {
        ...EIFFEL_TOWER_COMMON,
        name: 'Eiffelturm Arena',
        lighting: {
            key: { direction: [40, 55, -30], color: 0xd8ecff, intensity: 1.32 },
            fill: { direction: [-35, 26, 30], color: 0xffc98c, intensity: 0.36 },
            rim: { direction: [15, 24, 50], color: 0x7fdcff, intensity: 0.6 },
            hemisphere: { skyColor: 0xa4c2de, groundColor: 0x4c4e54 },
            // Higher and calmer than on the route: it must not hide the lattice a fight is flown
            // through.
            fog: {
                color: 0x16243a, near: 80, far: 200,
                height: 11.3, heightFalloff: 0.033, turbulence: 0.09, skyBlend: 1,
                colorHigh: 0x16243a, colorLow: 0x16243a, clipClosureStart: 0.5,
            },
            skyDome: { zenithColor: 0x0a1930, horizonColor: 0x7d9cbb, nadirColor: 0x080c14 },
            starsVisible: false,
            exposureOffset: 0.04,
        },
        gates: EIFFEL_TOWER_ARENA_GATES,
        items: EIFFEL_TOWER_ARENA_ITEMS,
        playerSpawn: { x: 0, y: GROUND + 26, z: 0 },
        botSpawns: [
            { x: BASE_SPREAD, y: GROUND + 20, z: BASE_SPREAD },
            { x: -BASE_SPREAD, y: GROUND + 20, z: -BASE_SPREAD },
            { x: FIRST_SPREAD, y: FIRST_DECK + 8, z: -FIRST_SPREAD },
            { x: -FIRST_SPREAD, y: FIRST_DECK + 8, z: FIRST_SPREAD },
            { x: 0, y: SECOND_DECK + 10, z: 0 },
            { x: 0, y: TOP_DECK + 8, z: 0 },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
    },
};
