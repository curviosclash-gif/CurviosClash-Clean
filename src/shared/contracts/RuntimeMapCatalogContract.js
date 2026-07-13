import {
    getGameplayConfigSection,
    getGameplayMapCatalog,
    CONFIG_SECTIONS,
    GAMEPLAY_CONFIG_DEFAULTS,
} from './GameplayConfigContract.js';
import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from './ContentDescriptorContract.js';

let _configSource = null;

/**
 * Registers an external config source so that map-catalog lookups can resolve
 * MAPS and ARENA without importing from src/core/Config.js.
 * Called once during bootstrap; consumers that pass explicit overrides are
 * unaffected.
 */
export function registerMapCatalogConfigSource(source) {
    _configSource = source && typeof source === 'object' ? source : null;
}

function normalizeMapCatalog(maps) {
    if (!maps || typeof maps !== 'object') {
        return {};
    }
    return maps;
}

function toBoolean(value) {
    return value === true;
}

function toCount(value) {
    return Array.isArray(value) ? value.length : 0;
}

function toSizeLabel(value) {
    if (!Array.isArray(value) || value.length < 3) return '';
    const width = Number(value[0]);
    const height = Number(value[1]);
    const depth = Number(value[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) return '';
    return `${width}x${height}x${depth}`;
}

export function getRuntimeMapCatalog(overrideMaps = null) {
    if (overrideMaps && typeof overrideMaps === 'object') {
        return normalizeMapCatalog(overrideMaps);
    }
    const maps = getGameplayMapCatalog(_configSource);
    return normalizeMapCatalog(Object.keys(maps).length > 0 ? maps : null);
}

export function getRuntimeMapDefinition(mapKey, overrideMaps = null) {
    const maps = getRuntimeMapCatalog(overrideMaps);
    const normalizedMapKey = typeof mapKey === 'string' ? mapKey.trim() : '';
    if (normalizedMapKey && maps[normalizedMapKey]) {
        return maps[normalizedMapKey];
    }
    if (maps.standard) {
        return maps.standard;
    }
    const firstMapKey = Object.keys(maps)[0];
    return firstMapKey ? maps[firstMapKey] : null;
}

export function hasRuntimeMap(mapKey, overrideMaps = null) {
    const maps = getRuntimeMapCatalog(overrideMaps);
    const normalizedMapKey = typeof mapKey === 'string' ? mapKey.trim() : '';
    return normalizedMapKey ? !!maps[normalizedMapKey] : false;
}

export function getRuntimeMapScale(fallback = 1) {
    const arenaSection = getGameplayConfigSection(_configSource, CONFIG_SECTIONS.ARENA);
    const scale = Number(arenaSection?.MAP_SCALE ?? GAMEPLAY_CONFIG_DEFAULTS.ARENA.MAP_SCALE);
    if (!Number.isFinite(scale) || scale <= 0) {
        return fallback;
    }
    return scale;
}

export function listRuntimeMapPresetDescriptors(overrideMaps = null) {
    const maps = getRuntimeMapCatalog(overrideMaps);
    return Object.entries(maps)
        .map(([mapKey, mapDef]) => {
            const source = mapDef && typeof mapDef === 'object' ? mapDef : {};
            return {
                id: String(mapKey || '').trim() || 'unknown-map',
                name: typeof source.name === 'string' ? source.name : String(mapKey || '').trim() || 'Unknown Map',
                sizeLabel: toSizeLabel(source.size),
                hasPortals: toCount(source.portals) > 0,
                hasGates: toCount(source.gates) > 0,
                hasMissions: toCount(source.missions) > 0,
                hasItems: toCount(source.items) > 0,
                hasAircraft: toCount(source.aircraft) > 0,
                hasParcours: toBoolean(source.parcours?.enabled),
                hasGlbModel: typeof source.glbModel === 'string' && source.glbModel.length > 0,
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id, 'en', { sensitivity: 'base' }));
}

export function listRuntimeMapPresetKeys(overrideMaps = null) {
    return listRuntimeMapPresetDescriptors(overrideMaps).map((entry) => entry.id);
}

export function resolveRuntimeMapPresetLabel(mapKey, overrideMaps = null) {
    const normalizedMapKey = typeof mapKey === 'string' ? mapKey.trim() : '';
    if (!normalizedMapKey) {
        return '';
    }
    const descriptor = getRuntimeMapPresetRegistryDescriptor(overrideMaps);
    const match = descriptor.entries.find((entry) => entry.id === normalizedMapKey);
    return typeof match?.name === 'string' ? match.name : '';
}

export function getRuntimeMapPresetRegistryDescriptor(overrideMaps = null) {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.RUNTIME_MAP_PRESETS,
        source: 'runtime-config.MAPS',
        entries: listRuntimeMapPresetDescriptors(overrideMaps),
        metadata: {
            mapScale: getRuntimeMapScale(1),
        },
    });
}
