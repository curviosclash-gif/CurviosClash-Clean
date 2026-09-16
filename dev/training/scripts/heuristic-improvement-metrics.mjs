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
