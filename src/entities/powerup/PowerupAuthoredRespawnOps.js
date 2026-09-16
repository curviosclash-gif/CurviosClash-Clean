// Fixed authored item anchors: a map with itemRespawnSeconds refills each anchor on its own
// timer after pickup, and itemRespawnOnDeath refills every free anchor when a human dies.

export function buildAnchorKey(anchor, index = 0) {
    if (typeof anchor?.id === 'string' && anchor.id.trim()) {
        return anchor.id.trim();
    }
    return [
        'anchor',
        index,
        Math.round((Number(anchor?.x) || 0) * 1000),
        Math.round((Number(anchor?.y) || 0) * 1000),
        Math.round((Number(anchor?.z) || 0) * 1000),
    ].join(':');
}

export function createAuthoredRespawnClock() {
    return { elapsedSeconds: 0, respawnAtByKey: new Map() };
}

export function resetAuthoredRespawnClock(clock) {
    clock.elapsedSeconds = 0;
    clock.respawnAtByKey.clear();
}

export function resolveFixedItemRespawnSeconds(mapDefinition) {
    const seconds = Number(mapDefinition?.itemRespawnSeconds);
    return seconds > 0 ? seconds : 0;
}

export function scheduleCollectedAnchorRespawn(clock, anchorKey, mapDefinition) {
    const seconds = resolveFixedItemRespawnSeconds(mapDefinition);
    if (seconds > 0) clock.respawnAtByKey.set(anchorKey, clock.elapsedSeconds + seconds);
}

/**
 * Spawns every free anchor whose respawn timer has run out.
 * @param {{ arena?: object, _occupiedAnchorKeys: Set<string>, _spawnFixedAuthoredAnchor: Function }} manager
 * @param {{ elapsedSeconds: number, respawnAtByKey: Map<string, number> }} clock
 * @param {object|null} strategy
 */
export function spawnDueAuthoredAnchors(manager, clock, strategy) {
    const anchors = manager.arena?.getAuthoredItemAnchors?.() || [];
    for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        const key = buildAnchorKey(anchor, index);
        if (manager._occupiedAnchorKeys.has(key)) continue;
        const respawnAt = clock.respawnAtByKey.get(key);
        if (respawnAt !== undefined && clock.elapsedSeconds + 1e-6 < respawnAt) continue;
        clock.respawnAtByKey.delete(key);
        manager._spawnFixedAuthoredAnchor(anchor, key, strategy);
    }
}

/**
 * Refills every free anchor at once and drops the pending timers.
 * @param {{ arena?: object, _occupiedAnchorKeys: Set<string>, _spawnFixedAuthoredAnchor: Function }} manager
 * @param {{ respawnAtByKey: Map<string, number> }} clock
 * @param {object|null} strategy
 */
export function refillAuthoredAnchors(manager, clock, strategy) {
    clock.respawnAtByKey.clear();
    const anchors = manager.arena?.getAuthoredItemAnchors?.() || [];
    for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        const key = buildAnchorKey(anchor, index);
        if (!manager._occupiedAnchorKeys.has(key)) manager._spawnFixedAuthoredAnchor(anchor, key, strategy);
    }
}
