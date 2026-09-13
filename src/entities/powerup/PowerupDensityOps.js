const MAX_SCALED_ITEMS = 100;

// The item setting describes density relative to the 80 x 30 x 80 standard arena.
// Use built bounds so authored map dimensions and the map scale both apply.
export function resolvePowerupFieldLimit(baseAmount, bounds, planarMode = false) {
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) return 0;
    const width = bounds?.maxX - bounds?.minX;
    const depth = bounds?.maxZ - bounds?.minZ;
    const height = planarMode ? 30 : bounds?.maxY - bounds?.minY;
    const validBounds = Number.isFinite(width) && width > 0
        && Number.isFinite(depth) && depth > 0
        && Number.isFinite(height) && height > 0;
    const densityScale = validBounds ? (width / 80) * (depth / 80) * (height / 30) : 1;
    return Math.min(MAX_SCALED_ITEMS, Math.max(1, Math.round(baseAmount * densityScale)));
}

export function resolvePowerupSpawnInterval(powerupConfig, fieldLimit, spawnRateMultiplier = 1) {
    const densityRate = fieldLimit > 0 ? fieldLimit / powerupConfig.MAX_ON_FIELD : 1;
    const modeRate = spawnRateMultiplier > 0 ? spawnRateMultiplier : 1;
    return powerupConfig.SPAWN_INTERVAL / modeRate / densityRate;
}
