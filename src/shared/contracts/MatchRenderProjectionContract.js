import { normalizeString } from './ContractNormalizeUtils.js';
import { GAMEPLAY_CAMERA_MODE_ID } from './CameraModeContract.js';

export const MATCH_RENDER_PROJECTION_CONTRACT_VERSION = 'match-render-projection.v1';

function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInt(value, fallback = 0) {
    return Math.trunc(normalizeNumber(value, fallback));
}

function normalizeNonNegativeInt(value, fallback = 0) {
    return Math.max(0, normalizeInt(value, fallback));
}

function createVector3Projection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        x: normalizeNumber(source.x, 0),
        y: normalizeNumber(source.y, 0),
        z: normalizeNumber(source.z, 0),
    };
}

function createQuaternionProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        x: normalizeNumber(source.x, 0),
        y: normalizeNumber(source.y, 0),
        z: normalizeNumber(source.z, 0),
        w: normalizeNumber(source.w, 1),
    };
}

function createPlayerProjection(value = null) {
    if (!value || typeof value !== 'object') return null;
    return {
        playerIndex: normalizeNonNegativeInt(value.playerIndex, 0),
        isBot: value.isBot === true,
        alive: value.alive !== false,
        color: normalizeInt(value.color, 0xffffff),
        score: normalizeInt(value.score, 0),
        speed: normalizeNumber(value.speed, 0),
        boostCharge: Math.max(0, normalizeNumber(value.boostCharge, 0)),
        boostCapacity: Math.max(0.001, normalizeNumber(value.boostCapacity, 1)),
        isBoosting: value.isBoosting === true,
        hp: Math.max(0, normalizeNumber(value.hp, 0)),
        maxHp: Math.max(1, normalizeNumber(value.maxHp, 1)),
        cockpitCamera: value.cockpitCamera !== false,
        planarMode: value.planarMode === true,
        cameraModeId: normalizeString(value.cameraModeId, GAMEPLAY_CAMERA_MODE_ID),
        position: createVector3Projection(value.position),
        quaternion: createQuaternionProjection(value.quaternion),
        direction: createVector3Projection(value.direction),
        firstPersonAnchor: createVector3Projection(value.firstPersonAnchor),
    };
}

export function createMatchRenderProjection(payload = {}) {
    const source = /** @type {any} */ (payload && typeof payload === 'object' ? payload : {});
    const players = Array.isArray(source.players)
        ? source.players.map((entry) => createPlayerProjection(entry)).filter(Boolean)
        : [];

    return {
        contractVersion: MATCH_RENDER_PROJECTION_CONTRACT_VERSION,
        updatedAt: Math.max(0, normalizeNumber(source.updatedAt, Date.now())),
        gameStateId: normalizeString(source.gameStateId, ''),
        modeId: normalizeString(source.modeId, ''),
        isNetworkSession: source.isNetworkSession === true,
        localPlayerIndex: Math.max(0, normalizeInt(source.localPlayerIndex, 0)),
        localHumanCount: Math.max(1, normalizeNonNegativeInt(source.localHumanCount, 1)),
        players,
    };
}
