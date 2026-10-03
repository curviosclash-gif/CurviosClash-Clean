import { DEMOLITION_RUN_TYPE, DEMOLITION_WEAPON_RULES } from '../shared/contracts/DemolitionContract.js';

const DEMOLITION_CONFIG_BY_STRATEGY = new WeakMap();

export function createDemolitionPickupConfig(config) {
    if (!config?.HUNT?.ROCKET_TIERS) return null;
    return {
        ...config,
        HUNT: {
            ...config.HUNT,
            ROCKET_TIERS: {
                ...config.HUNT.ROCKET_TIERS,
                HEAVY: { ...config.HUNT.ROCKET_TIERS.HEAVY, spawnChance: DEMOLITION_WEAPON_RULES.heavyRocketChance },
                MEGA: { ...config.HUNT.ROCKET_TIERS.MEGA, spawnChance: DEMOLITION_WEAPON_RULES.megaRocketChance },
            },
        },
    };
}

export function resolveArcadeHuntSpawnType(huntCombat, runType, spawnableTypes, config, context) {
    if (!huntCombat) return null;
    if (runType !== DEMOLITION_RUN_TYPE) {
        return huntCombat.resolveSpawnType(spawnableTypes, config, context);
    }
    const cached = DEMOLITION_CONFIG_BY_STRATEGY.get(huntCombat);
    const resolved = cached?.source === config ? cached.value : createDemolitionPickupConfig(config);
    if (cached?.source !== config) DEMOLITION_CONFIG_BY_STRATEGY.set(huntCombat, { source: config, value: resolved });
    return huntCombat.resolveSpawnType(spawnableTypes, resolved || config, context);
}
