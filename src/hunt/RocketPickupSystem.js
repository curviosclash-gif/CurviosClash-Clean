import {
    getRocketPickupTypes,
    isRocketPickupType,
    normalizePickupType,
} from '../entities/PickupRegistry.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

const TIER_BY_ITEM = Object.freeze({
    ROCKET_WEAK: 'WEAK',
    ROCKET_MEDIUM: 'MEDIUM',
    ROCKET_HEAVY: 'HEAVY',
    ROCKET_MEGA: 'MEGA',
});

const ROCKET_WEIGHT_ORDER = Object.freeze([
    Object.freeze({ type: 'ROCKET_WEAK', tier: 'WEAK', fallbackWeight: 0.45 }),
    Object.freeze({ type: 'ROCKET_MEDIUM', tier: 'MEDIUM', fallbackWeight: 0.30 }),
    Object.freeze({ type: 'ROCKET_HEAVY', tier: 'HEAVY', fallbackWeight: 0.18 }),
    Object.freeze({ type: 'ROCKET_MEGA', tier: 'MEGA', fallbackWeight: 0.07 }),
]);

export function normalizeRocketPickupType(type, { fallback = '' } = {}) {
    return normalizePickupType(type, { fallback });
}

export function isRocketTierType(type) {
    return isRocketPickupType(type);
}

export function getRocketTierTypes() {
    return getRocketPickupTypes();
}

export function resolveRocketTierDamage(type, configSource = null) {
    const gameplayConfig = resolveGameplayConfig(configSource);
    const normalized = normalizeRocketPickupType(type);
    const tier = TIER_BY_ITEM[normalized];
    const tierConfig = gameplayConfig.HUNT?.ROCKET_TIERS?.[tier];
    if (tierConfig && Number.isFinite(Number(tierConfig.damage))) {
        return Math.max(1, Number(tierConfig.damage));
    }

    const fallback = gameplayConfig.POWERUP?.TYPES?.[normalized]?.damage;
    return Math.max(1, Number(fallback || 10));
}

export function resolveRocketTrailBlastMeters(type, configSource = null) {
    const gameplayConfig = resolveGameplayConfig(configSource);
    const normalized = normalizeRocketPickupType(type);
    const tier = TIER_BY_ITEM[normalized];
    const tierConfig = gameplayConfig.HUNT?.ROCKET_TIERS?.[tier];
    return Math.max(0, Number(tierConfig?.trailBlastMeters) || 0);
}

/** @deprecated Use resolveRocketTrailBlastMeters instead */
export function resolveRocketTrailBlastRadiusSegments(type) {
    return 0;
}

export function resolveRocketTierSpawnWeights({ allowedTypes = null, tiersConfig = null, configSource = null } = {}) {
    const tiers = tiersConfig || resolveGameplayConfig(configSource).HUNT?.ROCKET_TIERS || {};
    const allowedSet = Array.isArray(allowedTypes) && allowedTypes.length > 0
        ? new Set(
            allowedTypes
                .map((type) => normalizeRocketPickupType(type))
                .filter((type) => isRocketTierType(type))
        )
        : null;

    const weighted = [];
    for (const entry of ROCKET_WEIGHT_ORDER) {
        if (allowedSet && !allowedSet.has(entry.type)) continue;
        const rawWeight = Number(tiers?.[entry.tier]?.spawnChance ?? entry.fallbackWeight);
        weighted.push({
            type: entry.type,
            weight: Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0,
        });
    }
    if (weighted.length === 0) return [];

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
        return weighted.map((entry, index) => ({
            type: entry.type,
            normalizedWeight: index === 0 ? 1 : 0,
            rawWeight: entry.weight,
        }));
    }

    return weighted.map((entry) => ({
        type: entry.type,
        normalizedWeight: entry.weight / total,
        rawWeight: entry.weight,
    }));
}

export function pickWeightedRocketTierType(options = {}) {
    const random = typeof options?.random === 'function' ? options.random : Math.random;
    const weighted = resolveRocketTierSpawnWeights({
        allowedTypes: options?.allowedTypes || null,
        tiersConfig: options?.tiersConfig || null,
        configSource: options?.configSource || null,
    });
    if (weighted.length === 0) return null;

    const randomValue = Number.isFinite(Number(random())) ? Number(random()) : 0;
    const roll = Math.max(0, Math.min(0.999999, randomValue));
    let acc = 0;
    for (const entry of weighted) {
        acc += entry.normalizedWeight;
        if (roll <= acc) {
            return entry.type;
        }
    }
    return weighted[0].type;
}
