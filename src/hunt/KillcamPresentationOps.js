function trackPresentationObject(entries, object, player = null) {
    if (!object) return;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].object !== object) continue;
        object.visible = false;
        return;
    }
    entries.push({
        object,
        visible: object.visible !== false,
        player,
        playerWasAlive: player?.alive === true,
    });
    object.visible = false;
}

export function hideKillcamLivePresentation(killcam, players = []) {
    const entries = killcam?._presentationEntries;
    if (!Array.isArray(entries)) return;
    for (const player of players) {
        if (!player) continue;
        trackPresentationObject(entries, player?.view?.group, player);
        trackPresentationObject(entries, player?.trail?.mesh);
        trackPresentationObject(entries, player?.trail?.glowMesh);
        trackPresentationObject(entries, player?.trail?.headMesh);
        trackPresentationObject(entries, player?.trail?.glowHeadMesh);
    }
    const projectiles = Array.isArray(killcam?.entityManager?.projectiles)
        ? killcam.entityManager.projectiles
        : [];
    for (let i = 0; i < projectiles.length; i++) {
        trackPresentationObject(entries, projectiles[i]?.mesh);
    }
}

export function restoreKillcamLivePresentation(killcam) {
    const entries = killcam?._presentationEntries;
    if (!Array.isArray(entries)) return;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        try {
            const respawnedPlayer = entry.player
                && entry.playerWasAlive === false
                && entry.player.alive === true;
            entry.object.visible = respawnedPlayer ? true : entry.visible;
        } catch {
            // Best-effort presentation restore during teardown.
        }
    }
    entries.length = 0;
}
