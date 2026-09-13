const MAX_BONUS_PCT = 50;

export function resetArcadeEndlessPlayerHealth(huntCombat, player, bonuses) {
    const reset = huntCombat?.resetPlayerHealth?.(player) || null;
    if (!reset || player?.isBot === true) return reset;
    const baseMaxHp = Math.max(1, Number(player.maxHp) || 100);
    const hpBonus = Math.min(
        baseMaxHp * (MAX_BONUS_PCT / 100),
        Math.max(0, Number(bonuses?.maxHpBonus) || 0)
    );
    player.maxHp = baseMaxHp + hpBonus;
    player.hp = player.maxHp;
    return player;
}

export function applyArcadeEndlessSpawnBonuses(huntCombat, player, speedMultiplier) {
    if (!huntCombat || !player) return false;
    huntCombat.applySpawnStatBonuses?.(player);
    if (player.isBot === true) return true;
    if (!Number.isFinite(player._arcadeBaseSpeed)) player._arcadeBaseSpeed = player.baseSpeed;
    player.baseSpeed = player._arcadeBaseSpeed * Math.max(0, Number(speedMultiplier) || 1);
    player.speed = player.baseSpeed;
    return true;
}
