import { createLandmarkSiegeMap } from '../siege_shared/LandmarkSiege.js';
import { STORM_DAM_DESTRUCTIBLES } from './StormDamDestructibles.js';
import { STORM_DAM_MODELS } from './StormDamModels.js';
import { STORM_DAM_SECRET_ROOM, STORM_DAM_SECRET_ROOM_OBSTACLES } from './StormDamSecretRoom.js';

const MAP_SIZE = Object.freeze([180, 150, 190]);

export const STORM_DAM_SIEGE_MAPS = createLandmarkSiegeMap({
    id: 'storm_dam_siege',
    name: 'Sturmdamm',
    size: MAP_SIZE,
    openFaces: ['minX', 'maxX', 'minZ', 'maxY'],
    wallObstacles: [
        Object.freeze({ pos: [-57, 70, 84], size: [66, 140, 12], kind: 'hard' }),
        Object.freeze({ pos: [57, 70, 84], size: [66, 140, 12], kind: 'hard' }),
    ],
    vault: { room: STORM_DAM_SECRET_ROOM, obstacles: STORM_DAM_SECRET_ROOM_OBSTACLES },
    glbModels: STORM_DAM_MODELS,
    destructibles: STORM_DAM_DESTRUCTIBLES,
    extras: {
        waterZone: Object.freeze({
            id: 'dam_basin',
            triggerSegmentId: 'dam_wall',
            bounds: Object.freeze({ min: Object.freeze([-90, 0, -90]), max: Object.freeze([90, 90, 90]) }),
            reservoirBounds: Object.freeze({
                min: Object.freeze([-90, 0, 90]),
                max: Object.freeze([90, 75, 95]),
            }),
            startLevel: 0,
            targetLevel: MAP_SIZE[1] / 2,
            waveSeconds: 4,
            riseSeconds: 24,
            waveOrigin: 'maxZ',
            waveOpeningWidth: 52,
            waveSourceInset: 33,
            waveFloorOffset: 4,
        }),
    },
    lighting: {
        key: { direction: [40, 58, -25], color: 0xd9efff, intensity: 1.2 },
        fill: { direction: [-30, 24, 30], color: 0x5688ad, intensity: 0.38 },
        rim: { direction: [0, 22, 48], color: 0x72ddff, intensity: 0.58 },
        hemisphere: { skyColor: 0x789bb5, groundColor: 0x202b31 },
        fog: { color: 0x29495c, near: 180, far: 650 },
        skyDome: { zenithColor: 0x143047, horizonColor: 0x819ead, nadirColor: 0x0a141a },
        starsVisible: false,
    },
    playerSpawn: Object.freeze({ x: 0, y: 18, z: -66 }),
    botSpawns: Object.freeze([
        Object.freeze({ x: -46, y: 18, z: -48 }),
        Object.freeze({ x: 75, y: 18, z: 45 }),
        Object.freeze({ x: 0, y: 94, z: 58 }),
    ]),
    items: Object.freeze([
        Object.freeze({ pos: [-38, 12, -8] }),
        Object.freeze({ pos: [38, 12, 8] }),
        // The start side, the two flanks, and one high above the basin that stays out of the
        // flood (the water rises to 75).
        Object.freeze({ pos: [0, 12, -45] }),
        Object.freeze({ pos: [-72, 14, -30] }),
        Object.freeze({ pos: [72, 14, 30] }),
        Object.freeze({ pos: [-30, 88, 30] }),
    ]),
});
