import {
    getRuntimeMapCatalog,
    getRuntimeMapDefinition,
} from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { resolveArenaMapSelection } from '../../entities/CustomMapLoader.js';
import { createArenaMapFingerprint } from '../../entities/arena/ArenaBuildResourceCache.js';

export function toSafeInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.round(parsed);
}

export function resolveArenaSourceMap(mapResolution, effectiveMapKey) {
    if (mapResolution?.mapDefinition && typeof mapResolution.mapDefinition === 'object') {
        return mapResolution.mapDefinition;
    }
    const maps = getRuntimeMapCatalog();
    if (effectiveMapKey && maps?.[effectiveMapKey]) {
        return maps[effectiveMapKey];
    }
    return getRuntimeMapDefinition('standard', maps);
}

export function buildArenaSessionKey(mapResolution, runtimeConfig, portalsEnabled) {
    const effectiveMapKey = mapResolution?.effectiveMapKey || 'standard';
    const gameplay = runtimeConfig?.gameplay || {};
    const arenaSourceMap = resolveArenaSourceMap(mapResolution, effectiveMapKey);
    const mapFingerprint = createArenaMapFingerprint(arenaSourceMap);
    return [
        String(effectiveMapKey || 'standard'),
        mapFingerprint,
        portalsEnabled ? '1' : '0',
        gameplay.planarMode ? '1' : '0',
        Math.max(0, Math.round(Number(gameplay.portalCount) || 0)),
        Math.max(0, Math.round(Number(gameplay.planarLevelCount) || 0)),
    ].join('|');
}

export function resolveMatchMap(runtimeConfig = null, requestedMapKey = null) {
    const resolvedRequestedMapKey = requestedMapKey || runtimeConfig?.session?.mapKey;
    return resolveArenaMapSelection(resolvedRequestedMapKey);
}
