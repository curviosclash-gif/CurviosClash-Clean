/**
 * What a destroyed tank leaves behind (E19): one rocket pickup where it stood, drawn from its loot
 * table on the seeded round generator, and a tally for whoever destroyed it. The tally rides the
 * scoreboard rows like intercepts do, so arcade XP and the post-match statistics can read it
 * without a second channel. A destroyed tank is not a kill: it stays out of the kill count.
 */

/**
 * Picks one entry of `loot` ({ type: chance }) with `roll` in [0, 1). Chances are relative, so a
 * table that does not add up to 1 still works; without a roll the most likely type wins, which
 * keeps a round without a seeded generator reproducible.
 */
export function pickMapUnitLoot(loot, roll = null) {
    const entries = Object.entries(loot || {}).filter(([, chance]) => Number(chance) > 0);
    if (entries.length === 0) return '';
    if (!Number.isFinite(roll)) {
        return entries.reduce((best, entry) => (Number(entry[1]) > Number(best[1]) ? entry : best))[0];
    }
    const total = entries.reduce((sum, [, chance]) => sum + Number(chance), 0);
    let threshold = Math.max(0, Math.min(0.999999, roll)) * total;
    for (const [type, chance] of entries) {
        threshold -= Number(chance);
        if (threshold < 0) return type;
    }
    return entries[entries.length - 1][0];
}

function nextSeededRoll(strategy) {
    const next = strategy?.runtimeRng?.next;
    if (typeof next !== 'function') return null;
    const value = Number(next());
    return Number.isFinite(value) ? value : null;
}

export function rewardMapUnitDestruction(system, unit, sourcePlayer) {
    const owner = system.entityManager;
    const guaranteed = Array.isArray(unit.definition.guaranteedLoot) ? unit.definition.guaranteedLoot : [];
    const lootCount = Math.max(1, Math.trunc(Number(unit.definition.lootCount) || 1));
    for (let index = 0; index < lootCount; index += 1) {
        const type = guaranteed[index]
            || pickMapUnitLoot(unit.definition.loot, nextSeededRoll(owner?.gameModeStrategy));
        if (!type) continue;
        owner?.powerupManager?.spawnAtAnchor?.({
            type,
            x: unit.groundPosition.x,
            y: unit.position.y,
            z: unit.groundPosition.z,
            ownerId: `map-unit:${unit.id}:${unit.deaths}${lootCount > 1 ? `:${index + 1}` : ''}`,
        });
    }
    const index = sourcePlayer?.index;
    if (!Number.isInteger(index) || index < 0) return;
    owner?._huntScoring?.registerUnitDestroyed?.(index, unit.definition.kind);
    if (sourcePlayer.isBot !== true) {
        const message = unit.definition.kind === 'boss' ? 'Boss besiegt'
            : (unit.definition.kind === 'creature' ? 'Kreatur besiegt' : 'Panzer zerstört');
        owner?._notifyPlayerFeedback?.(sourcePlayer, message);
    }
}
