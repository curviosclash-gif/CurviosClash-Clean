import { STORM_BRIDGE_DESTRUCTIBLES } from './StormBridgeDestructibles.js';
import { STORM_BRIDGE_MODELS } from './StormBridgeModels.js';
import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';
import {
    STORM_BRIDGE_SECRET_ROOM,
    STORM_BRIDGE_SECRET_ROOM_OBSTACLES,
} from './StormBridgeSecretRoom.js';

const MAP_SIZE = Object.freeze([180, 90, 180]);

export const STORM_BRIDGE_SIEGE_MAPS = Object.freeze({
    storm_bridge_siege: Object.freeze({
        name: 'Sturmbruecke',
        size: MAP_SIZE,
        scaleAuthoredAnchors: true,
        exclusionZone: Object.freeze({ openFaces: Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']) }),
        obstacles: Object.freeze([
            Object.freeze({ pos: [0, 2, 0], size: [180, 4, 180], kind: 'foam', compileWithGlb: true }),
            ...STORM_BRIDGE_SECRET_ROOM_OBSTACLES,
        ]),
        portals: Object.freeze([]),
        secretRooms: Object.freeze([STORM_BRIDGE_SECRET_ROOM]),
        glbModels: STORM_BRIDGE_MODELS,
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        destructibles: STORM_BRIDGE_DESTRUCTIBLES,
        lighting: normalizeMapLighting({
            key: Object.freeze({ direction: [35, 55, -20], color: 0xe2ecff, intensity: 1.25 }),
            fill: Object.freeze({ direction: [-30, 25, 30], color: 0x8eb7d8, intensity: 0.4 }),
            rim: Object.freeze({ direction: [0, 20, 50], color: 0x75d6ff, intensity: 0.55 }),
            hemisphere: Object.freeze({ skyColor: 0x9bb8cf, groundColor: 0x26343e }),
            fog: Object.freeze({ color: 0x253947, near: 180, far: 520 }),
            skyDome: Object.freeze({ zenithColor: 0x142b43, horizonColor: 0x829bad, nadirColor: 0x0b1118 }),
            starsVisible: false,
        }),
        playerSpawn: Object.freeze({ x: 0, y: 18, z: -65 }),
        botSpawns: Object.freeze([
            Object.freeze({ x: -45, y: 18, z: -50 }),
            Object.freeze({ x: 45, y: 18, z: 50 }),
            Object.freeze({ x: 0, y: 32, z: 60 }),
        ]),
        items: Object.freeze([
            Object.freeze({ pos: [-38, 12, 0] }),
            Object.freeze({ pos: [38, 12, 0] }),
        ]),
        singlePlayerScenario: Object.freeze({
            enabled: true,
            id: 'storm_bridge_siege',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 3,
            botCount: 5,
        }),
    }),
});
