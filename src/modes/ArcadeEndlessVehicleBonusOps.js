import { resolveArcadePlayerBuild, resolveArcadeVehicleMaxHp } from './ArcadeVehicleStatOps.js';

const MAX_BONUS_PCT = 50;

// isNormalRun: Paket 1 - normale Arcade-Runs skalieren Leben/Tempo auch für Bots
// nach der Fahrzeugtabelle (kein Hangar-Bonus für Bots); Waffenrennen/Daily bleiben
// beim alten Fixwert (isNormalRun=false/undefined).
export function resetArcadeEndlessPlayerHealth(huntCombat, player, bonuses, isNormalRun = false) {
    const reset = huntCombat?.resetPlayerHealth?.(player) || null;
    if (!reset) return reset;
    const modeBaseMaxHp = Math.max(1, Number(player.maxHp) || 100);
    const baseMaxHp = resolveArcadeVehicleMaxHp(player?.vehicleId, modeBaseMaxHp, isNormalRun, resolveArcadePlayerBuild(player, bonuses)?.maxHpPct);
    if (player?.isBot === true) {
        if (!isNormalRun) return reset;
        player.maxHp = baseMaxHp * (bonuses?.botStrength?.hpFactor || 1);
        player.hp = player.maxHp;
        return player;
    }
    const hpBonus = Math.min(
        baseMaxHp * (MAX_BONUS_PCT / 100),
        Math.max(0, Number(bonuses?.maxHpBonus) || 0)
    );
    player.maxHp = baseMaxHp + hpBonus;
    player.hp = player.maxHp;
    // Fresh spawn value for run upgrades on top (ArenaWavesRuntime consumes it once).
    player._arcadeSpawnMaxHp = player.maxHp;
    return player;
}

export function applyArcadeEndlessSpawnBonuses(huntCombat, player, speedMultiplier, applyToBots = false) {
    if (!huntCombat || !player) return false;
    huntCombat.applySpawnStatBonuses?.(player);
    if (player.isBot === true && !applyToBots) return true;
    if (!Number.isFinite(player._arcadeBaseSpeed)) player._arcadeBaseSpeed = player.baseSpeed;
    player.baseSpeed = player._arcadeBaseSpeed * Math.max(0, Number(speedMultiplier) || 1);
    player.speed = player.baseSpeed;
    return true;
}
