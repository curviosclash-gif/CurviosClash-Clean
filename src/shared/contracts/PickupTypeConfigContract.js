import { PICKUP_REGISTRY, PICKUP_TYPES } from './PickupRegistryContract.js';

function createPickupTypeConfigEntry(definition) {
    const entry = {
        name: definition.name,
        description: String(definition.description || ''),
        color: definition.color,
        icon: definition.icon,
        duration: Number.isFinite(Number(definition.duration)) ? Number(definition.duration) : 0,
        animationKind: definition.animationKind,
    };
    if (Number.isFinite(Number(definition.multiplier))) {
        entry.multiplier = Number(definition.multiplier);
    }
    if (Number.isFinite(Number(definition.trailWidth))) {
        entry.trailWidth = Number(definition.trailWidth);
    }
    if (Number.isFinite(Number(definition.timeScale))) {
        entry.timeScale = Number(definition.timeScale);
    }
    if (Number.isFinite(Number(definition.damage))) {
        entry.damage = Number(definition.damage);
    }
    if (Number.isFinite(Number(definition.healing))) {
        entry.healing = Number(definition.healing);
    }
    if (Number.isFinite(Number(definition.pickupRadiusMultiplier))) {
        entry.pickupRadiusMultiplier = Number(definition.pickupRadiusMultiplier);
    }
    if (Number.isFinite(Number(definition.pulseRadius))) {
        entry.pulseRadius = Number(definition.pulseRadius);
    }
    if (Number.isFinite(Number(definition.fanProjectiles))) {
        entry.fanProjectiles = Number(definition.fanProjectiles);
    }
    if (definition.allowedModes.length === 1 && definition.allowedModes[0] === 'HUNT') {
        entry.huntOnly = true;
    }
    entry.spawnWeights = definition.spawnWeights;
    return Object.freeze(entry);
}

export function createPickupTypeConfigMap() {
    const configMap = PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = createPickupTypeConfigEntry(PICKUP_REGISTRY[type]);
        return acc;
    }, {});
    return Object.freeze(configMap);
}
