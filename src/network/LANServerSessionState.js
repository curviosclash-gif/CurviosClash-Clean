/**
 * @param {{ status: any, currentState: any, now: number }} options
 * @returns {any}
 */
export function resolveLanServerSessionState({ status, currentState, now }) {
    const existingMembers = Array.isArray(currentState?.members) ? currentState.members : [];
    const serverPlayers = Array.isArray(status.players) ? status.players : [];
    const merged = [];
    const hostPeerId = String(status.hostPeerId || currentState.hostPeerId || 'host').trim() || 'host';

    const ensureMember = (player, fallbackRole = 'client') => {
        const peerId = String(player?.playerId || player?.peerId || player?.id || '').trim();
        if (!peerId) return;
        const existing = existingMembers.find((member) => member.peerId === peerId);
        const resolvedReady = typeof player?.ready === 'boolean'
            ? player.ready === true
            : existing?.ready === true;
        merged.push({
            peerId,
            actorId: String(player?.actorId || existing?.actorId || player?.name || (peerId === hostPeerId ? 'Host' : peerId)).trim(),
            name: String(player?.name || existing?.name || peerId).trim(),
            lobbyName: typeof player?.lobbyName === 'string' ? player.lobbyName : (existing?.lobbyName || ''),
            vehicleId: typeof player?.vehicleId === 'string' ? player.vehicleId : (existing?.vehicleId || ''),
            secondVehicleId: typeof player?.secondVehicleId === 'string' ? player.secondVehicleId : (existing?.secondVehicleId || ''),
            role: peerId === hostPeerId ? 'host' : fallbackRole,
            ready: resolvedReady,
            joinedAt: Number(existing?.joinedAt || now),
            lastSeenAt: now,
        });
    };

    ensureMember({
        playerId: hostPeerId,
        actorId: status.hostActorId,
        name: status.hostName || status.hostActorId || 'Host',
        lobbyName: status.hostLobbyName,
        vehicleId: status.hostVehicleId,
        secondVehicleId: status.hostSecondVehicleId,
        ready: status.hostReady === true,
    }, 'host');
    for (const player of serverPlayers) ensureMember(player, 'client');

    return {
        lobbyCode: status.lobbyCode || currentState.lobbyCode,
        hostPeerId,
        localPlayerCount: status.localPlayerCount,
        playerCount: status.playerCount,
        maxPlayers: Number(status.maxPlayers || currentState.maxPlayers || 10),
        members: merged,
        metadata: status.metadata,
        settingsRevision: status.settingsRevision,
        pendingMatchStart: status?.pendingMatchStart && typeof status.pendingMatchStart === 'object'
            ? { ...status.pendingMatchStart }
            : null,
        updatedAt: now,
        revision: Number(currentState.revision || 0) + 1,
    };
}
