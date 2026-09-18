import { LOBBY_SERVICE_TRANSPORTS } from '../../shared/contracts/LobbyServiceContract.js';
import { createLobbyMatchSummary } from '../../shared/contracts/LobbyMatchSummaryContract.js';
import {
    MULTIPLAYER_PROTOCOL_VERSION,
    normalizePublicLobbyMetadata,
} from '../../shared/contracts/SignalingSessionContract.js';
import {
    normalizeDiscoveryHostEntry,
    normalizeString,
} from './NetworkLobbyServiceSupport.js';

const LAN_DISCOVERY_SCAN_TIMEOUT_MS = 2_500;

export function createPublicLobbyMetadata(settingsSnapshot = null, actorId = '') {
    const snapshot = settingsSnapshot && typeof settingsSnapshot === 'object' ? settingsSnapshot : {};
    return normalizePublicLobbyMetadata({
        hostName: normalizeString(actorId, 'Host'),
        mapKey: normalizeString(snapshot.mapKey, 'standard'),
        gameMode: normalizeString(snapshot.gameMode, 'CLASSIC'),
        modePath: normalizeString(snapshot?.localSettings?.modePath, 'normal'),
        winsNeeded: Math.max(1, Math.floor(Number(snapshot.winsNeeded) || 5)),
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        matchSummary: createLobbyMatchSummary(snapshot),
    });
}

export async function tryResolveNetworkLobbyUrl(resolver) {
    try {
        return { value: await resolver(), error: null };
    } catch (error) {
        return { value: '', error };
    }
}

export async function resolveNetworkLobbyShareAddress({
    transport,
    hostIntentBridge,
    signalingUrl = '',
} = {}) {
    if (transport !== LOBBY_SERVICE_TRANSPORTS.LAN) return '';
    const getStatus = hostIntentBridge?.getLanServerStatus || hostIntentBridge?.getStatus;
    let status = null;
    try {
        status = typeof getStatus === 'function' ? await getStatus.call(hostIntentBridge) : null;
    } catch {
        status = null;
    }
    const host = normalizeString(status?.hostIp || status?.localIps?.[0], 'localhost');
    let port = Number(status?.port || status?.selectedPort || 0);
    if (!Number.isInteger(port) || port <= 0) {
        try { port = Number(new URL(signalingUrl).port || 9090); } catch { port = 9090; }
    }
    return `${host}:${port}`;
}

// A cold listener hears each host once per broadcast interval (2 s), so the first event
// may hold only one of several hosts. Listen for the whole window and keep the latest
// full list; the desktop shell always sends every host it knows.
async function waitForDiscoveredHosts(discoveryPort, timeoutMs) {
    let latestEventHosts = [];
    let timeoutId = null;
    const unsubscribe = discoveryPort.subscribe?.((hosts) => {
        if (Array.isArray(hosts) && hosts.length > 0) latestEventHosts = hosts;
    });

    try {
        await Promise.resolve(discoveryPort.start?.());
        const cachedHosts = await Promise.resolve(discoveryPort.getHosts?.());
        if (Array.isArray(cachedHosts) && cachedHosts.length > 0) {
            return cachedHosts;
        }
        await new Promise((resolve) => { timeoutId = setTimeout(resolve, timeoutMs); });
        const polledHosts = await Promise.resolve(discoveryPort.getHosts?.()).catch(() => []);
        return Array.isArray(polledHosts) && polledHosts.length >= latestEventHosts.length ? polledHosts : latestEventHosts;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (typeof unsubscribe === 'function') unsubscribe();
    }
}

export async function listDiscoveredNetworkLobbies({
    discoveryPort,
    transport,
    scanTimeoutMs = LAN_DISCOVERY_SCAN_TIMEOUT_MS,
} = {}) {
    if (!discoveryPort?.isAvailable?.()) return [];
    try {
        const timeoutMs = Math.max(0, Math.floor(Number(scanTimeoutMs) || LAN_DISCOVERY_SCAN_TIMEOUT_MS));
        const hosts = await waitForDiscoveredHosts(discoveryPort, timeoutMs);
        return (Array.isArray(hosts) ? hosts : []).flatMap((host) => {
            const entry = normalizeDiscoveryHostEntry(host);
            if (!entry) return [];
            return [{
                lobbyCode: entry.lobbyCode,
                memberCount: entry.playerCount,
                maxPlayers: Math.max(entry.playerCount, Number(host?.maxPlayers) || 10),
                hostName: entry.hostName || entry.ip,
                mapKey: normalizeString(host?.mapKey, ''),
                gameMode: normalizeString(host?.gameMode, ''),
                modePath: normalizeString(host?.modePath, ''),
                winsNeeded: Math.max(1, Math.floor(Number(host?.winsNeeded) || 1)),
                inMatch: host?.inMatch === true,
                lastSeen: entry.lastSeen,
                signalingUrl: `http://${entry.ip}:${entry.port}`,
                transport,
            }];
        });
    } finally {
        await Promise.resolve(discoveryPort.stop?.());
    }
}
