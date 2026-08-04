const SAFE_SPAWN_ATTEMPTS = 12;

function isSpawnPositionSafe(manager, position) {
    if (!position || manager?.arena?.checkCollision?.(position, 4.5)) return false;
    const context = typeof manager.getSafetyContext === 'function' ? manager.getSafetyContext() : null;
    for (const player of context?.players || []) {
        if (player?.alive === false || !player?.position) continue;
        if (player.position.distanceToSquared(position) < 12 * 12) return false;
    }
    for (const item of manager.items || []) {
        if (item?.mesh?.position?.distanceToSquared(position) < 8 * 8) return false;
    }
    for (const portal of manager.arena?.portals || []) {
        if (portal?.posA?.distanceToSquared?.(position) < 10 * 10) return false;
        if (portal?.posB?.distanceToSquared?.(position) < 10 * 10) return false;
    }
    for (const gate of manager.arena?.specialGates || []) {
        if (gate?.pos?.distanceToSquared?.(position) < 8 * 8) return false;
    }
    return !context?.trailSpatialIndex?.checkGlobalCollision?.(position, 4.5, -1, 0, null);
}

export function findSafePowerupPosition(manager, random, level = null) {
    for (let attempt = 0; attempt < SAFE_SPAWN_ATTEMPTS; attempt += 1) {
        const candidate = level != null && Number.isFinite(Number(level)) && manager.arena?.getRandomPositionOnLevel
            ? manager.arena.getRandomPositionOnLevel(Number(level), 8, random)
            : manager.arena?.getRandomPosition?.(8, random);
        if (isSpawnPositionSafe(manager, candidate)) return candidate;
    }
    return null;
}
