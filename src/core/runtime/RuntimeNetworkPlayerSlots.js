import { normalizeTeamId, resolveBalancedTeamId } from '../../shared/contracts/TeamCombatContract.js';
import { normalizeLanHostLocalPlayerCount } from '../../shared/contracts/RuntimeSessionContract.js';
import { VIEWPORT_LAYOUTS } from '../../shared/contracts/ViewportLayoutContract.js';

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
    const ownerPeerId = normalizePeerId(entry?.ownerPeerId) || peerId;
    return {
        peerId,
        id: peerId,
        playerId: peerId,
        ownerPeerId,
        ownerLocalIndex: Math.max(0, Math.floor(Number(entry?.ownerLocalIndex) || 0)),
        ownerIsHost: entry?.ownerIsHost === true || isHost || ownerPeerId === hostPeerId,
        name: normalizePeerId(entry?.name || entry?.actorId) || (isHost ? 'Host' : peerId),
        isHost,
        isLocal: entry?.isLocal === true || (!!localPeerId && ownerPeerId === localPeerId),
        connected: entry?.connected !== false,
        ready: entry?.ready === true,
        teamId: normalizeTeamId(entry?.teamId),
        joinedAt: normalizeJoinedAt(entry?.joinedAt),
    };
}

function sortSlotEntries(left, right) {
    if (left.ownerIsHost !== right.ownerIsHost) return left.ownerIsHost ? -1 : 1;
    if (left.ownerPeerId === right.ownerPeerId && left.ownerLocalIndex !== right.ownerLocalIndex) {
        return left.ownerLocalIndex - right.ownerLocalIndex;
    }
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

    const addEntry = (entry, fromLobby = false) => {
        const normalized = normalizeSlotEntry(entry, {
            hostPeerId,
            localPeerId: resolvedLocalPeerId,
        });
        if (!normalized) return;
        const existing = entriesByPeerId.get(normalized.peerId);
        // Only the lobby knows the name a player chose; session entries carry transport ids.
        const displayName = existing?.displayName || (fromLobby ? normalizePeerId(entry?.name) : '');
        entriesByPeerId.set(normalized.peerId, {
            ...(existing || {}),
            ...normalized,
            name: existing?.name || normalized.name,
            displayName,
            isHost: normalized.isHost || existing?.isHost === true,
            isLocal: normalized.isLocal || existing?.isLocal === true,
            connected: normalized.connected || existing?.connected === true,
            ready: normalized.ready || existing?.ready === true,
            joinedAt: existing?.joinedAt || normalized.joinedAt,
        });
    };

    const hostLocalPlayerCount = normalizeLanHostLocalPlayerCount(lobbyState?.localPlayerCount, 1);
    for (const member of collectLobbyEntries(lobbyState)) {
        const memberPeerId = normalizePeerId(member?.peerId || member?.id || member?.playerId);
        const memberIsHost = isHostEntry(member, hostPeerId);
        addEntry({
            ...member,
            ownerPeerId: memberPeerId,
            ownerLocalIndex: 0,
            ownerIsHost: memberIsHost,
        }, true);
        if (memberIsHost && hostLocalPlayerCount >= 2) {
            const displayName = normalizePeerId(member?.name || member?.actorId) || 'Host';
            addEntry({
                ...member,
                peerId: `${memberPeerId}::local-2`,
                id: `${memberPeerId}::local-2`,
                playerId: `${memberPeerId}::local-2`,
                ownerPeerId: memberPeerId,
                ownerLocalIndex: 1,
                ownerIsHost: true,
                isHost: false,
                role: 'client',
                isLocal: !!resolvedLocalPeerId && memberPeerId === resolvedLocalPeerId,
                name: `${displayName} 2`,
            }, true);
        }
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
            teamId: entry.teamId || resolveBalancedTeamId(playerIndex),
        }));
}

export function resolveRuntimeNetworkPlayerSlotContext(facade = null) {
    const session = facade?.session || null;
    const lobbyState = facade?.menuMultiplayerBridge?.getSessionState?.() || null;
    const slots = resolveRuntimeNetworkPlayerSlots({ session, lobbyState });
    const localPeerId = resolveLocalPeerId({ session, lobbyState });
    const localSlots = slots.filter((slot) => slot.isLocal);
    const localSlot = localSlots[0]
        || slots.find((slot) => localPeerId && slot.peerId === localPeerId)
        || (session?.isHost === true ? slots.find((slot) => slot.isHost) : null)
        || slots[0]
        || null;

    return {
        slots,
        humanEntityCount: Math.max(1, slots.length || 1),
        localHumanCount: Math.max(1, localSlots.length || 1),
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
    sessionConfig.numHumans = context.localHumanCount;
    sessionConfig.viewportLayout = context.localHumanCount >= 2
        ? VIEWPORT_LAYOUTS.TWO_COLUMNS
        : VIEWPORT_LAYOUTS.SINGLE;
    return context;
}
