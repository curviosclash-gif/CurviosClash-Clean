import { DEFAULT_ARENA_SIZE, MAP_SCHEMA_VERSION } from './MapSchemaConstants.js';
import { resolveArtifactVersionState } from '../../shared/contracts/ArtifactVersionMigrationContract.js';
import {
    asArray,
    asPositiveNumber,
    normalizeMapSchemaDocument,
    sanitizeBlock,
    sanitizePortal,
} from './MapSchemaSanitizeOps.js';

function sanitizeLegacyRuntimeMapDocument(rawMap, warnings) {
    const runtimeSize = Array.isArray(rawMap?.size) ? rawMap.size : [];
    const width = asPositiveNumber(runtimeSize[0], DEFAULT_ARENA_SIZE.width, 1);
    const height = asPositiveNumber(runtimeSize[1], DEFAULT_ARENA_SIZE.height, 1);
    const depth = asPositiveNumber(runtimeSize[2], DEFAULT_ARENA_SIZE.depth, 1);

    const hardBlocks = [];
    for (const obstacle of asArray(rawMap?.obstacles)) {
        const pos = Array.isArray(obstacle?.pos) ? obstacle.pos : [0, 0, 0];
        const size = Array.isArray(obstacle?.size) ? obstacle.size : [2, 2, 2];
        const block = sanitizeBlock({
            x: pos[0],
            y: pos[1],
            z: pos[2],
            width: size[0],
            height: size[1],
            depth: size[2],
        });
        hardBlocks.push(block);
    }

    const portals = [];
    for (const pair of asArray(rawMap?.portals)) {
        if (!Array.isArray(pair?.a) || !Array.isArray(pair?.b)) {
            continue;
        }
        portals.push(sanitizePortal({ x: pair.a[0], y: pair.a[1], z: pair.a[2], radius: 80 }));
        portals.push(sanitizePortal({ x: pair.b[0], y: pair.b[1], z: pair.b[2], radius: 80 }));
    }

    warnings.push('Legacy runtime map format detected. Converted to editor schema v4.');

    return {
        schemaVersion: MAP_SCHEMA_VERSION,
        arenaSize: { width, height, depth },
        tunnels: [],
        hardBlocks,
        foamBlocks: [],
        portals,
        portalLevels: [],
        gates: [],
        items: [],
        aircraft: [],
        botSpawns: [],
        playerSpawn: {
            x: -800,
            y: height * 0.55,
            z: 0,
        },
        preferAuthoredPortals: false,
        portalMode: 'dynamic',
        itemSpawnMode: 'fallback-random',
        glbModel: typeof rawMap?.glbModel === 'string' ? rawMap.glbModel : undefined,
        glbColliderMode: typeof rawMap?.glbColliderMode === 'string' ? rawMap.glbColliderMode : undefined,
    };
}

export function migrateMapDocument(rawMap) {
    if (!rawMap || typeof rawMap !== 'object') {
        throw new Error('Map data must be a JSON object.');
    }

    const warnings = [];
    const versionState = resolveArtifactVersionState(rawMap, {
        artifactType: 'map-schema',
        versionFields: ['schemaVersion'],
        supportedVersions: [1, 2, 3, MAP_SCHEMA_VERSION],
        fallbackVersions: [0],
        currentVersion: MAP_SCHEMA_VERSION,
        allowMissingVersion: true,
        coerceNumericVersions: true,
        shouldFallbackVersion: (value) => Number.isFinite(value) && Number(value) <= 0,
    });
    const schemaVersion = Number.isFinite(Number(versionState.resolvedVersion))
        ? Math.trunc(Number(versionState.resolvedVersion))
        : 0;

    if (versionState.shouldReject) {
        const reportedVersion = Number.isFinite(Number(versionState.resolvedVersion))
            ? String(Math.trunc(Number(versionState.resolvedVersion)))
            : 'unknown';
        throw new Error(`Unsupported schemaVersion ${reportedVersion}. Supported: ${MAP_SCHEMA_VERSION}.`);
    }

    let migrated = rawMap;
    if (versionState.shouldFallback) {
        const looksLikeRuntimeMap = Array.isArray(rawMap.size) && Array.isArray(rawMap.obstacles);
        if (looksLikeRuntimeMap) {
            migrated = sanitizeLegacyRuntimeMapDocument(rawMap, warnings);
        } else {
            warnings.push('Legacy map format detected. Migrated to schema v4.');
            migrated = { ...rawMap, schemaVersion: MAP_SCHEMA_VERSION };
        }
    } else if (versionState.shouldUpgrade && schemaVersion === 1) {
        warnings.push('Map schema v1 detected. Migrating to v4.');
        migrated = { ...rawMap, schemaVersion: MAP_SCHEMA_VERSION };
    } else if (versionState.shouldUpgrade && schemaVersion === 2) {
        warnings.push('Map schema v2 detected. Migrating to v4.');
        migrated = { ...rawMap, schemaVersion: MAP_SCHEMA_VERSION };
    } else if (versionState.shouldUpgrade && schemaVersion === 3) {
        warnings.push('Map schema v3 detected. Migrating to v4.');
        migrated = { ...rawMap, schemaVersion: MAP_SCHEMA_VERSION };
    }

    if (typeof rawMap?.preferAuthoredPortals === 'boolean' && typeof rawMap?.portalMode !== 'string') {
        warnings.push(
            'Legacy preferAuthoredPortals detected without explicit portalMode; normalized via dynamic/authored/hybrid contract.'
        );
    }

    const map = normalizeMapSchemaDocument(migrated, { warnings });
    return {
        map,
        warnings,
    };
}

export function parseMapJSON(jsonText) {
    if (typeof jsonText !== 'string') {
        throw new Error('Map JSON must be a string.');
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
    }
    return migrateMapDocument(parsed);
}

export function createMapDocument(data = {}, options = {}) {
    const normalized = normalizeMapSchemaDocument({
        schemaVersion: MAP_SCHEMA_VERSION,
        ...data,
    }, options);
    return normalized;
}

export function stringifyMapDocument(data = {}, indent = 2, options = {}) {
    return JSON.stringify(createMapDocument(data, options), null, indent);
}
