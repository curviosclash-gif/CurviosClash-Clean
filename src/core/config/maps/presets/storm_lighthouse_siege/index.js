import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';
import { STORM_LIGHTHOUSE_DESTRUCTIBLES } from './StormLighthouseDestructibles.js';
import { STORM_LIGHTHOUSE_MODELS } from './StormLighthouseModels.js';
import {
    STORM_LIGHTHOUSE_SECRET_ROOM,
    STORM_LIGHTHOUSE_SECRET_ROOM_OBSTACLES,
} from './StormLighthouseSecretRoom.js';

export const STORM_LIGHTHOUSE_SIEGE_MAPS = Object.freeze({
    storm_lighthouse_siege: Object.freeze({
        name: 'Sturmleuchtturm',
        size: Object.freeze([150, 100, 150]),
        scaleAuthoredAnchors: true,
        exclusionZone: Object.freeze({ openFaces: Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']) }),
        obstacles: Object.freeze([
            Object.freeze({ pos: [0, 2, 0], size: [150, 4, 150], kind: 'foam', compileWithGlb: true }),
            ...STORM_LIGHTHOUSE_SECRET_ROOM_OBSTACLES,
        ]),
        portals: Object.freeze([]),
        secretRooms: Object.freeze([STORM_LIGHTHOUSE_SECRET_ROOM]),
        glbModels: STORM_LIGHTHOUSE_MODELS,
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        destructibles: STORM_LIGHTHOUSE_DESTRUCTIBLES,
        lighting: normalizeMapLighting({
            key: { direction: [45, 60, -15], color: 0xfff1cd, intensity: 1.15 },
            fill: { direction: [-35, 28, 25], color: 0x5684ac, intensity: 0.34 },
            rim: { direction: [0, 24, 45], color: 0x9ee7ff, intensity: 0.5 },
            hemisphere: { skyColor: 0x7898b3, groundColor: 0x202b32 },
            fog: { color: 0x385062, near: 145, far: 430 },
            skyDome: { zenithColor: 0x182f47, horizonColor: 0x8ca3b2, nadirColor: 0x0b141a },
            starsVisible: false,
        }),
        playerSpawn: Object.freeze({ x: 0, y: 18, z: -55 }),
        botSpawns: Object.freeze([
            Object.freeze({ x: -42, y: 18, z: -35 }),
            Object.freeze({ x: 42, y: 18, z: 35 }),
            Object.freeze({ x: 0, y: 34, z: 55 }),
        ]),
        items: Object.freeze([
            Object.freeze({ pos: [-32, 10, 0] }),
            Object.freeze({ pos: [32, 10, 0] }),
        ]),
        singlePlayerScenario: Object.freeze({
            enabled: true,
            id: 'storm_lighthouse_siege',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 3,
            botCount: 5,
        }),
    }),
});
