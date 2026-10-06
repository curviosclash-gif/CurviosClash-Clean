const MAX_SCALED_ITEMS = 100;

// Authored size of the standard arena. The arena builder multiplies every map size by MAP_SCALE, so
// the built reference is this size times the scale the caller passes in.
const STANDARD_ARENA_SIZE = Object.freeze({ width: 80, height: 30, depth: 80 });

// Calibration: the item setting that fills the built standard arena up to the 100 item cap. It
// equals the default amount (GAMEPLAY_CONFIG_DEFAULTS.POWERUP.MAX_ON_FIELD), so the standard map
// at the default keeps its 100 items. Below it the field grows linearly (4 -> 40 items). At and
// above it the standard map is full, so higher settings only slow the refill down; maps larger
// than the standard arena reach the 100 cap at a proportionally smaller setting.
const ITEM_AMOUNT_FOR_FULL_STANDARD_FIELD = 10;
const ITEMS_PER_SETTING_STEP = MAX_SCALED_ITEMS / ITEM_AMOUNT_FOR_FULL_STANDARD_FIELD;

// The item setting counts relative to the built standard arena: field limit = setting x 10 x the
// volume ratio of the built map to that arena (planar play compares floor area only), capped at
// 100. Bounds are measured as built, so authored map dimensions and the map scale both apply;
// unknown bounds count as the standard arena.
export function resolvePowerupFieldLimit(baseAmount, bounds, planarMode = false, mapScale = 1) {
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) return 0;
    const scale = Number.isFinite(mapScale) && mapScale > 0 ? mapScale : 1;
    const width = bounds?.maxX - bounds?.minX;
    const depth = bounds?.maxZ - bounds?.minZ;
    const height = planarMode ? STANDARD_ARENA_SIZE.height * scale : bounds?.maxY - bounds?.minY;
    const validBounds = Number.isFinite(width) && width > 0
        && Number.isFinite(depth) && depth > 0
        && Number.isFinite(height) && height > 0;
    const densityScale = validBounds
        ? (width / (STANDARD_ARENA_SIZE.width * scale))
            * (depth / (STANDARD_ARENA_SIZE.depth * scale))
            * (height / (STANDARD_ARENA_SIZE.height * scale))
        : 1;
    return Math.min(MAX_SCALED_ITEMS, Math.max(1, Math.round(baseAmount * ITEMS_PER_SETTING_STEP * densityScale)));
}

export function resolvePowerupSpawnInterval(powerupConfig, fieldLimit, spawnRateMultiplier = 1) {
    const densityRate = fieldLimit > 0 ? fieldLimit / powerupConfig.MAX_ON_FIELD : 1;
    const modeRate = spawnRateMultiplier > 0 ? spawnRateMultiplier : 1;
    return powerupConfig.SPAWN_INTERVAL / modeRate / densityRate;
}

// A growing map holds back the anchors of rings that are still sealed: an item there would take a
// field slot while nobody can reach it. Maps that do not grow, and arenas that state no bounds,
// keep every anchor.
export function isAnchorInSealedRing(arena, anchor) {
    const bounds = arena?.currentMapDefinition?.expansion ? arena.bounds : null;
    if (!bounds) return false;
    return anchor.x < bounds.minX || anchor.x > bounds.maxX || anchor.z < bounds.minZ || anchor.z > bounds.maxZ;
}
