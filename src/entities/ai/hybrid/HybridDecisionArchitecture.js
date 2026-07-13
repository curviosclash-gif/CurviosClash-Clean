// ============================================
// HybridDecisionArchitecture.js - shared safety/intent/control resolver for runtime and trainer paths
// ============================================

import {
    HEALTH_RATIO,
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SHIELD_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../observation/ObservationSchemaV1.js';
import {
    DEAD_END_RISK,
    EXIT_QUALITY,
    GATE_RISK,
    INTENT_CHASE_PRIOR,
    INTENT_COMBAT_PRIOR,
    INTENT_EVADE_PRIOR,
    INTENT_ITEM_PRIOR,
    INTENT_PORTAL_PRIOR,
    ITEM_URGENCY,
    OPPONENT_PRESSURE,
    PORTAL_RISK,
    RECOVERY_ACTIVE,
    SHIELD_BREAK_RISK,
    THREAT_HORIZON,
} from '../observation/ObservationSchemaV2.js';

export const HYBRID_DECISION_ARCHITECTURE_VERSION = 'v80-hybrid-decision-v1';
export const HYBRID_INTENT_TYPES = Object.freeze({
    STABILIZE: 'stabilize',
    EVADE: 'evade',
    RECOVER: 'recover',
    CHASE: 'chase',
    PORTAL: 'portal',
    ITEM_USE: 'item-use',
    COMBAT: 'combat',
});

const ACTION_TEMPLATE = Object.freeze({
    yawLeft: false,
    yawRight: false,
    pitchUp: false,
    pitchDown: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    shootMG: false,
    shootItem: false,
    shootItemIndex: -1,
    useItem: -1,
    dropItem: false,
    nextItem: false,
});

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value, fallback = 0) {
    return clamp(toFiniteNumber(value, fallback), 0, 1);
}

function clampSigned(value, fallback = 0) {
    return clamp(toFiniteNumber(value, fallback), -1, 1);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeHybridIntent(value, fallback = HYBRID_INTENT_TYPES.STABILIZE) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    switch (normalized) {
        case 'evade':
            return HYBRID_INTENT_TYPES.EVADE;
        case 'recover':
            return HYBRID_INTENT_TYPES.RECOVER;
        case 'portal':
        case 'take-portal':
            return HYBRID_INTENT_TYPES.PORTAL;
        case 'item-use':
        case 'use-item':
            return HYBRID_INTENT_TYPES.ITEM_USE;
        case 'combat':
        case 'engage':
            return HYBRID_INTENT_TYPES.COMBAT;
        case 'chase':
        case 'reposition':
            return HYBRID_INTENT_TYPES.CHASE;
        default:
            return fallback;
    }
}

function cloneAction(action) {
    const source = action && typeof action === 'object' ? action : {};
    return {
        ...ACTION_TEMPLATE,
        ...source,
    };
}

function clearCombatIntent(action) {
    action.boost = false;
    action.shootMG = false;
    action.shootItem = false;
    action.shootItemIndex = -1;
    action.dropItem = false;
    action.nextItem = false;
}

function clearItemIntent(action) {
    action.useItem = -1;
    action.shootItem = false;
    action.shootItemIndex = -1;
    action.dropItem = false;
    action.nextItem = false;
}

function setSteering(action, yawDirection, pitchDirection, planarMode) {
    action.yawLeft = yawDirection < 0;
    action.yawRight = yawDirection > 0;
    if (planarMode) {
        action.pitchUp = false;
        action.pitchDown = false;
        action.rollLeft = false;
        action.rollRight = false;
        return;
    }
    action.pitchUp = pitchDirection > 0;
    action.pitchDown = pitchDirection < 0;
}

function resolveSafeYaw(profile) {
    const sideDelta = profile.wallRight - profile.wallLeft;
    if (Math.abs(sideDelta) > 0.03) {
        return sideDelta > 0 ? 1 : -1;
    }
    return profile.targetAlignment >= 0 ? -1 : 1;
}

function resolveSafePitch(profile, planarMode) {
    if (planarMode) return 0;
    const verticalDelta = profile.wallUp - profile.wallDown;
    if (Math.abs(verticalDelta) > 0.04) {
        return verticalDelta > 0 ? 1 : -1;
    }
    return profile.projectileThreat ? 1 : 0;
}

function getObservationMetric(observation, index, fallback = 0) {
    if (!Array.isArray(observation)) return fallback;
    return toFiniteNumber(observation[index], fallback);
}

function resolveProfile(observation, options = {}) {
    const player = options?.player && typeof options.player === 'object' ? options.player : null;
    const details = options?.observationDetails && typeof options.observationDetails === 'object'
        ? options.observationDetails
        : {};
    const healthRatio = (() => {
        const hp = Number(player?.hp);
        const maxHp = Number(player?.maxHp);
        if (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) {
            return clamp01(hp / maxHp, 1);
        }
        return clamp01(getObservationMetric(observation, HEALTH_RATIO, 1), 1);
    })();
    const shieldRatio = (() => {
        const shieldHp = Number(player?.shieldHp ?? player?.shieldHP);
        const maxShieldHp = Number(player?.maxShieldHp);
        if (Number.isFinite(shieldHp) && Number.isFinite(maxShieldHp) && maxShieldHp > 0) {
            return clamp01(shieldHp / maxShieldHp, 0);
        }
        return clamp01(getObservationMetric(observation, SHIELD_RATIO, 0), 0);
    })();
    const wallFront = clamp01(getObservationMetric(observation, WALL_DISTANCE_FRONT, 1), 1);
    const wallLeft = clamp01(getObservationMetric(observation, WALL_DISTANCE_LEFT, 1), 1);
    const wallRight = clamp01(getObservationMetric(observation, WALL_DISTANCE_RIGHT, 1), 1);
    const wallUp = clamp01(getObservationMetric(observation, WALL_DISTANCE_UP, 1), 1);
    const wallDown = clamp01(getObservationMetric(observation, WALL_DISTANCE_DOWN, 1), 1);
    const pressureLevel = clamp01(getObservationMetric(observation, PRESSURE_LEVEL, 0), 0);
    const openness = clamp01(getObservationMetric(observation, LOCAL_OPENNESS_RATIO, 1), 1);
    const projectileThreat = clamp01(getObservationMetric(observation, PROJECTILE_THREAT, 0), 0) >= 0.5;
    const targetDistanceRatio = clamp01(getObservationMetric(observation, TARGET_DISTANCE_RATIO, 1), 1);
    const targetInFront = clamp01(getObservationMetric(observation, TARGET_IN_FRONT, 0), 0) >= 0.5;
    const targetAlignment = clampSigned(getObservationMetric(observation, TARGET_ALIGNMENT, 0), 0);
    const threatHorizon = clamp01(
        getObservationMetric(
            observation,
            THREAT_HORIZON,
            Math.max(pressureLevel, projectileThreat ? 0.96 : 0, 1 - wallFront)
        ),
        pressureLevel
    );
    const deadEndRisk = clamp01(
        getObservationMetric(
            observation,
            DEAD_END_RISK,
            Math.max(1 - openness, wallFront <= 0.18 ? 1 : 0)
        ),
        0
    );
    const exitQuality = clamp01(
        getObservationMetric(
            observation,
            EXIT_QUALITY,
            Math.max(wallFront, Math.max(wallLeft, wallRight)) * 0.6 + openness * 0.4
        ),
        0.5
    );
    const opponentPressure = clamp01(
        getObservationMetric(
            observation,
            OPPONENT_PRESSURE,
            targetInFront ? (1 - targetDistanceRatio) * 0.7 : pressureLevel * 0.25
        ),
        0
    );
    const itemUrgency = clamp01(getObservationMetric(observation, ITEM_URGENCY, details?.item?.urgency ?? 0), 0);
    const shieldBreakRisk = clamp01(getObservationMetric(observation, SHIELD_BREAK_RISK, threatHorizon * (1 - shieldRatio)), 0);
    const portalRisk = clamp01(getObservationMetric(observation, PORTAL_RISK, details?.portal?.risk ?? 0), 0);
    const gateRisk = clamp01(getObservationMetric(observation, GATE_RISK, details?.gate?.risk ?? 0), 0);
    const recoveryActive = clamp01(getObservationMetric(observation, RECOVERY_ACTIVE, details?.recovery?.active ? 1 : 0), 0) >= 0.5;
    const vitalityRatio = clamp01(healthRatio * 0.76 + shieldRatio * 0.24, healthRatio);
    const priors = {
        evade: clamp01(getObservationMetric(observation, INTENT_EVADE_PRIOR, threatHorizon), threatHorizon),
        chase: clamp01(getObservationMetric(observation, INTENT_CHASE_PRIOR, opponentPressure), opponentPressure),
        portal: clamp01(getObservationMetric(observation, INTENT_PORTAL_PRIOR, Math.max(0, 1 - portalRisk) * 0.35), 0),
        item: clamp01(getObservationMetric(observation, INTENT_ITEM_PRIOR, itemUrgency), itemUrgency),
        combat: clamp01(getObservationMetric(observation, INTENT_COMBAT_PRIOR, targetInFront ? 0.5 : 0), 0),
    };
    const collisionRisk = clamp01(
        Math.max(
            1 - wallFront,
            pressureLevel * 0.9,
            projectileThreat ? 0.95 : 0,
            deadEndRisk * 0.85,
            shieldBreakRisk * 0.72
        )
    );
    return {
        healthRatio,
        shieldRatio,
        vitalityRatio,
        wallFront,
        wallLeft,
        wallRight,
        wallUp,
        wallDown,
        pressureLevel,
        openness,
        projectileThreat,
        targetDistanceRatio,
        targetInFront,
        targetAlignment,
        threatHorizon,
        deadEndRisk,
        exitQuality,
        opponentPressure,
        itemUrgency,
        shieldBreakRisk,
        portalRisk,
        gateRisk,
        recoveryActive,
        collisionRisk,
        priors,
    };
}

function inferIntentFromAction(action) {
    if (!action || typeof action !== 'object') {
        return HYBRID_INTENT_TYPES.STABILIZE;
    }
    if (action.shootMG || action.shootItem) return HYBRID_INTENT_TYPES.COMBAT;
    if (Number.isInteger(action.useItem) && action.useItem >= 0) return HYBRID_INTENT_TYPES.ITEM_USE;
    if (action.boost) return HYBRID_INTENT_TYPES.CHASE;
    if (action.yawLeft || action.yawRight || action.pitchUp || action.pitchDown) return HYBRID_INTENT_TYPES.EVADE;
    return HYBRID_INTENT_TYPES.STABILIZE;
}

function inferFallbackIntent(profile) {
    if (profile.threatHorizon >= 0.82 || profile.deadEndRisk >= 0.8 || profile.projectileThreat) {
        return profile.vitalityRatio <= 0.34 || profile.recoveryActive
            ? HYBRID_INTENT_TYPES.RECOVER
            : HYBRID_INTENT_TYPES.EVADE;
    }
    const candidates = [
        { intent: HYBRID_INTENT_TYPES.PORTAL, score: profile.priors.portal * (1 - profile.portalRisk) },
        { intent: HYBRID_INTENT_TYPES.ITEM_USE, score: profile.priors.item * (1 - profile.threatHorizon * 0.5) },
        { intent: HYBRID_INTENT_TYPES.COMBAT, score: profile.priors.combat * (1 - profile.threatHorizon * 0.8) },
        { intent: HYBRID_INTENT_TYPES.CHASE, score: profile.priors.chase * (1 - profile.threatHorizon * 0.45) },
        { intent: HYBRID_INTENT_TYPES.EVADE, score: profile.priors.evade },
    ].sort((left, right) => right.score - left.score);
    return candidates[0]?.intent || HYBRID_INTENT_TYPES.STABILIZE;
}

export function resolveHybridDecision(proposedAction, options = {}) {
    const action = cloneAction(proposedAction);
    const planarMode = options?.planarMode === true;
    const profile = resolveProfile(options.observation, options);
    const requestedIntent = normalizeHybridIntent(
        options?.intent || options?.actionMetadata?.intent || inferIntentFromAction(action),
        inferFallbackIntent(profile)
    );
    let appliedIntent = requestedIntent;

    const hardSafetyVeto = (
        profile.threatHorizon >= 0.88
        || profile.deadEndRisk >= 0.86
        || profile.collisionRisk >= 0.88
        || profile.projectileThreat
        || (profile.vitalityRatio <= 0.3 && profile.threatHorizon >= 0.7)
    );
    const portalVeto = requestedIntent === HYBRID_INTENT_TYPES.PORTAL
        && (profile.portalRisk >= 0.58 || profile.exitQuality <= 0.38);
    const combatVeto = requestedIntent === HYBRID_INTENT_TYPES.COMBAT
        && (profile.threatHorizon >= 0.7 || profile.shieldBreakRisk >= 0.74 || !profile.targetInFront);
    const itemVeto = requestedIntent === HYBRID_INTENT_TYPES.ITEM_USE
        && (profile.itemUrgency < 0.42 || profile.threatHorizon >= 0.76);

    if (hardSafetyVeto) {
        appliedIntent = profile.vitalityRatio <= 0.35
            ? HYBRID_INTENT_TYPES.RECOVER
            : HYBRID_INTENT_TYPES.EVADE;
    } else if (portalVeto) {
        appliedIntent = HYBRID_INTENT_TYPES.EVADE;
    } else if (combatVeto) {
        appliedIntent = profile.opponentPressure >= 0.42
            ? HYBRID_INTENT_TYPES.CHASE
            : HYBRID_INTENT_TYPES.STABILIZE;
    } else if (itemVeto) {
        appliedIntent = profile.threatHorizon >= 0.62
            ? HYBRID_INTENT_TYPES.EVADE
            : HYBRID_INTENT_TYPES.STABILIZE;
    }

    const safeYaw = resolveSafeYaw(profile);
    const safePitch = resolveSafePitch(profile, planarMode);
    let steeringMode = 'proposed';
    let combatAllowed = true;
    let itemAllowed = true;
    let boostAllowed = true;

    if (appliedIntent === HYBRID_INTENT_TYPES.EVADE || appliedIntent === HYBRID_INTENT_TYPES.RECOVER) {
        steeringMode = 'safety-evade';
        setSteering(action, safeYaw, safePitch, planarMode);
        clearCombatIntent(action);
        clearItemIntent(action);
        boostAllowed = false;
        combatAllowed = false;
        itemAllowed = false;
    } else if (appliedIntent === HYBRID_INTENT_TYPES.PORTAL) {
        combatAllowed = profile.portalRisk < 0.42 && profile.threatHorizon < 0.55;
        itemAllowed = profile.portalRisk < 0.55;
        boostAllowed = profile.exitQuality > 0.55 && profile.portalRisk < 0.35;
        if (!combatAllowed) clearCombatIntent(action);
        if (!itemAllowed) clearItemIntent(action);
        action.boost = boostAllowed && action.boost === true;
    } else if (appliedIntent === HYBRID_INTENT_TYPES.ITEM_USE) {
        combatAllowed = profile.threatHorizon < 0.58;
        itemAllowed = profile.itemUrgency >= 0.42;
        boostAllowed = profile.exitQuality > 0.48 && profile.threatHorizon < 0.5;
        if (!combatAllowed) clearCombatIntent(action);
        if (!itemAllowed) clearItemIntent(action);
        action.boost = boostAllowed && action.boost === true;
    } else if (appliedIntent === HYBRID_INTENT_TYPES.COMBAT) {
        combatAllowed = !combatVeto;
        itemAllowed = profile.itemUrgency >= 0.58 && profile.threatHorizon < 0.45;
        boostAllowed = profile.exitQuality > 0.68 && profile.threatHorizon < 0.4;
        if (!combatAllowed) clearCombatIntent(action);
        if (!itemAllowed) clearItemIntent(action);
        if (!profile.targetInFront || Math.abs(profile.targetAlignment) > 0.42) {
            steeringMode = 'combat-correct';
            setSteering(action, profile.targetAlignment >= 0 ? 1 : -1, 0, planarMode);
        }
        action.boost = boostAllowed && action.boost === true;
    } else if (appliedIntent === HYBRID_INTENT_TYPES.CHASE) {
        combatAllowed = profile.opponentPressure > 0.46 && profile.threatHorizon < 0.62;
        itemAllowed = profile.itemUrgency > 0.62 && profile.threatHorizon < 0.42;
        boostAllowed = profile.exitQuality > 0.58 && profile.threatHorizon < 0.52;
        if (!combatAllowed) clearCombatIntent(action);
        if (!itemAllowed) clearItemIntent(action);
        action.boost = boostAllowed;
    } else {
        combatAllowed = profile.targetInFront && profile.threatHorizon < 0.55;
        itemAllowed = profile.itemUrgency > 0.52;
        boostAllowed = profile.exitQuality > 0.62 && profile.threatHorizon < 0.45;
        if (!combatAllowed) clearCombatIntent(action);
        if (!itemAllowed) clearItemIntent(action);
        action.boost = boostAllowed && action.boost === true;
    }

    if ((hardSafetyVeto || profile.collisionRisk >= 0.82) && !(appliedIntent === HYBRID_INTENT_TYPES.EVADE || appliedIntent === HYBRID_INTENT_TYPES.RECOVER)) {
        steeringMode = 'safety-correct';
        setSteering(action, safeYaw, safePitch, planarMode);
        clearCombatIntent(action);
        clearItemIntent(action);
        boostAllowed = false;
        combatAllowed = false;
        itemAllowed = false;
        appliedIntent = HYBRID_INTENT_TYPES.EVADE;
    }

    return {
        action,
        intent: {
            requested: requestedIntent,
            applied: appliedIntent,
            priors: { ...profile.priors },
        },
        safety: {
            vetoActive: hardSafetyVeto || portalVeto || combatVeto || itemVeto,
            collisionRisk: profile.collisionRisk,
            threatHorizon: profile.threatHorizon,
            deadEndRisk: profile.deadEndRisk,
            shieldBreakRisk: profile.shieldBreakRisk,
            projectileThreat: profile.projectileThreat,
            portalVeto,
            combatVeto,
            itemVeto,
        },
        control: {
            steeringMode,
            combatAllowed,
            itemAllowed,
            boostAllowed,
            targetInFront: profile.targetInFront,
            exitQuality: profile.exitQuality,
            portalRisk: profile.portalRisk,
            gateRisk: profile.gateRisk,
        },
    };
}
