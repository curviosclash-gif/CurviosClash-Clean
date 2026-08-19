export function clearProjectilesForOwner(system, owner) {
    let removed = 0;
    for (let index = system.projectiles.length - 1; index >= 0; index -= 1) {
        if (system.projectiles[index]?.owner !== owner) continue;
        system._removeProjectileAt(index);
        removed += 1;
    }
    system._rocketTrailSystem.clearOwner(owner);
    return removed;
}

export function clearProjectilesInBounds(system, minX, maxX, minZ, maxZ) {
    let removed = 0;
    for (let index = system.projectiles.length - 1; index >= 0; index -= 1) {
        const position = system.projectiles[index]?.position;
        if (!position || position.x < minX || position.x > maxX
            || position.z < minZ || position.z > maxZ) continue;
        system._removeProjectileAt(index);
        removed += 1;
    }
    return removed;
}
