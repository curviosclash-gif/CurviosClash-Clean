import {
    compareDiscoveryHostEntries,
    normalizeDiscoveryHostEntry,
    normalizeHostPort,
    normalizeLobbyCode,
} from './NetworkLobbyServiceSupport.js';

const DEFAULT_DISCOVERY_VALIDATION_TIMEOUT_MS = 1_200;

export function collectMatchingDiscoveryHosts(hosts, lobbyCode, maxMatchingHosts = 8) {
    if (!Array.isArray(hosts)) {
        return [];
    }
    const normalizedLobbyCode = normalizeLobbyCode(lobbyCode, '');
    if (!normalizedLobbyCode) {
        return [];
    }
    const dedupedHosts = new Map();
    for (const host of hosts) {
        const normalizedHost = normalizeDiscoveryHostEntry(host);
        if (!normalizedHost || normalizedHost.lobbyCode !== normalizedLobbyCode) {
            continue;
        }
        const dedupeKey = `${normalizedHost.ip}:${normalizedHost.lobbyCode}`;
        const existing = dedupedHosts.get(dedupeKey);
        if (!existing || compareDiscoveryHostEntries(normalizedHost, existing) < 0) {
            dedupedHosts.set(dedupeKey, normalizedHost);
        }
    }
    return Array.from(dedupedHosts.values())
        .sort(compareDiscoveryHostEntries)
        .slice(0, Math.max(1, Math.floor(Number(maxMatchingHosts) || 8)));
}

async function validateDiscoveredHost(host, lobbyCode, options = {}) {
    const normalizedHost = normalizeDiscoveryHostEntry(host);
    if (!normalizedHost) {
        return null;
    }
    const runtimeGlobal = options.runtimeGlobal && typeof options.runtimeGlobal === 'object'
        ? options.runtimeGlobal
        : globalThis;
    const fetchImpl = typeof runtimeGlobal.fetch === 'function'
        ? runtimeGlobal.fetch.bind(runtimeGlobal)
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) {
        return null;
    }

    const timeoutMs = Math.max(
        100,
        Math.floor(Number(options.validationTimeoutMs) || DEFAULT_DISCOVERY_VALIDATION_TIMEOUT_MS)
    );
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    const candidateUrl = `http://${normalizedHost.ip}:${normalizedHost.port}`;
    try {
        const response = await fetchImpl(`${candidateUrl}/discovery/info`, controller ? { signal: controller.signal } : undefined);
        if (!response?.ok) {
            return null;
        }
        const payload = await response.json();
        if (normalizeLobbyCode(payload?.lobbyCode, '') !== lobbyCode) {
            return null;
        }
        const diagnosticsPort = normalizeHostPort(payload?.diagnostics?.selectedPort, 0);
        const resolvedPort = diagnosticsPort || normalizedHost.port;
        return {
            candidate: normalizedHost,
            signalingUrl: `http://${normalizedHost.ip}:${resolvedPort}`,
        };
    } catch {
        return null;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function selectJoinSignalingUrlFromDiscoveredHosts(options = {}) {
    const lobbyCode = normalizeLobbyCode(options.lobbyCode, '');
    const hosts = Array.isArray(options.hosts) ? options.hosts : [];
    const validatedHostsByUrl = new Map();
    const validatedHostResults = await Promise.all(
        hosts.map((host) => validateDiscoveredHost(host, lobbyCode, options))
    );
    for (const validatedHost of validatedHostResults) {
        if (!validatedHost?.signalingUrl) {
            continue;
        }
        const existing = validatedHostsByUrl.get(validatedHost.signalingUrl);
        if (!existing || compareDiscoveryHostEntries(validatedHost.candidate, existing.candidate) < 0) {
            validatedHostsByUrl.set(validatedHost.signalingUrl, validatedHost);
        }
    }

    const validatedHosts = Array.from(validatedHostsByUrl.values()).sort((left, right) => (
        compareDiscoveryHostEntries(left.candidate, right.candidate)
    ));
    if (validatedHosts.length === 1) {
        return { signalingUrl: validatedHosts[0].signalingUrl };
    }
    if (validatedHosts.length > 1) {
        return {
            signalingUrl: '',
            issue: {
                code: 'lobby_multiple_hosts_found',
                message: `Mehrere LAN-Hosts fuer Lobby-Code ${lobbyCode} gefunden. Bitte Host-IP:Port direkt eingeben oder Discovery kurz neu starten.`,
                details: {
                    lobbyCode,
                    candidates: validatedHosts.map((entry) => ({
                        ip: entry.candidate.ip,
                        port: entry.candidate.port,
                        signalingUrl: entry.signalingUrl,
                        lastSeen: entry.candidate.lastSeen,
                    })),
                },
            },
        };
    }
    return {
        signalingUrl: '',
        issue: {
            code: 'lobby_discovery_stale',
            message: `Gefundene LAN-Hosts fuer ${lobbyCode} antworten nicht mehr. Vermutlich stale Broadcast oder Portwechsel; Host bitte neu announcen oder IP:Port direkt eingeben.`,
            details: {
                lobbyCode,
                candidates: hosts.map((host) => ({
                    ip: host.ip,
                    port: host.port,
                    lastSeen: host.lastSeen,
                })),
            },
        },
    };
}
