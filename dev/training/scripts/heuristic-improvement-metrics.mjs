export function createHeuristicLifeTracker() {
    const completedSeconds = new Map();
    const completedLives = new Map();

    function elapsedSinceSpawn(player, nowSeconds) {
        const spawnSeconds = Number(player?.fightSpawnedAtSeconds);
        return Math.max(0, nowSeconds - (Number.isFinite(spawnSeconds) ? spawnSeconds : 0));
    }

    return {
        recordDeath(player, nowSeconds) {
            const index = player?.index;
            if (!Number.isInteger(index)) return;
            completedSeconds.set(index, (completedSeconds.get(index) || 0) + elapsedSinceSpawn(player, nowSeconds));
            completedLives.set(index, (completedLives.get(index) || 0) + 1);
        },
        lifeTotals(player, nowSeconds) {
            const index = player?.index;
            if (!Number.isInteger(index)) return { seconds: 0, lives: 0 };
            const activeLife = player.alive === true;
            const totalSeconds = (completedSeconds.get(index) || 0)
                + (activeLife ? elapsedSinceSpawn(player, nowSeconds) : 0);
            const lives = (completedLives.get(index) || 0) + (activeLife ? 1 : 0);
            return { seconds: totalSeconds, lives };
        },
        averageLifeSeconds(player, nowSeconds) {
            const { seconds, lives } = this.lifeTotals(player, nowSeconds);
            return lives > 0 ? seconds / lives : 0;
        },
    };
}

const SAFETY_STATES = new Set(['evade', 'recover']);
// A candidate may not drift further into evasion than the profile it replaces.
const SAFETY_SHARE_TOLERANCE = 0.03;

export function createHeuristicEngagementTracker() {
    const rows = new Map();
    return {
        record(playerIndex, action, safetyState) {
            let row = rows.get(playerIndex);
            if (!row) rows.set(playerIndex, row = { updates: 0, safetyUpdates: 0, shots: 0 });
            row.updates += 1;
            if (SAFETY_STATES.has(safetyState)) row.safetyUpdates += 1;
            if (action?.shootMG || action?.shootRocket || action?.shootItem) row.shots += 1;
        },
        totals(playerIndex) {
            const row = rows.get(playerIndex);
            return row ? { ...row } : { updates: 0, safetyUpdates: 0, shots: 0 };
        },
    };
}

export function retainsHeuristicEngagement(candidate, reference) {
    return Number(candidate?.candidateSafetyShare) <= Number(reference?.candidateSafetyShare) + SAFETY_SHARE_TOLERANCE;
}
