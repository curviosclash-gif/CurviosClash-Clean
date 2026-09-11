export function resetEndlessBotRuntimeIdentity(player) {
    if (!player) return;
    player.endlessForcedRetreat = false;
    player.endlessRetreatReason = '';
    player.endlessDamageMultiplier = 1;
    player.endlessActivationGeneration = 0;
    player.endlessBotSlot = -1;
    player.endlessRunId = '';
    player.endlessWaveNumber = 0;
    player.endlessDifficulty = '';
}

export function clearEndlessBotRuntimeIdentity(player) {
    resetEndlessBotRuntimeIdentity(player);
    if (!player) return;
    player.scenarioRole = '';
    player.isEndlessElite = false;
}
