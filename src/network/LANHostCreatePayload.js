export function buildLanHostCreatePayload(options) {
    return {
        maxPlayers: Number(options.maxPlayers || 10), localPlayerCount: options.localPlayerCount,
        actorId: options.actorId,
        name: options.name || options.actorId,
        lobbyName: options.lobbyName, vehicleId: options.vehicleId,
        metadata: options.metadata,
    };
}
