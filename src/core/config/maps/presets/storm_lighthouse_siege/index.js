import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';
import { STORM_LIGHTHOUSE_DESTRUCTIBLES } from './StormLighthouseDestructibles.js';
import { STORM_LIGHTHOUSE_MODELS } from './StormLighthouseModels.js';
import {
    STORM_LIGHTHOUSE_SECRET_ROOM,
    STORM_LIGHTHOUSE_SECRET_ROOM_OBSTACLES,
} from './StormLighthouseSecretRoom.js';
import {
    STORM_LIGHTHOUSE_BOT_SPAWNS,
    STORM_LIGHTHOUSE_GATES,
    STORM_LIGHTHOUSE_ITEMS,
    STORM_LIGHTHOUSE_LIGHTS,
    STORM_LIGHTHOUSE_PLAYER_SPAWN,
} from './StormLighthouseStructure.js';

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
        gates: STORM_LIGHTHOUSE_GATES,
        lights: STORM_LIGHTHOUSE_LIGHTS,
        lighting: normalizeMapLighting({
            key: { direction: [42, 58, -18], color: 0xe8f3ff, intensity: 1.12 },
            fill: { direction: [-38, 24, 28], color: 0x426f98, intensity: 0.3 },
            rim: { direction: [4, 22, 48], color: 0x76ddff, intensity: 0.62 },
            hemisphere: { skyColor: 0x668aa8, groundColor: 0x17252d },
            fog: {
                color: 0x29475a, near: 125, far: 390,
                height: 16, heightFalloff: 0.018, turbulence: 0.2,
                colorHigh: 0x29475a, colorLow: 0x172d38, clipClosureStart: 0.68,
            },
            skyDome: { zenithColor: 0x102a42, horizonColor: 0x718fa3, nadirColor: 0x071218 },
            starsVisible: false,
            exposureOffset: -0.02,
        }),
        playerSpawn: STORM_LIGHTHOUSE_PLAYER_SPAWN,
        botSpawns: STORM_LIGHTHOUSE_BOT_SPAWNS,
        items: STORM_LIGHTHOUSE_ITEMS,
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
