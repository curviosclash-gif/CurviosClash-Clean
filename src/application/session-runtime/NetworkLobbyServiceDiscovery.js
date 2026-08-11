import { createRuntimeClock } from '../../shared/contracts/RuntimeClockContract.js';

export async function resolveDefaultHostSignalingUrl({
    platformCapabilities = null,
    hostIntentBridge = null,
    toCallable = null,
} = {}) {
    const hostCapabilities = platformCapabilities?.host || null;
    const hostBridge = hostIntentBridge;
    const resolveCallable = typeof toCallable === 'function' ? toCallable : () => null;
    const getLanServerStatus = resolveCallable(hostBridge?.getLanServerStatus || hostBridge?.getStatus, null);
    const startLanServer = resolveCallable(hostBridge?.startLanServer || hostBridge?.start, null);
    const status = getLanServerStatus ? await getLanServerStatus.call(hostBridge) : null;
    if (status?.running && status?.port) {
        return `http://localhost:${status.port}`;
    }
    if (startLanServer) {
        const started = await startLanServer.call(hostBridge);
        if (started?.running && started?.port) {
            return `http://localhost:${started.port}`;
        }
    }
    if (hostCapabilities?.available !== true) {
        return 'http://localhost:9090';
    }
    return 'http://localhost:9090';
}

export async function resolveDefaultJoinSignalingUrl({
    lobbyCode = '',
    explicitSignalingUrl = '',
    normalizeLobbyCode,
    tryParseManualSignalingUrl,
    discoveryPort = null,
    clearJoinDiscoveryIssue,
    setJoinDiscoveryIssue,
    delay,
    collectMatchingDiscoveryHosts,
    selectJoinSignalingUrlFromDiscoveredHosts,
    runtimeGlobal = null,
    nowMs = null,
    discoveryPollIntervalMs = 250,
    discoveryMaxWaitMs = 3_000,
    discoveryMaxMatchingHosts = 8,
} = {}) {
    const rawExplicitUrl = String(explicitSignalingUrl || '').trim();
    if (rawExplicitUrl) {
        const normalizedExplicitUrl = tryParseManualSignalingUrl(rawExplicitUrl, { requirePort: true });
        if (normalizedExplicitUrl) {
            clearJoinDiscoveryIssue();
            return normalizedExplicitUrl;
        }
        setJoinDiscoveryIssue(
            'manual_signaling_url_invalid',
            'Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.',
            { rawValue: rawExplicitUrl }
        );
        return '';
    }

    const manualAddress = tryParseManualSignalingUrl(lobbyCode);
    if (manualAddress) {
        clearJoinDiscoveryIssue();
        return manualAddress;
    }

    if (!discoveryPort?.isAvailable?.()) {
        setJoinDiscoveryIssue(
            'discovery_unavailable',
            `Lobby nicht gefunden: ${normalizeLobbyCode(lobbyCode, '') || 'unbekannt'}`
        );
        return '';
    }

    const normalizedLobbyCode = normalizeLobbyCode(lobbyCode, '');
    clearJoinDiscoveryIssue();
    discoveryPort.start?.();
    try {
        const now = createRuntimeClock({ nowMs }).nowMs;
        const deadline = now() + discoveryMaxWaitMs;
        let lastIssue = null;
        while (now() <= deadline) {
            const hosts = await Promise.resolve(discoveryPort.getHosts?.());
            const matches = collectMatchingDiscoveryHosts(hosts, normalizedLobbyCode, discoveryMaxMatchingHosts);
            if (matches.length > 0) {
                const resolved = await selectJoinSignalingUrlFromDiscoveredHosts({
                    hosts: matches,
                    lobbyCode: normalizedLobbyCode,
                    runtimeGlobal,
                });
                if (resolved?.signalingUrl) {
                    clearJoinDiscoveryIssue();
                    return resolved.signalingUrl;
                }
                if (resolved?.issue) {
                    lastIssue = setJoinDiscoveryIssue(
                        resolved.issue.code,
                        resolved.issue.message,
                        resolved.issue.details
                    );
                }
            }
            await delay(discoveryPollIntervalMs);
        }
        if (lastIssue) {
            setJoinDiscoveryIssue(lastIssue.code, lastIssue.message, lastIssue.details);
        } else {
            setJoinDiscoveryIssue('lobby_not_found', `Lobby nicht gefunden: ${normalizedLobbyCode}`);
        }
    } finally {
        discoveryPort.stop?.();
    }

    return '';
}
