import * as THREE from 'three';
import { MODE_ID } from './observation/ObservationSchemaV1.js';

export const WORLD_UP = new THREE.Vector3(0, 1, 0);

const PROFILE_NAMES = Object.freeze({
    DEFENSIVE: 'defensive',
    BALANCED: 'balanced',
    AGGRESSIVE: 'aggressive',
});

export const HEURISTIC_PROFILES = Object.freeze({
    defensive: Object.freeze({
        retreatVitality: 0.48,
        retreatPressure: 0.64,
        boostBias: 0.82,
        itemThresholdScale: 0.82,
        attackWindow: 0.82,
        safetyDistance: 0.38,
        preferredRange: 0.42,
        strafeDistance: 0.56,
    }),
    balanced: Object.freeze({
        retreatVitality: 0.38,
        retreatPressure: 0.74,
        boostBias: 1,
        itemThresholdScale: 1,
        attackWindow: 0.72,
        safetyDistance: 0.3,
        preferredRange: 0.34,
        strafeDistance: 0.5,
    }),
    aggressive: Object.freeze({
        retreatVitality: 0.28,
        retreatPressure: 0.84,
        boostBias: 1.18,
        itemThresholdScale: 1.16,
        attackWindow: 0.6,
        safetyDistance: 0.24,
        preferredRange: 0.26,
        strafeDistance: 0.44,
    }),
});

export function normalizeProfileName(profileName) {
    const normalized = String(profileName || '').trim().toLowerCase();
    return HEURISTIC_PROFILES[normalized] ? normalized : PROFILE_NAMES.BALANCED;
}

export function readObservationValue(observation, index, fallback = 0) {
    if (!observation || typeof observation.length !== 'number') return fallback;
    const value = Number(observation[index]);
    return Number.isFinite(value) ? value : fallback;
}

export function hasYaw(input) {
    return input.yawLeft === true || input.yawRight === true;
}

export function resetInput(input) {
    input.pitchUp = false;
    input.pitchDown = false;
    input.yawLeft = false;
    input.yawRight = false;
    input.rollLeft = false;
    input.rollRight = false;
    input.boost = false;
    input.cameraSwitch = false;
    input.dropItem = false;
    input.shootItem = false;
    input.shootMG = false;
    input.shootItemIndex = -1;
    input.nextItem = false;
    input.useItem = -1;
    return input;
}

export function resolveSelectedItemIndex(player) {
    const inventory = Array.isArray(player?.inventory) ? player.inventory : [];
    if (inventory.length === 0) return -1;
    const selected = Number(player?.selectedItemIndex);
    if (Number.isInteger(selected) && selected >= 0 && selected < inventory.length) {
        return selected;
    }
    return 0;
}

export function resolveInventoryLength(player) {
    return Array.isArray(player?.inventory) ? player.inventory.length : 0;
}

export function resolveMode(runtimeContext, observation) {
    const mode = String(runtimeContext?.mode || '').trim().toUpperCase();
    if (mode === 'HUNT' || mode === 'FIGHT') return 'HUNT';
    if (mode === 'ARCADE' || runtimeContext?.runtimeConfig?.arcade?.enabled === true) return 'ARCADE';
    const modeId = readObservationValue(observation, MODE_ID, 0);
    if (modeId >= 0.5 || runtimeContext?.rules?.huntEnabled === true) return 'HUNT';
    return 'CLASSIC';
}

export function readVectorLikePosition(position, out) {
    if (!position) return false;
    if (Array.isArray(position) && position.length >= 3) {
        out.set(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0);
        return true;
    }
    const x = Number(position.x);
    const y = Number(position.y);
    const z = Number(position.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    out.set(x, y, z);
    return true;
}

export function resolveProgressPlayerIndex(player) {
    return Number.isInteger(player?.index) ? player.index : 0;
}
