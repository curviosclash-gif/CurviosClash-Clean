import {
    CUSTOM_MAP_KEY,
    CUSTOM_MAP_STORAGE_KEY,
    parseMapJSON,
    toArenaMapDefinition,
} from './MapSchema.js';
import {
    getRuntimeMapCatalog,
    getRuntimeMapPresetRegistryDescriptor,
    getRuntimeMapScale,
} from '../shared/contracts/RuntimeMapCatalogContract.js';
import { resolveLocalStorage } from '../shared/runtime/BrowserStoragePorts.js';
import {
    resolveCustomMapSelection,
    resolveFallbackMapKey,
    resolveKnownMapSelection,
} from './mapSchema/CustomMapSelectionResolver.js';
import { createLogger } from '../shared/logging/Logger.js';

const LEGACY_EDITOR_PLAYTEST_SCALE = 35;
const LEGACY_EDITOR_LARGE_DIM_THRESHOLD = 500;
const logger = createLogger('CustomMapLoader');
export const CUSTOM_MAP_STORAGE_CAPABILITY_CONTRACT_VERSION = 'custom-map-storage-capability.v1';
export const CUSTOM_MAP_STORAGE_PROVIDER_KIND = 'browser-local-storage';

function getStorage(storageOverride) {
    return resolveLocalStorage(storageOverride);
}

function normalizeWarnings(warnings) {
    return Array.isArray(warnings)
        ? warnings.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
        : [];
}

function hasMigrationWarnings(warnings) {
    return normalizeWarnings(warnings).some((entry) => /legacy|schema v\d+|migrat/i.test(entry));
}

function createCustomMapResult({
    ok,
    reason,
    error = '',
    message = '',
    warnings = [],
    capability,
    details = '',
    mapDocument = null,
    mapDefinition = null,
    migration = null,
}) {
    return {
        ok: ok === true,
        reason: String(reason || '').trim(),
        error: String(error || '').trim(),
        message: String(message || '').trim(),
        warnings: normalizeWarnings(warnings),
        capability,
        details: String(details || '').trim(),
        mapDocument,
        mapDefinition,
        migration: migration && typeof migration === 'object'
            ? { ...migration }
            : null,
    };
}

export function resolveCustomMapStorageCapability(storageOverride) {
    const storage = getStorage(storageOverride);
    const available = !!storage
        && typeof storage.getItem === 'function'
        && typeof storage.setItem === 'function';
    return Object.freeze({
        contractVersion: CUSTOM_MAP_STORAGE_CAPABILITY_CONTRACT_VERSION,
        providerKind: CUSTOM_MAP_STORAGE_PROVIDER_KIND,
        available,
        degradedReason: available ? '' : 'storage_unavailable',
    });
}

function getRuntimeScale() {
    return getRuntimeMapScale(1);
}

function getCustomMapConversionScale(mapDocument) {
    const runtimeScale = getRuntimeScale();
    const width = Number(mapDocument?.arenaSize?.width);
    const height = Number(mapDocument?.arenaSize?.height);
    const depth = Number(mapDocument?.arenaSize?.depth);
    const maxDim = Math.max(
        Number.isFinite(width) ? width : 0,
        Number.isFinite(height) ? height : 0,
        Number.isFinite(depth) ? depth : 0
    );

    // The editor still uses legacy world-sized defaults (e.g. 2800x950x2400).
    // Those values become unplayably large with the current runtime MAP_SCALE=3
    // if we convert them 1:1. Detect these large editor-space maps and apply the
    // historical normalization factor used by the old pipeline.
    if (maxDim >= LEGACY_EDITOR_LARGE_DIM_THRESHOLD && runtimeScale < LEGACY_EDITOR_PLAYTEST_SCALE) {
        return {
            scale: LEGACY_EDITOR_PLAYTEST_SCALE,
            warning: `Large editor-scale map detected. Applied legacy playtest normalization (/${LEGACY_EDITOR_PLAYTEST_SCALE}).`,
        };
    }

    return {
        scale: runtimeScale,
        warning: null,
    };
}

export function loadCustomMapFromStorage(storageOverride) {
    const capability = resolveCustomMapStorageCapability(storageOverride);
    const storage = getStorage(storageOverride);
    if (!capability.available || !storage) {
        return createCustomMapResult({
            ok: false,
            reason: 'storage_unavailable',
            error: 'Custom-Map-Speicher ist in dieser Umgebung nicht verfuegbar.',
            message: 'Custom-Map konnte nicht geladen werden, weil Browser-Speicher fehlt.',
            capability,
        });
    }

    let rawJSON = null;
    try {
        rawJSON = storage.getItem(CUSTOM_MAP_STORAGE_KEY);
    } catch (error) {
        return createCustomMapResult({
            ok: false,
            reason: 'storage_read_failed',
            error: 'Gespeicherte Custom-Map konnte nicht aus dem Browser-Speicher gelesen werden.',
            message: 'Custom-Map-Speicher konnte nicht gelesen werden.',
            capability,
            details: error?.message || '',
        });
    }

    if (!rawJSON) {
        return createCustomMapResult({
            ok: false,
            reason: 'missing_custom_map',
            error: 'Keine gespeicherte Custom-Map gefunden.',
            message: 'Keine gespeicherte Custom-Map vorhanden. Bitte zuerst aus dem Editor exportieren oder einen Playtest speichern.',
            capability,
        });
    }

    try {
        const parsed = parseMapJSON(rawJSON);
        const conversionScale = getCustomMapConversionScale(parsed.map);
        const converted = toArenaMapDefinition(parsed.map, {
            mapScale: conversionScale.scale,
            name: 'Custom (Editor gespeichert)',
        });
        const warnings = [
            ...parsed.warnings,
            ...(conversionScale.warning ? [conversionScale.warning] : []),
            ...converted.warnings,
        ];
        const migrationApplied = hasMigrationWarnings(warnings);
        return createCustomMapResult({
            ok: true,
            reason: migrationApplied ? 'loaded_with_migration' : (warnings.length > 0 ? 'loaded_with_warnings' : 'loaded'),
            message: migrationApplied
                ? 'Custom-Map geladen und auf den aktuellen Schema-/Runtime-Stand normalisiert.'
                : (warnings.length > 0
                    ? 'Custom-Map geladen, aber mit Hinweisen normalisiert.'
                    : 'Custom-Map geladen.'),
            warnings,
            capability,
            mapDocument: converted.mapDocument,
            mapDefinition: converted.map,
            migration: migrationApplied
                ? {
                    applied: true,
                    targetSchemaVersion: converted.mapDocument?.schemaVersion || null,
                }
                : null,
        });
    } catch (error) {
        logger.error('Error parsing custom map:', error);
        return createCustomMapResult({
            ok: false,
            reason: 'parse_failed',
            error: 'Gespeicherte Custom-Map ist inkompatibel oder defekt.',
            message: 'Custom-Map konnte nicht gelesen werden und faellt auf die Standard-Map zurueck.',
            capability,
            details: error?.message || 'Unknown custom map parsing error.',
        });
    }
}

export function resolveArenaMapSelection(requestedMapKey, storageOverride) {
    const maps = getRuntimeMapCatalog();
    const mapDescriptors = getRuntimeMapPresetRegistryDescriptor(maps).entries;
    const mapKey = String(requestedMapKey || '');
    const fallbackMapKey = resolveFallbackMapKey(maps, mapDescriptors);

    if (mapKey !== CUSTOM_MAP_KEY) {
        return resolveKnownMapSelection({
            requestedMapKey: mapKey,
            maps,
            fallbackMapKey,
            mapDescriptors,
        });
    }

    const customResult = loadCustomMapFromStorage(storageOverride);

    const selection = resolveCustomMapSelection({
        requestedMapKey: mapKey,
        maps,
        fallbackMapKey,
        customResult,
    });

    if (selection.isFallback) {
        logger.warn(`Failed to load custom map, falling back to "${fallbackMapKey}".`, {
            message: selection.message,
            error: selection.error,
            details: selection.details || '',
        });
    }

    return selection;
}
