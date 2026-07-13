const DEFAULT_FALLBACK_MAP_KEY = 'standard';

function listDescriptorMapKeys(mapDescriptors) {
    if (!Array.isArray(mapDescriptors)) {
        return [];
    }
    return mapDescriptors
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter(Boolean);
}

function resolveKnownMapKeys(maps, mapDescriptors = null) {
    const mapKeys = Object.keys(maps || {});
    const descriptorKeys = listDescriptorMapKeys(mapDescriptors);
    if (descriptorKeys.length === 0) {
        return mapKeys;
    }
    const mapKeySet = new Set(mapKeys);
    const descriptorBackedKeys = descriptorKeys.filter((key) => mapKeySet.has(key));
    return descriptorBackedKeys.length > 0 ? descriptorBackedKeys : mapKeys;
}

function resolveFallbackKeyFromMaps(maps, mapDescriptors = null) {
    const knownMapKeys = resolveKnownMapKeys(maps, mapDescriptors);
    if (maps?.[DEFAULT_FALLBACK_MAP_KEY] && knownMapKeys.includes(DEFAULT_FALLBACK_MAP_KEY)) {
        return DEFAULT_FALLBACK_MAP_KEY;
    }
    return knownMapKeys.length > 0 ? knownMapKeys[0] : DEFAULT_FALLBACK_MAP_KEY;
}

function resolveMapDefinition(maps, mapKey, fallbackMapKey) {
    return maps?.[mapKey] || maps?.[fallbackMapKey] || null;
}

export function resolveFallbackMapKey(maps, mapDescriptors = null) {
    return resolveFallbackKeyFromMaps(maps, mapDescriptors);
}

export function resolveKnownMapSelection({ requestedMapKey, maps, fallbackMapKey, mapDescriptors = null }) {
    const normalizedRequestedKey = String(requestedMapKey || '').trim();
    const knownMapKeys = new Set(resolveKnownMapKeys(maps, mapDescriptors));
    const knownMap = knownMapKeys.has(normalizedRequestedKey)
        ? maps?.[normalizedRequestedKey] || null
        : null;
    if (knownMap) {
        return {
            requestedMapKey: normalizedRequestedKey,
            effectiveMapKey: normalizedRequestedKey,
            mapDefinition: knownMap,
            warnings: [],
            isFallback: false,
            isCustom: false,
            error: null,
        };
    }

    return {
        requestedMapKey: normalizedRequestedKey,
        effectiveMapKey: fallbackMapKey,
        mapDefinition: resolveMapDefinition(maps, fallbackMapKey, fallbackMapKey),
        warnings: [`Unknown map key "${normalizedRequestedKey}". Falling back to "${fallbackMapKey}".`],
        isFallback: true,
        isCustom: false,
        error: `Unknown map key "${normalizedRequestedKey}".`,
    };
}

export function resolveCustomMapSelection({ requestedMapKey, maps, fallbackMapKey, customResult }) {
    if (customResult?.ok) {
        return {
            requestedMapKey,
            effectiveMapKey: requestedMapKey,
            mapDefinition: customResult.mapDefinition,
            mapDocument: customResult.mapDocument,
            warnings: customResult.warnings || [],
            message: customResult.message || '',
            details: customResult.details || '',
            isFallback: false,
            isCustom: true,
            error: null,
            migration: customResult.migration || null,
        };
    }

    return {
        requestedMapKey,
        effectiveMapKey: fallbackMapKey,
        mapDefinition: resolveMapDefinition(maps, fallbackMapKey, fallbackMapKey),
        warnings: customResult?.warnings || [],
        message: customResult?.message || '',
        details: customResult?.details || '',
        isFallback: true,
        isCustom: false,
        error: customResult?.error || 'Unknown custom map parsing error.',
        migration: customResult?.migration || null,
    };
}

