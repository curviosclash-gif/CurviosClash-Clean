function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function resolveConfiguredOnlineSignalingUrl(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const explicit = normalizeString(source.signalingUrl, '');
    if (explicit) {
        return explicit;
    }

    const runtimeGlobal = source.runtimeGlobal && typeof source.runtimeGlobal === 'object'
        ? source.runtimeGlobal
        : null;
    const runtimeGlobalUrl = normalizeString(runtimeGlobal?.__SIGNALING_URL__, '');
    if (runtimeGlobalUrl) {
        return runtimeGlobalUrl;
    }

    /* global __SIGNALING_URL__ */
    if (typeof __SIGNALING_URL__ !== 'undefined') {
        return normalizeString(__SIGNALING_URL__, '');
    }

    return '';
}

export function hasConfiguredOnlineSignalingUrl(options = {}) {
    return resolveConfiguredOnlineSignalingUrl(options).length > 0;
}
