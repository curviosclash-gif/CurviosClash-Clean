import { LOBBY_SERVICE_TRANSPORTS } from '../../shared/contracts/LobbyServiceContract.js';
import { tryCloneJsonValue } from '../../shared/utils/JsonClone.js';
import { normalizeStorageLobbyMembers } from './StorageLobbyPresence.js';

export const MULTIPLAYER_SESSION_SCHEMA_VERSION = 'multiplayer-session.v1';
const MULTIPLAYER_STORAGE_KEY_PREFIX = 'cuviosclash.multiplayer.lobby.';
const MULTIPLAYER_PEER_SESSION_KEY = 'cuviosclash.multiplayer.peer.v1';

export function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function normalizeLobbyCode(value, fallback = '') {
    const normalized = normalizeString(value, fallback)
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
    return normalized || fallback;
}

export function toTimestamp(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function deepClone(value) {
    return tryCloneJsonValue(value, null);
}

export function buildRuntimeId(nowProvider, randomProvider, randomLength = 6) {
    let rawNow = Number.NaN;
    try {
        rawNow = Number(nowProvider());
    } catch {
        rawNow = Number.NaN;
    }
    const safeNow = Number.isFinite(rawNow) ? Math.max(0, Math.floor(rawNow)) : 0;
    let randomValue = Number.NaN;
    try {
        randomValue = Number(randomProvider());
    } catch {
        randomValue = Number.NaN;
    }

    const normalizedRandom = Number.isFinite(randomValue)
        ? Math.abs(randomValue % 1)
        : 0.5;
    const randomToken = normalizedRandom
        .toString(36)
        .slice(2, 2 + randomLength)
        .padEnd(randomLength, '0');
    return `${safeNow.toString(36)}-${randomToken}`;
}

function createPeerId(nowProvider, randomProvider) {
    return `mp-${buildRuntimeId(nowProvider, randomProvider, 6)}`;
}

export function ensurePeerId(providedPeerId, sessionStorage, nowProvider, randomProvider) {
    const normalizedProvidedPeerId = normalizeString(providedPeerId, '');
    if (normalizedProvidedPeerId) return normalizedProvidedPeerId;

    try {
        const stored = normalizeString(sessionStorage?.getItem?.(MULTIPLAYER_PEER_SESSION_KEY), '');
        if (stored) return stored;
    } catch {
        // Ignore sessionStorage lookup failures.
    }

    const nextPeerId = createPeerId(nowProvider, randomProvider);
    try {
        sessionStorage?.setItem?.(MULTIPLAYER_PEER_SESSION_KEY, nextPeerId);
    } catch {
        // Ignore sessionStorage persistence failures.
    }
    return nextPeerId;
}

export function createLobbyStorageKey(lobbyCode) {
    const normalizedLobbyCode = normalizeLobbyCode(lobbyCode, '');
    return normalizedLobbyCode ? `${MULTIPLAYER_STORAGE_KEY_PREFIX}${normalizedLobbyCode}` : '';
}

export function createIdleSessionState(peerId, lobbyCode = '') {
    return {
        peerId: normalizeString(peerId, ''),
        joined: false,
        connected: false,
        lobbyCode: normalizeLobbyCode(lobbyCode, ''),
        role: 'offline',
        isHost: false,
        localReady: false,
        memberCount: 0,
        readyCount: 0,
        allReady: false,
        canStart: false,
        hostPeerId: '',
        pendingMatchCommandId: '',
        members: [],
        transport: LOBBY_SERVICE_TRANSPORTS.STORAGE_BRIDGE,
    };
}

function normalizePendingMatchStart(command, now) {
    if (!command || typeof command !== 'object') return null;
    const commandId = normalizeString(command.commandId, '');
    if (!commandId) return null;
    return {
        commandId,
        lobbyCode: normalizeLobbyCode(command.lobbyCode, ''),
        hostPeerId: normalizeString(command.hostPeerId, ''),
        issuedAt: toTimestamp(command.issuedAt, now),
        settingsSnapshot: deepClone(command.settingsSnapshot),
    };
}

export function normalizeSessionSnapshot(snapshot, now) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const lobbyCode = normalizeLobbyCode(snapshot.lobbyCode, '');
    if (!lobbyCode) return null;

    const normalizedMembers = normalizeStorageLobbyMembers(snapshot.members, snapshot.hostPeerId, now, {
        normalizeString,
        toTimestamp,
    });
    if (normalizedMembers.length === 0) return null;

    const declaredHostPeerId = normalizeString(snapshot.hostPeerId, '');
    const hostPeerId = declaredHostPeerId || normalizeString(normalizedMembers[0]?.peerId, '');
    if (!hostPeerId) return null;
    const hostMember = normalizedMembers.find((member) => member.peerId === hostPeerId) || null;

    return {
        schemaVersion: MULTIPLAYER_SESSION_SCHEMA_VERSION,
        lobbyCode,
        hostPeerId,
        hostActorId: normalizeString(snapshot.hostActorId, hostMember?.actorId || 'host'),
        updatedAt: toTimestamp(snapshot.updatedAt, now),
        revision: Math.max(0, Math.floor(Number(snapshot.revision) || 0)),
        members: normalizedMembers,
        hostSettingsSnapshot: deepClone(snapshot.hostSettingsSnapshot),
        pendingMatchStart: normalizePendingMatchStart(snapshot.pendingMatchStart, now),
    };
}

export function deriveSessionState(snapshot, peerId) {
    if (!snapshot) return createIdleSessionState(peerId);

    const localPeerId = normalizeString(peerId, '');
    const localMember = snapshot.members.find((member) => member.peerId === localPeerId) || null;
    const hostConnected = snapshot.members.some((member) => member.peerId === snapshot.hostPeerId);
    const readyCount = snapshot.members.filter((member) => member.ready === true).length;
    const allReady = hostConnected
        && snapshot.members.length > 0
        && snapshot.members.every((member) => member.ready === true);
    const isHost = localMember?.peerId === snapshot.hostPeerId && localMember?.role === 'host';
    const joined = !!localMember;

    return {
        peerId: localPeerId,
        joined,
        connected: joined && (isHost || hostConnected),
        lobbyCode: snapshot.lobbyCode,
        role: joined ? (isHost ? 'host' : 'client') : 'offline',
        isHost,
        localReady: localMember?.ready === true,
        memberCount: snapshot.members.length,
        readyCount,
        allReady,
        canStart: joined && isHost && hostConnected && snapshot.members.length >= 2 && allReady,
        hostPeerId: snapshot.hostPeerId,
        hostConnected,
        pendingMatchCommandId: normalizeString(snapshot.pendingMatchStart?.commandId, ''),
        members: snapshot.members.map((member) => ({
            ...member,
            isLocal: member.peerId === localPeerId,
            isHost: member.peerId === snapshot.hostPeerId,
        })),
        transport: LOBBY_SERVICE_TRANSPORTS.STORAGE_BRIDGE,
    };
}

export function generateLobbyCode(nowProvider, randomProvider) {
    const randomToken = buildRuntimeId(nowProvider, randomProvider, 4).split('-')[1] || '0000';
    return `LOBBY-${randomToken.toUpperCase()}`;
}

export function readSnapshotFromStorage(storage, lobbyCode, now) {
    const storageKey = createLobbyStorageKey(lobbyCode);
    if (!storageKey || !storage?.getItem) return null;

    try {
        const raw = storage.getItem(storageKey);
        if (!raw) return null;
        return normalizeSessionSnapshot(JSON.parse(raw), now);
    } catch {
        return null;
    }
}

export function persistSnapshotToStorage(storage, snapshot) {
    if (!storage) return;
    const storageKey = createLobbyStorageKey(snapshot?.lobbyCode || '');
    if (!storageKey) return;

    try {
        if (!snapshot || !Array.isArray(snapshot.members) || snapshot.members.length === 0) {
            storage.removeItem(storageKey);
            return;
        }
        storage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
        // Ignore localStorage persistence failures.
    }
}
