function normalizePeerId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeJoinedAt(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function isHostEntry(entry, hostPeerId) {
    const peerId = normalizePeerId(entry?.peerId || entry?.id || entry?.playerId);
    return entry?.isHost === true
        || entry?.role === 'host'
        || (!!hostPeerId && peerId === hostPeerId)
        || peerId === 'host';
}

function normalizeSlotEntry(entry, {
    hostPeerId = '',
    localPeerId = '',
} = {}) {
    const peerId = normalizePeerId(entry?.peerId || entry?.id || entry?.playerId);
    if (!peerId) return null;
    const isHost = isHostEntry(entry, hostPeerId);
    return {
        peerId,
        id: peerId,
        playerId: peerId,
        name: normalizePeerId(entry?.name || entry?.actorId) || (isHost ? 'Host' : peerId),
        isHost,
        isLocal: entry?.isLocal === true || (!!localPeerId && peerId === localPeerId),
        connected: entry?.connected !== false,
        ready: entry?.ready === true,
        joinedAt: normalizeJoinedAt(entry?.joinedAt),
    };
}

function sortSlotEntries(left, right) {
    if (left.isHost !== right.isHost) return left.isHost ? -1 : 1;
    if (left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
    return left.peerId.localeCompare(right.peerId);
}

function collectLobbyEntries(lobbyState = null) {
    if (!lobbyState || typeof lobbyState !== 'object') return [];
    return Array.isArray(lobbyState.members) ? lobbyState.members : [];
}

function collectSessionEntries(session = null) {
    const sessionPlayers = session?.getPlayers?.();
    return Array.isArray(sessionPlayers) ? sessionPlayers : [];
}

function resolveLocalPeerId({ session = null, lobbyState = null, localPeerId = '' } = {}) {
    return normalizePeerId(localPeerId)
        || normalizePeerId(session?.localPlayerId)
        || normalizePeerId(lobbyState?.peerId)
        || (session?.isHost === true ? normalizePeerId(lobbyState?.hostPeerId) || 'host' : '');
}

function resolveHostPeerId({ session = null, lobbyState = null } = {}) {
    return normalizePeerId(lobbyState?.hostPeerId)
        || (session?.isHost === true ? normalizePeerId(session?.localPlayerId) || 'host' : '')
        || 'host';
}

export function resolveRuntimeNetworkPlayerSlots({
    session = null,
    lobbyState = null,
    localPeerId = '',
} = {}) {
    const resolvedLocalPeerId = resolveLocalPeerId({ session, lobbyState, localPeerId });
    const hostPeerId = resolveHostPeerId({ session, lobbyState });
    const entriesByPeerId = new Map();

    const addEntry = (entry) => {
        const normalized = normalizeSlotEntry(entry, {
            hostPeerId,
            localPeerId: resolvedLocalPeerId,
        });
        if (!normalized) return;
        const existing = entriesByPeerId.get(normalized.peerId);
        entriesByPeerId.set(normalized.peerId, {
            ...(existing || {}),
            ...normalized,
            isHost: normalized.isHost || existing?.isHost === true,
            isLocal: normalized.isLocal || existing?.isLocal === true,
            connected: normalized.connected || existing?.connected === true,
            ready: normalized.ready || existing?.ready === true,
            joinedAt: existing?.joinedAt || normalized.joinedAt,
        });
    };

    for (const member of collectLobbyEntries(lobbyState)) {
        addEntry(member);
    }
    for (const player of collectSessionEntries(session)) {
        addEntry(player);
    }
    if (resolvedLocalPeerId && !entriesByPeerId.has(resolvedLocalPeerId)) {
        addEntry({
            peerId: resolvedLocalPeerId,
            isHost: session?.isHost === true || resolvedLocalPeerId === hostPeerId,
            isLocal: true,
            connected: session?.isConnected !== false,
            ready: true,
        });
    }

    return Array.from(entriesByPeerId.values())
        .sort(sortSlotEntries)
        .map((entry, playerIndex) => ({
            ...entry,
            playerIndex,
        }));
}

export function resolveRuntimeNetworkPlayerSlotContext(facade = null) {
    const session = facade?.session || null;
    const lobbyState = facade?.menuMultiplayerBridge?.getSessionState?.() || null;
    const slots = resolveRuntimeNetworkPlayerSlots({ session, lobbyState });
    const localPeerId = resolveLocalPeerId({ session, lobbyState });
    const localSlot = slots.find((slot) => slot.isLocal)
        || slots.find((slot) => localPeerId && slot.peerId === localPeerId)
        || (session?.isHost === true ? slots.find((slot) => slot.isHost) : null)
        || slots[0]
        || null;

    return {
        slots,
        humanEntityCount: Math.max(1, slots.length || 1),
        localHumanCount: 1,
        localPlayerIndex: Number.isInteger(localSlot?.playerIndex) ? localSlot.playerIndex : 0,
    };
}

export function applyRuntimeNetworkPlayerSlotContext(facade = null) {
    const sessionConfig = facade?.game?.runtimeConfig?.session;
    if (!sessionConfig || sessionConfig.networkEnabled !== true) {
        return null;
    }
    const context = resolveRuntimeNetworkPlayerSlotContext(facade);
    sessionConfig.networkPlayerSlots = context.slots;
    sessionConfig.humanEntityCount = context.humanEntityCount;
    sessionConfig.localHumanCount = context.localHumanCount;
    sessionConfig.localPlayerIndex = context.localPlayerIndex;
    return context;
}
