const PICKUP_MODEL_PREFIX = 'pickup_';

export const LEGACY_PICKUP_MODEL_TYPES = Object.freeze([
    'item_arrow', 'item_battery', 'item_box', 'item_capsule', 'item_coin', 'item_crate',
    'item_crystal', 'item_gem', 'item_health', 'item_orb', 'item_pyramid', 'item_ring',
    'item_rocket', 'item_shield', 'item_sphere', 'item_star', 'item_torus',
]);

const LEGACY_PICKUP_MODELS = new Set(LEGACY_PICKUP_MODEL_TYPES);
const ROCKET_PICKUP_TYPES = new Set([
    'ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA', 'ROCKET_GUIDED',
]);

function normalizeLegacyModel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return LEGACY_PICKUP_MODELS.has(normalized) ? normalized : '';
}

export function resolveBlenderPickupModel(pickupType, anchor = null) {
    const type = String(pickupType || '').trim().toUpperCase();
    const explicitModel = normalizeLegacyModel(anchor?.model);
    const typeOverride = normalizeLegacyModel(anchor?.type);
    const override = explicitModel || typeOverride;

    // item_rocket is the historical map shape for every rocket pickup. Preserve the real tier.
    if (override === 'item_rocket' && ROCKET_PICKUP_TYPES.has(type)) {
        return `${PICKUP_MODEL_PREFIX}${type}`;
    }
    if (override) return `${PICKUP_MODEL_PREFIX}${override}`;
    return type ? `${PICKUP_MODEL_PREFIX}${type}` : null;
}

export function resolveLegacyPickupModelUrl(modelType) {
    const normalized = normalizeLegacyModel(modelType);
    if (!normalized) return null;
    return new URL(`../../../assets/items/${normalized}.obj`, import.meta.url).href;
}

export function applyBlenderPickupModel(manager, item, anchor, config, helpers) {
    const cache = manager?._authoredModelCache;
    if (!item || !cache) return;
    const modelIdentifier = resolveBlenderPickupModel(item.type, anchor);
    if (!modelIdentifier) return;
    const authoredItemModel = [anchor?.model, anchor?.type]
        .map((candidate) => String(candidate || '').trim().toLowerCase())
        .find((candidate) => helpers.resolveAuthoredItemModelUrl(candidate)) || '';
    const request = Symbol(modelIdentifier);
    item.authoredModelRequest = request;

    cache.createModel(modelIdentifier, config?.color, {
        authoredItemModel,
        rocketTier: config?.rocketTier,
        fanProjectiles: config?.fanProjectiles,
    }).then((authoredMesh) => {
        if (!authoredMesh) return;
        if (manager._authoredModelCache !== cache || !manager.items.includes(item)
            || item.authoredModelRequest !== request) {
            helpers.disposeMeshMaterials(authoredMesh);
            return;
        }
        const previousMesh = item.mesh;
        const relativeScaleX = previousMesh.scale.x / (Number(item.baseScaleX) || 1);
        const relativeScaleY = previousMesh.scale.y / (Number(item.baseScaleY) || 1);
        const relativeScaleZ = previousMesh.scale.z / (Number(item.baseScaleZ) || 1);
        authoredMesh.position.copy(previousMesh.position);
        authoredMesh.rotation.copy(previousMesh.rotation);
        authoredMesh.visible = previousMesh.visible;
        manager.renderer.removeFromScene(previousMesh);
        helpers.disposeMeshMaterials(previousMesh);
        item.mesh = authoredMesh;
        item.baseScaleX = authoredMesh.scale.x;
        item.baseScaleY = authoredMesh.scale.y;
        item.baseScaleZ = authoredMesh.scale.z;
        authoredMesh.scale.set(
            item.baseScaleX * relativeScaleX,
            item.baseScaleY * relativeScaleY,
            item.baseScaleZ * relativeScaleZ,
        );
        manager.renderer.addToScene(authoredMesh);
    });
}
