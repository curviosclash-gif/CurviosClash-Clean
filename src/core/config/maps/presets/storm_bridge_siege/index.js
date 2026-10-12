import { createLandmarkSiegeMap } from '../siege_shared/LandmarkSiege.js';
import { STORM_BRIDGE_DESTRUCTIBLES } from './StormBridgeDestructibles.js';
import { STORM_BRIDGE_MODELS } from './StormBridgeModels.js';
import {
    STORM_BRIDGE_SECRET_ROOM,
    STORM_BRIDGE_SECRET_ROOM_OBSTACLES,
} from './StormBridgeSecretRoom.js';

export const STORM_BRIDGE_SIEGE_MAPS = createLandmarkSiegeMap({
    id: 'storm_bridge_siege',
    name: 'Sturmbrücke',
    size: [180, 90, 180],
    vault: { room: STORM_BRIDGE_SECRET_ROOM, obstacles: STORM_BRIDGE_SECRET_ROOM_OBSTACLES },
    glbModels: STORM_BRIDGE_MODELS,
    destructibles: STORM_BRIDGE_DESTRUCTIBLES,
    lighting: {
        key: { direction: [35, 55, -20], color: 0xe2ecff, intensity: 1.25 },
        fill: { direction: [-30, 25, 30], color: 0x8eb7d8, intensity: 0.4 },
        rim: { direction: [0, 20, 50], color: 0x75d6ff, intensity: 0.55 },
        hemisphere: { skyColor: 0x9bb8cf, groundColor: 0x26343e },
        fog: { color: 0x253947, near: 180, far: 520 },
        skyDome: { zenithColor: 0x142b43, horizonColor: 0x829bad, nadirColor: 0x0b1118 },
        starsVisible: false,
    },
    playerSpawn: Object.freeze({ x: 0, y: 18, z: -65 }),
    botSpawns: Object.freeze([
        Object.freeze({ x: -45, y: 18, z: -50 }),
        Object.freeze({ x: 45, y: 18, z: 50 }),
        Object.freeze({ x: 0, y: 32, z: 60 }),
    ]),
    items: Object.freeze([
        Object.freeze({ pos: [-38, 12, 0] }),
        Object.freeze({ pos: [38, 12, 0] }),
        // The span is 70 world units long in a 540 unit field, and the two anchors above stand at
        // its ends. Both sides of the deck (z) and the two far corners were empty.
        Object.freeze({ pos: [0, 12, -40] }),
        Object.freeze({ pos: [0, 12, 40] }),
        Object.freeze({ pos: [-65, 16, -42] }),
        Object.freeze({ pos: [65, 16, 42] }),
    ]),
});
