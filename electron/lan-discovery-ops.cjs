const { isIPv4 } = require('node:net');

const MAX_DISCOVERY_HOST_ADDRESSES = 16;

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

module.exports = {
    MAX_DISCOVERY_HOST_ADDRESSES,
    resolveDiscoveryCandidateIps,
    sendDiscoveryAnnouncement,
};
