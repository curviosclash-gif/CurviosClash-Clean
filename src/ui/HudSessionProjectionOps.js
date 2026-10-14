// Who the local player is and whether the match runs over the network, read from the match
// runtime projection with the live game as fallback.

export function resolveHudLocalPlayerIndex(projection = null) {
    if (Number.isInteger(projection?.localPlayerIndex)) {
        return projection.localPlayerIndex;
    }
    const localSessionPlayer = Array.isArray(projection?.sessionPlayers)
        ? projection.sessionPlayers.find((player) => player?.isLocal === true)
        : null;
    if (Number.isInteger(localSessionPlayer?.playerIndex) && localSessionPlayer.playerIndex >= 0) {
        return localSessionPlayer.playerIndex;
    }
    return 0;
}

export function isHudNetworkSession(projection = null, game = null) {
    if (typeof projection?.isNetworkSession === 'boolean') {
        return projection.isNetworkSession;
    }
    return !!game?.runtimeConfig?.session?.networkEnabled;
}
