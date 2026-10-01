const { isIPv4 } = require('node:net');

const MAX_DISCOVERY_HOST_ADDRESSES = 16;
const DISCOVERY_RATE_LIMIT_MS = 500;
const DISCOVERY_RATE_LIMIT_MAX_SOURCES = 64;
const DISCOVERY_RATE_LIMIT_EXPIRY_MS = 10_000;
const DISCOVERY_PARSE_RATE_LIMIT_MAX_SOURCES = 64;

function normalizeDiscoveryAddresses(values) {
    const addresses = [];
    for (const value of Array.isArray(values) ? values : [values]) {
        const address = String(value || '').trim();
        if (isIPv4(address) && !addresses.includes(address)) addresses.push(address);
        if (addresses.length >= MAX_DISCOVERY_HOST_ADDRESSES) break;
    }
    return addresses;
}

function sendDiscoveryAnnouncement(socket, payload, hostAddresses, port, broadcastAddress) {
    const addresses = normalizeDiscoveryAddresses(hostAddresses);
    const announcedAddresses = addresses.length > 0 ? addresses : ['127.0.0.1'];
    const announcement = {
        ...payload,
        // Keep `ip` for discovery listeners shipped before the address-list field.
        ip: announcedAddresses[0],
        ips: announcedAddresses,
    };
    const buffer = Buffer.from(JSON.stringify(announcement));
    socket.send(buffer, 0, buffer.length, port, broadcastAddress);
}

function resolveDiscoveryCandidateIps(payload, sourceAddress) {
    const announcedAddresses = normalizeDiscoveryAddresses([
        ...(Array.isArray(payload?.ips) ? payload.ips : []),
        payload?.ip,
    ]);
    if (announcedAddresses.length <= 0) return [];
    return normalizeDiscoveryAddresses([
        sourceAddress,
        ...announcedAddresses,
    ]);
}

function shouldSkipDiscoveryParse(rateMap, sourceKey, now = Date.now()) {
    const key = String(sourceKey || '').trim();
    const timestamp = Number(now);
    if (!(rateMap instanceof Map) || !key || !Number.isFinite(timestamp)) return false;

    for (const [entryKey, lastSeen] of rateMap) {
        if (!Number.isFinite(Number(lastSeen)) || timestamp - Number(lastSeen) >= DISCOVERY_RATE_LIMIT_MS) {
            rateMap.delete(entryKey);
        }
    }

    const lastSeen = rateMap.get(key);
    if (lastSeen !== undefined && timestamp - Number(lastSeen) < DISCOVERY_RATE_LIMIT_MS) {
        rateMap.delete(key);
        rateMap.set(key, lastSeen);
        return true;
    }

    if (rateMap.size >= DISCOVERY_PARSE_RATE_LIMIT_MAX_SOURCES) {
        const oldestSourceKey = rateMap.keys().next().value;
        if (oldestSourceKey !== undefined) rateMap.delete(oldestSourceKey);
    }
    rateMap.set(key, timestamp);
    return false;
}

function admitDiscoveryPacket({
    rateMap,
    parseRateMap,
    sourceKey,
    message,
    magic,
    now = Date.now(),
    parseMessage = (text) => JSON.parse(text),
} = {}) {
    const key = String(sourceKey || '').trim();
    const timestamp = Number(now);
    if (!(rateMap instanceof Map) || !key || !Number.isFinite(timestamp)) return null;
    if (parseRateMap instanceof Map && shouldSkipDiscoveryParse(parseRateMap, key, timestamp)) return null;

    let payload;
    try {
        payload = parseMessage(Buffer.isBuffer(message) ? message.toString() : String(message ?? ''));
    } catch {
        return null;
    }
    if (!payload || typeof payload !== 'object' || payload.magic !== magic) return null;

    for (const [entryKey, lastSeen] of rateMap) {
        if (!Number.isFinite(Number(lastSeen)) || timestamp - Number(lastSeen) >= DISCOVERY_RATE_LIMIT_EXPIRY_MS) {
            rateMap.delete(entryKey);
        }
    }

    const lastSeen = rateMap.get(key);
    if (lastSeen !== undefined && timestamp - Number(lastSeen) < DISCOVERY_RATE_LIMIT_MS) return null;
    if (rateMap.size >= DISCOVERY_RATE_LIMIT_MAX_SOURCES && !rateMap.has(key)) return null;

    rateMap.set(key, timestamp);
    return payload;
}

module.exports = {
    DISCOVERY_RATE_LIMIT_EXPIRY_MS,
    DISCOVERY_RATE_LIMIT_MAX_SOURCES,
    DISCOVERY_RATE_LIMIT_MS,
    MAX_DISCOVERY_HOST_ADDRESSES,
    admitDiscoveryPacket,
    resolveDiscoveryCandidateIps,
    sendDiscoveryAnnouncement,
    shouldSkipDiscoveryParse,
};
