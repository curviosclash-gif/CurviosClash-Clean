function parseIpv4Octets(hostname = '') {
    const parts = String(hostname || '').split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
    const octets = parts.map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

export function isLocalNetworkHostname(hostname = '') {
    const normalized = String(hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (normalized === 'localhost' || normalized === '::1') return true;

    const octets = parseIpv4Octets(normalized);
    if (octets) {
        return octets[0] === 10
            || octets[0] === 127
            || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] === 192 && octets[1] === 168)
            || (octets[0] === 169 && octets[1] === 254);
    }

    const isIpv6Literal = normalized.includes(':') && /^[0-9a-f:]+$/.test(normalized);
    return isIpv6Literal && (
        normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || /^fe[89ab][0-9a-f]:/.test(normalized)
    );
}

export function tryParseLocalLanSignalingOrigin(rawValue, { requirePort = false } = {}) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value || /\s/.test(value)) return '';

    const hasScheme = value.includes('://');
    const authority = (hasScheme ? value.slice(value.indexOf('://') + 3) : value).split('/')[0];
    const bracketed = authority.match(/^\[([^\]]+)](?::(\d+))?$/);
    const plain = authority.match(/^([^:]+)(?::(\d+))?$/);
    const rawHostname = bracketed?.[1] || plain?.[1] || '';
    const explicitPort = bracketed?.[2] || plain?.[2] || '';
    if (!rawHostname || (requirePort && !explicitPort) || !isLocalNetworkHostname(rawHostname)) return '';

    let parsedUrl;
    try {
        parsedUrl = new URL(hasScheme ? value : `http://${value}`);
    } catch {
        return '';
    }
    if (parsedUrl.protocol !== 'http:' || parsedUrl.username || parsedUrl.password) return '';
    if (!isLocalNetworkHostname(parsedUrl.hostname)) return '';
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return '';
    const port = explicitPort ? Number(explicitPort) : 0;
    if (explicitPort && (!Number.isInteger(port) || port <= 0 || port > 65535)) return '';
    return parsedUrl.origin;
}
