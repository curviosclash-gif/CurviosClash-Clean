import {
    HEALTH_RATIO,
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from '../observation/ObservationSchemaV1.js';
import { clamp01 } from '../../../utils/MathOps.js';

function clampSigned(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= -1) return -1;
    if (numeric >= 1) return 1;
    return numeric;
}

export function toBoundedInt(value, fallback, minValue = 0, maxValue = Number.MAX_SAFE_INTEGER) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minValue, Math.min(maxValue, Math.trunc(numeric)));
}

export function buildSyntheticPlayerState(observation, context = {}) {
    const healthRatio = clamp01(observation[HEALTH_RATIO], 1);
    const shieldRatio = clamp01(observation[2], 0);
    const inventoryRatio = clamp01(observation[15], 0);
    const maxHp = 100;
    const maxShieldHp = 100;
    return {
        hp: Math.max(1, Math.round(maxHp * healthRatio)),
        maxHp,
        shieldHp: Math.max(0, Math.round(maxShieldHp * shieldRatio)),
        maxShieldHp,
        inventoryLength: Math.max(1, Math.round(inventoryRatio * 5) || context.inventoryLength || 1),
    };
}

export function resolveEnvironmentStepMetadata(context = {}) {
    const observation = Array.isArray(context.observation) ? context.observation : [];
    const pressure = clamp01(observation[PRESSURE_LEVEL], 0);
    const openness = clamp01(observation[LOCAL_OPENNESS_RATIO], 1);
    const wallFront = clamp01(observation[WALL_DISTANCE_FRONT], 1);
    const targetAlignment = clampSigned(observation[TARGET_ALIGNMENT], 0);
    const targetDistanceRatio = clamp01(observation[TARGET_DISTANCE_RATIO], 1);
    const targetInFront = Number(observation[TARGET_IN_FRONT]) >= 0.5;
    const healthRatio = clamp01(observation[HEALTH_RATIO], 1);
    const runtimeNear = context.environmentProfile === 'runtime-near';
    const portalActive = runtimeNear && ((context.stepIndex + context.seed) % 5 === 0);
    const gateActive = runtimeNear && ((context.stepIndex + context.seed + context.mode.length) % 7 === 0);
    const itemValue = clamp01(
        clamp01(observation[15], 0) * 0.72
        + (1 - healthRatio) * 0.28
    );
    const itemUrgency = clamp01(itemValue * (0.55 + pressure * 0.45));
    const recoveryActive = runtimeNear && (
        pressure >= 0.72
        || wallFront <= 0.24
        || Number(observation[PROJECTILE_THREAT]) >= 0.5
    );
    const intent = recoveryActive
        ? 'evade'
        : (portalActive && pressure < 0.48 ? 'portal' : (targetInFront && pressure < 0.62 ? 'combat' : 'chase'));
    return {
        environmentProfile: runtimeNear ? 'runtime-near' : 'synthetic-smoke',
        runtimeNear,
        portal: {
            active: portalActive,
            alignment: portalActive ? targetAlignment : 0,
            risk: portalActive ? clamp01((1 - openness) * 0.42 + pressure * 0.58) : 0,
        },
        gate: {
            active: gateActive,
            alignment: gateActive ? clampSigned((openness * 2) - 1, 0) : 0,
            risk: gateActive ? clamp01((1 - openness) * 0.5 + pressure * 0.5) : 0,
        },
        item: {
            value: itemValue,
            urgency: itemUrgency,
        },
        recovery: {
            active: recoveryActive,
            severity: recoveryActive ? clamp01(Math.max(pressure, 1 - wallFront)) : 0,
        },
        intent,
        threatSource: {
            pressure,
            openness,
            targetDistanceRatio,
        },
    };
}

export function buildLearnProfileAction(context) {
    const inventoryLength = Math.max(1, toBoundedInt(context.inventoryLength, 1, 1, 20));
    const yawSample = context.rng();
    const yawLeft = yawSample >= 0.52;
    const yawRight = !yawLeft && yawSample < 0.18;
    const shootItem = context.rng() > 0.86;
    const itemIndex = shootItem
        ? Math.floor(context.rng() * inventoryLength)
        : -1;
    return {
        yawLeft,
        yawRight,
        boost: context.rng() > 0.58,
        shootMG: context.mode === 'hunt' && context.rng() > 0.7,
        shootItem,
        shootItemIndex: itemIndex,
        useItem: shootItem ? itemIndex : -1,
    };
}
