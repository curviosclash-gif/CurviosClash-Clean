import * as THREE from 'three';
import { MODE_ID } from './observation/ObservationSchemaV1.js';
import {
    isNeutralBotHeuristicProfileTuning,
    normalizeBotHeuristicProfileTuning,
    toBotHeuristicTuningOffset,
} from '../../shared/contracts/BotHeuristicTuningContract.js';

export const WORLD_UP = new THREE.Vector3(0, 1, 0);

const PROFILE_NAMES = Object.freeze({
    DEFENSIVE: 'defensive',
    BALANCED: 'balanced',
    AGGRESSIVE: 'aggressive',
});

const PROFILE_ALIASES = Object.freeze({
    cautious: PROFILE_NAMES.DEFENSIVE,
    neutral: PROFILE_NAMES.BALANCED,
    bold: PROFILE_NAMES.AGGRESSIVE,
});

const DIFFICULTY_ALIASES = Object.freeze({
    medium: 'normal',
    expert: 'hard',
});

export const HEURISTIC_PROFILES = Object.freeze({
    defensive: Object.freeze({
        retreatVitality: 0.54,
        retreatPressure: 0.56,
        boostBias: 0.72,
        defensiveItemThresholdScale: 0.78,
        offensiveItemThresholdScale: 1.18,
        attackWindow: 0.58,
        safetyDistance: 0.44,
        preferredRange: 0.46,
        strafeDistance: 0.60,
        escapeLateralBias: 0.5,
        attackCutoffBias: 0.5,
        finisherBias: 0.5,
        openingFanoutBias: 0.6,
        opportunistBias: 0.5,
        openingHookBias: 0.5,
        trafficAvoidanceBias: 0.5,
        predictiveSafetyBias: 0.63,
    }),
    balanced: Object.freeze({
        retreatVitality: 0.38,
        retreatPressure: 0.74,
        boostBias: 1,
        defensiveItemThresholdScale: 1,
        offensiveItemThresholdScale: 1,
        attackWindow: 0.72,
        safetyDistance: 0.3,
        preferredRange: 0.34,
        strafeDistance: 0.5,
        escapeLateralBias: 0.5,
        attackCutoffBias: 0.5,
        finisherBias: 0.5,
        openingFanoutBias: 0.5,
        opportunistBias: 0.5,
        openingHookBias: 0.5,
        trafficAvoidanceBias: 0.5,
        predictiveSafetyBias: 0.6,
    }),
    aggressive: Object.freeze({
        retreatVitality: 0.20,
        retreatPressure: 0.90,
        boostBias: 1.32,
        defensiveItemThresholdScale: 1.14,
        offensiveItemThresholdScale: 0.82,
        attackWindow: 0.86,
        safetyDistance: 0.22,
        preferredRange: 0.20,
        strafeDistance: 0.38,
        escapeLateralBias: 0.5,
        attackCutoffBias: 0.5,
        finisherBias: 0.5,
        openingFanoutBias: 0.5,
        opportunistBias: 0.5,
        openingHookBias: 0.5,
        trafficAvoidanceBias: 0.5,
        predictiveSafetyBias: 0.56,
    }),
});

export const HEURISTIC_PROFILE_FIELD_BOUNDS = Object.freeze({
    retreatVitality: Object.freeze([0.10, 0.80]),
    retreatPressure: Object.freeze([0.40, 1.00]),
    boostBias: Object.freeze([0.50, 1.60]),
    defensiveItemThresholdScale: Object.freeze([0.50, 1.50]),
    offensiveItemThresholdScale: Object.freeze([0.50, 1.50]),
    attackWindow: Object.freeze([0.30, 1.00]),
    safetyDistance: Object.freeze([0.08, 0.60]),
    preferredRange: Object.freeze([0.10, 0.70]),
    strafeDistance: Object.freeze([0.20, 0.80]),
    escapeLateralBias: Object.freeze([0.25, 1.00]),
    attackCutoffBias: Object.freeze([0.25, 1.00]),
    finisherBias: Object.freeze([0.25, 1.00]),
    openingFanoutBias: Object.freeze([0.25, 1.00]),
    opportunistBias: Object.freeze([0.25, 1.00]),
    openingHookBias: Object.freeze([0.25, 1.00]),
    trafficAvoidanceBias: Object.freeze([0.25, 1.00]),
    predictiveSafetyBias: Object.freeze([0.25, 1.00]),
});

function scaleProfileField(baseProfile, field, offset, direction) {
    const bounds = HEURISTIC_PROFILE_FIELD_BOUNDS[field];
    const value = Number(baseProfile[field]) * (1 + direction * offset * 0.3);
    return Math.max(bounds[0], Math.min(bounds[1], value));
}

export function resolveEffectiveHeuristicProfile(profileName, tuning = null) {
    const normalizedName = normalizeProfileName(profileName);
    const baseProfile = HEURISTIC_PROFILES[normalizedName];
    const normalizedTuning = normalizeBotHeuristicProfileTuning(tuning);
    if (isNeutralBotHeuristicProfileTuning(normalizedTuning)) return baseProfile;

    const aggressionOffset = toBotHeuristicTuningOffset(normalizedTuning.aggression);
    const survivalOffset = toBotHeuristicTuningOffset(normalizedTuning.survivalFocus);
    return Object.freeze({
        retreatVitality: scaleProfileField(baseProfile, 'retreatVitality', survivalOffset, 1),
        retreatPressure: scaleProfileField(baseProfile, 'retreatPressure', survivalOffset, -1),
        boostBias: scaleProfileField(baseProfile, 'boostBias', aggressionOffset, 1),
        defensiveItemThresholdScale: scaleProfileField(baseProfile, 'defensiveItemThresholdScale', survivalOffset, -1),
        offensiveItemThresholdScale: scaleProfileField(baseProfile, 'offensiveItemThresholdScale', aggressionOffset, -1),
        attackWindow: scaleProfileField(baseProfile, 'attackWindow', aggressionOffset, 1),
        safetyDistance: scaleProfileField(baseProfile, 'safetyDistance', survivalOffset, 1),
        preferredRange: scaleProfileField(baseProfile, 'preferredRange', aggressionOffset, -1),
        strafeDistance: scaleProfileField(baseProfile, 'strafeDistance', aggressionOffset, -1),
        escapeLateralBias: baseProfile.escapeLateralBias,
        attackCutoffBias: baseProfile.attackCutoffBias,
        finisherBias: baseProfile.finisherBias,
        openingFanoutBias: baseProfile.openingFanoutBias,
        opportunistBias: baseProfile.opportunistBias,
        openingHookBias: baseProfile.openingHookBias,
        trafficAvoidanceBias: baseProfile.trafficAvoidanceBias,
        predictiveSafetyBias: baseProfile.predictiveSafetyBias,
    });
}

export const HEURISTIC_DIFFICULTIES = Object.freeze({
    easy: Object.freeze({
        attackWindowScale: 0.86,
        aimDot: 0.7,
        itemThresholdScale: 1.1,
        tacticalLeadScale: 0.72,
        tacticalCommitSeconds: 0.48,
    }),
    normal: Object.freeze({
        attackWindowScale: 1,
        aimDot: 0.6,
        itemThresholdScale: 1,
        tacticalLeadScale: 1,
        tacticalCommitSeconds: 0.64,
    }),
    hard: Object.freeze({
        attackWindowScale: 1.12,
        aimDot: 0.52,
        itemThresholdScale: 0.9,
        tacticalLeadScale: 1.24,
        tacticalCommitSeconds: 0.82,
    }),
});

export function normalizeProfileName(profileName) {
    const normalized = String(profileName || '').trim().toLowerCase();
    if (HEURISTIC_PROFILES[normalized]) return normalized;
    return PROFILE_ALIASES[normalized] || PROFILE_NAMES.BALANCED;
}

export function normalizeDifficultyName(difficultyName) {
    const normalized = String(difficultyName || '').trim().toLowerCase();
    if (HEURISTIC_DIFFICULTIES[normalized]) return normalized;
    return DIFFICULTY_ALIASES[normalized] || 'normal';
}

export function resolveStableStrafeRight(player) {
    return (resolveProgressPlayerIndex(player) & 1) === 0;
}

export function readObservationValue(observation, index, fallback = 0) {
    if (!observation || typeof observation.length !== 'number') return fallback;
    const value = Number(observation[index]);
    return Number.isFinite(value) ? value : fallback;
}

export function hasYaw(input) {
    return input.yawLeft === true || input.yawRight === true || Math.abs(Number(input.yawAxis) || 0) > 0.0001;
}

export function resetInput(input) {
    input.pitchAxis = undefined;
    input.yawAxis = undefined;
    input.rollAxis = undefined;
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
    input.shootRocket = false;
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
