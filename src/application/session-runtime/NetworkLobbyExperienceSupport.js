import { LOBBY_SERVICE_TRANSPORTS } from '../../shared/contracts/LobbyServiceContract.js';
import {
    delay,
    normalizeDiscoveryHostEntry,
    normalizeString,
} from './NetworkLobbyServiceSupport.js';

export function createPublicLobbyMetadata(settingsSnapshot = null, actorId = '') {
    const snapshot = settingsSnapshot && typeof settingsSnapshot === 'object' ? settingsSnapshot : {};
    return {
        hostName: normalizeString(actorId, 'Host'),
        mapKey: normalizeString(snapshot.mapKey, 'standard'),
        gameMode: normalizeString(snapshot.gameMode, 'CLASSIC'),
        modePath: normalizeString(snapshot?.localSettings?.modePath, 'normal'),
        winsNeeded: Math.max(1, Math.floor(Number(snapshot.winsNeeded) || 5)),
    };
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

export async function listDiscoveredNetworkLobbies({ discoveryPort, transport } = {}) {
    if (!discoveryPort?.isAvailable?.()) return [];
    discoveryPort.start?.();
    try {
        await delay(300);
        const hosts = await Promise.resolve(discoveryPort.getHosts?.());
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
                signalingUrl: `http://${entry.ip}:${entry.port}`,
                transport,
            }];
        });
    } finally {
        discoveryPort.stop?.();
    }
}
