import { SECRET_ROOM_LIMITS } from '../../shared/contracts/SecretRoomContract.js';

export const MAP_SCHEMA_VERSION = 4;
export const CUSTOM_MAP_KEY = 'custom';
export const CUSTOM_MAP_STORAGE_KEY = 'custom_map_test';
export const MAX_MAP_JSON_BYTES = 2 * 1024 * 1024;

export const MAP_SCHEMA_COLLECTION_LIMITS = Object.freeze({
    tunnels: 512,
    staticTurrets: 512,
    hardBlocks: 4096,
    foamBlocks: 4096,
    portals: 512,
    portalLevels: 64,
    gates: 512,
    items: 2048,
    aircraft: 256,
    glbModels: 256,
    botSpawns: 128,
    flagObjectives: 6,
    parcoursCheckpoints: 1024,
    checkpointNextIds: 64,
    // One truth: the contract caps how many rooms a map may hold, the schema refuses the rest.
    secretRooms: SECRET_ROOM_LIMITS.maxRooms,
});

export const DEFAULT_ARENA_SIZE = Object.freeze({
    width: 2800,
    height: 950,
    depth: 2400,
});

export const DEFAULT_PORTAL_COLORS = [0x00ffcc, 0xff66ff, 0x66ccff, 0xffaa00, 0x44ffaa, 0xff6688];
