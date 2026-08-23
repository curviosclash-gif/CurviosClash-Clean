export function isSingleNodeSession(entityManager) {
    if (!entityManager) return false;
    if (entityManager.runtimeConfig?.session?.networkEnabled === true) return false;
    const humans = Array.isArray(entityManager.humanPlayers) ? entityManager.humanPlayers : [];
    return humans.length === 1;
}

function isHuntMode(entityManager) {
    const mode = entityManager?.activeGameMode
        || entityManager?.gameModeStrategy?.modeType
        || entityManager?.runtimeConfig?.session?.activeGameMode
        || entityManager?.entityRuntimeConfig?.HUNT?.ACTIVE_MODE
        || '';
    return String(mode).trim().toUpperCase() === 'HUNT';
}

export function isPixelCaptureEligible(killcam, allowPendingTerminalCapture = false) {
    if (!isSingleNodeSession(killcam?.entityManager) || !isHuntMode(killcam?.entityManager)) return false;
    if (killcam?.respawnSystem?.isEnabled?.() !== true || killcam?._active) return false;
    return allowPendingTerminalCapture || killcam?._pixelReplayPending == null;
}

export function resolveRespawnDelaySeconds(respawnSystem, player) {
    const directRemaining = respawnSystem?.getRemainingForPlayer?.(player);
    if (Number.isFinite(Number(directRemaining))) {
        return Math.max(0, Number(directRemaining));
    }
    const remaining = respawnSystem?.getRemainingByPlayer?.() || {};
    return Math.max(0, Number(remaining[player?.index]) || 0);
}
