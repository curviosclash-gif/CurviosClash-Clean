import { DEFAULT_ARENA_SIZE, MAP_SCHEMA_VERSION } from './MapSchemaConstants.js';
import { getPickupDefinition, normalizePickupType } from '../PickupRegistry.js';

export function asFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function asPositiveNumber(value, fallback, min = 0.001) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.max(min, parsed);
}

export function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function cloneJsonValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneJsonValue(entry));
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const clonedEntry = cloneJsonValue(entry);
        if (clonedEntry !== undefined) {
            result[key] = clonedEntry;
        }
    }
    return result;
}

function sanitizeOptionalId(value) {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function withOptionalId(target, rawId) {
    const id = sanitizeOptionalId(rawId);
    if (id) target.id = id;
    return target;
}

function withOptionalStringField(target, key, value) {
    if (typeof key !== 'string' || key.length === 0) return target;
    if (typeof value !== 'string') return target;
    const normalized = value.trim();
    if (normalized.length > 0) {
        target[key] = normalized;
    }
    return target;
}

function sanitizeVectorArray(raw, fallback = [0, 0, 0]) {
    const source = Array.isArray(raw) ? raw : fallback;
    return [
        asFiniteNumber(source[0], fallback[0] || 0),
        asFiniteNumber(source[1], fallback[1] || 0),
        asFiniteNumber(source[2], fallback[2] || 0),
    ];
}

function pushSanitizeWarning(warnings, message) {
    if (!Array.isArray(warnings) || typeof message !== 'string' || message.length === 0) {
        return;
    }
    warnings.push(message);
}

function normalizeGateType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'slingshot') {
        return { type: 'slingshot', sourceType: normalized, warningCode: null };
    }
    if (normalized === 'boost' || !normalized) {
        return { type: 'boost', sourceType: normalized || 'boost', warningCode: null };
    }
    return { type: 'boost', sourceType: normalized, warningCode: 'map.warning.gate-type' };
}

function normalizePortalMode(value, options = {}) {
    const rawValue = typeof value === 'string'
        ? value.trim()
        : (value === null || value === undefined ? '' : String(value).trim());
    const normalized = rawValue.toLowerCase();
    const hasAuthoredPortalPairs = options.hasAuthoredPortalPairs === true || options.hasAuthoredPortals === true;
    if (normalized === 'dynamic' || normalized === 'authored' || normalized === 'hybrid') {
        return normalized;
    }
    const fallback = options.legacyPreferAuthored === true
        ? 'authored'
        : (hasAuthoredPortalPairs ? 'hybrid' : 'dynamic');
    if (rawValue.length > 0) {
        pushSanitizeWarning(
            options.warnings,
            `Unsupported portalMode "${rawValue}" normalized to "${fallback}".`
        );
        return fallback;
    }
    if (options.legacyPreferAuthored === true) return 'authored';
    if (hasAuthoredPortalPairs) return 'hybrid';
    return 'dynamic';
}

function normalizeItemSpawnMode(value, options = {}) {
    const rawValue = typeof value === 'string'
        ? value.trim()
        : (value === null || value === undefined ? '' : String(value).trim());
    const normalized = rawValue.toLowerCase();
    if (normalized === 'anchor-only' || normalized === 'hybrid' || normalized === 'fallback-random') {
        return normalized;
    }
    const fallback = options.hasAuthoredItems === true ? 'anchor-only' : 'fallback-random';
    if (rawValue.length > 0) {
        pushSanitizeWarning(
            options.warnings,
            `Unsupported itemSpawnMode "${rawValue}" normalized to "${fallback}".`
        );
        return fallback;
    }
    return fallback;
}

function normalizeGlbColliderMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'fallbackonly' || normalized === 'fallback-only' || normalized === 'fallback_box') {
        return 'fallbackOnly';
    }
    if (normalized === 'mesh') {
        return 'mesh';
    }
    return undefined;
}

function normalizeParcoursCheckpointType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'gate';
    return normalized;
}

function sanitizeParcoursCheckpointPosition(source) {
    if (Array.isArray(source?.pos)) {
        return sanitizeVectorArray(source.pos, [0, 0, 0]);
    }
    return sanitizeVectorArray([source?.x, source?.y, source?.z], [0, 0, 0]);
}

function sanitizeForwardVector(raw) {
    if (!Array.isArray(raw)) return undefined;
    const vector = sanitizeVectorArray(raw, [0, 0, 1]);
    const lengthSq = (vector[0] * vector[0]) + (vector[1] * vector[1]) + (vector[2] * vector[2]);
    if (lengthSq < 0.000001) return undefined;
    const invLength = 1 / Math.sqrt(lengthSq);
    return [vector[0] * invLength, vector[1] * invLength, vector[2] * invLength];
}

function sanitizeParcoursRules(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        ordered: source.ordered !== false,
        bidirectionalCheckpoints: source.bidirectionalCheckpoints !== false,
        resetOnDeath: source.resetOnDeath !== false,
        resetToLastValid: source.resetToLastValid === true,
        allowLaneAliases: source.allowLaneAliases !== false,
        winnerByParcoursComplete: source.winnerByParcoursComplete !== false,
        maxSegmentTimeMs: Math.max(0, Math.trunc(asFiniteNumber(source.maxSegmentTimeMs, 0))),
        cooldownMs: Math.max(0, Math.trunc(asFiniteNumber(source.cooldownMs, 450))),
        wrongOrderCooldownMs: Math.max(0, Math.trunc(asFiniteNumber(source.wrongOrderCooldownMs, 650))),
        wrongOrderPenaltyMs: Math.max(0, Math.trunc(asFiniteNumber(source.wrongOrderPenaltyMs, 2000))),
        errorIndicatorMs: Math.max(0, Math.trunc(asFiniteNumber(source.errorIndicatorMs, 1400))),
        animateCheckpoints: source.animateCheckpoints !== false,
        showGhost: source.showGhost !== false,
    };
}

function sanitizeParcoursCheckpoint(raw, fallbackId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = sanitizeOptionalId(source.id) || fallbackId || undefined;
    const type = normalizeParcoursCheckpointType(source.type);
    const radius = asPositiveNumber(source.radius, 3.5, 0.1);
    const checkpoint = {
        type,
        pos: sanitizeParcoursCheckpointPosition(source),
        radius,
    };

    if (id) checkpoint.id = id;

    const aliasOf = sanitizeOptionalId(source.aliasOf);
    if (aliasOf) {
        checkpoint.aliasOf = aliasOf;
    }

    const nextIds = [
        ...new Set([
            ...asArray(source.nextIds).map((entry) => sanitizeOptionalId(entry)).filter(Boolean),
            sanitizeOptionalId(source.nextId),
        ].filter(Boolean)),
    ];
    if (nextIds.length > 0) {
        checkpoint.nextIds = nextIds;
    }

    const forward = sanitizeForwardVector(source.forward);
    if (forward) {
        checkpoint.forward = forward;
    }

    const params = cloneJsonValue(source.params);
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        checkpoint.params = params;
    }

    return checkpoint;
}

function sanitizeParcoursFinish(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const finish = sanitizeParcoursCheckpoint(raw, 'FINISH');
    finish.type = 'finish';
    return finish;
}

function sanitizeParcours(raw) {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const source = raw;
    const checkpoints = asArray(source.checkpoints)
        .map((entry, index) => sanitizeParcoursCheckpoint(entry, `CP${String(index + 1).padStart(2, '0')}`))
        .filter((entry) => Array.isArray(entry.pos));

    const finish = sanitizeParcoursFinish(source.finish);
    const enabled = source.enabled === true || checkpoints.length > 0 || !!finish;
    if (!enabled) {
        return undefined;
    }

    return {
        enabled: true,
        routeId: sanitizeOptionalId(source.routeId) || 'custom_route_v1',
        checkpoints,
        rules: sanitizeParcoursRules(source.rules),
        finish,
    };
}

export function sanitizeArenaSize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        width: asPositiveNumber(source.width, DEFAULT_ARENA_SIZE.width, 1),
        height: asPositiveNumber(source.height, DEFAULT_ARENA_SIZE.height, 1),
        depth: asPositiveNumber(source.depth, DEFAULT_ARENA_SIZE.depth, 1),
    };
}

export function sanitizeVector3(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return withOptionalId({
        x: asFiniteNumber(source.x, fallback.x),
        y: asFiniteNumber(source.y, fallback.y),
        z: asFiniteNumber(source.z, fallback.z),
    }, source.id);
}

export function sanitizeBlock(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacySize = asPositiveNumber(source.size, 140, 1);
    const width = asPositiveNumber(source.width, legacySize * 2, 1);
    const depth = asPositiveNumber(source.depth, legacySize * 2, 1);
    const height = asPositiveNumber(source.height, legacySize * 2, 1);
    const result = withOptionalId({
        x: asFiniteNumber(source.x, 0),
        y: asFiniteNumber(source.y, 0),
        z: asFiniteNumber(source.z, 0),
        width,
        depth,
        height,
        size: asPositiveNumber(source.size, Math.max(width, depth, height) * 0.5, 1),
        rotateY: asFiniteNumber(source.rotateY, 0),
    }, source.id);

    if (source.tunnel && typeof source.tunnel === 'object') {
        result.tunnel = {
            radius: asPositiveNumber(source.tunnel.radius, Math.min(width, height, depth) * 0.3, 0.1),
            axis: source.tunnel.axis === 'x' || source.tunnel.axis === 'y' || source.tunnel.axis === 'z'
                ? source.tunnel.axis
                : 'z',
        };
    }

    return result;
}

export function sanitizeTunnel(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return withOptionalStringField(withOptionalId({
        ax: asFiniteNumber(source.ax, 0),
        ay: asFiniteNumber(source.ay, 0),
        az: asFiniteNumber(source.az, 0),
        bx: asFiniteNumber(source.bx, 0),
        by: asFiniteNumber(source.by, 0),
        bz: asFiniteNumber(source.bz, 0),
        radius: asPositiveNumber(source.radius, 160, 1),
    }, source.id), 'model', source.model);
}

export function sanitizePortal(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return withOptionalStringField(withOptionalId({
        x: asFiniteNumber(source.x, 0),
        y: asFiniteNumber(source.y, 0),
        z: asFiniteNumber(source.z, 0),
        radius: asPositiveNumber(source.radius, 80, 1),
    }, source.id), 'model', source.model);
}

function sanitizePortalList(rawPortals, options = {}) {
    const portals = [];
    const warnings = Array.isArray(options.warnings) ? options.warnings : null;
    asArray(rawPortals).forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            pushSanitizeWarning(warnings, `Portal entry ${index + 1} was ignored because it is not an object.`);
            return;
        }

        const hasLegacyPairShape = Object.prototype.hasOwnProperty.call(entry, 'a')
            || Object.prototype.hasOwnProperty.call(entry, 'b');
        if (Array.isArray(entry?.a) && Array.isArray(entry?.b)) {
            const radius = asPositiveNumber(entry.radius, 80, 1);
            portals.push(sanitizePortal({ x: entry.a[0], y: entry.a[1], z: entry.a[2], radius }));
            portals.push(sanitizePortal({ x: entry.b[0], y: entry.b[1], z: entry.b[2], radius }));
            return;
        }
        if (hasLegacyPairShape) {
            pushSanitizeWarning(
                warnings,
                `Portal pair ${index + 1} was ignored because both "a" and "b" vectors are required.`
            );
            return;
        }

        const hasPosition = Number.isFinite(Number(entry.x))
            || Number.isFinite(Number(entry.y))
            || Number.isFinite(Number(entry.z));
        if (!hasPosition) {
            pushSanitizeWarning(
                warnings,
                `Portal entry ${index + 1} was ignored because it has no numeric position.`
            );
            return;
        }
        portals.push(sanitizePortal(entry));
    });
    return portals;
}

export function sanitizeItem(raw, options = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const warnings = Array.isArray(options.warnings) ? options.warnings : null;
    const itemLabel = sanitizeOptionalId(source.id) || `#${Math.max(1, Math.trunc(Number(options.index) || 0) + 1)}`;
    const result = withOptionalId({
        type: String(source.type || 'item_crystal'),
        x: asFiniteNumber(source.x, 0),
        y: asFiniteNumber(source.y, 0),
        z: asFiniteNumber(source.z, 0),
        rotateY: asFiniteNumber(source.rotateY, 0),
        weight: asPositiveNumber(source.weight, 1, 0.01),
    }, source.id);
    withOptionalStringField(result, 'model', source.model);
    const normalizedPickupType = normalizePickupType(source.pickupType, {
        fallback: typeof source.pickupType === 'string' ? source.pickupType : '',
    });
    if (normalizedPickupType) {
        if (getPickupDefinition(normalizedPickupType)) {
            withOptionalStringField(result, 'pickupType', normalizedPickupType);
        } else {
            pushSanitizeWarning(
                warnings,
                `Item anchor ${itemLabel} uses unsupported pickupType "${normalizedPickupType}"; runtime falls back to item type/model.`
            );
        }
    }
    return result;
}

export function sanitizeAircraft(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return withOptionalId({
        jetId: String(source.jetId || 'jet_ship5'),
        x: asFiniteNumber(source.x, 0),
        y: asFiniteNumber(source.y, 0),
        z: asFiniteNumber(source.z, 0),
        scale: asPositiveNumber(source.scale, 50, 0.1),
        rotateY: asFiniteNumber(source.rotateY, 0),
    }, source.id);
}

export function sanitizePortalLevels(raw) {
    const levels = asArray(raw)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
    if (levels.length === 0) return [];

    const seen = new Set();
    const uniqueLevels = [];
    for (const level of levels) {
        const rounded = Math.round(level * 1000) / 1000;
        const key = String(rounded);
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueLevels.push(level);
    }
    uniqueLevels.sort((a, b) => a - b);
    return uniqueLevels;
}

export function sanitizeGate(raw, options = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const warnings = Array.isArray(options.warnings) ? options.warnings : null;
    const typeInfo = normalizeGateType(source.type);
    const fallbackPosition = [0, 0, 0];
    const pos = Array.isArray(source.pos)
        ? sanitizeVectorArray(source.pos, fallbackPosition)
        : sanitizeVectorArray([source.x, source.y, source.z], fallbackPosition);
    const result = withOptionalId({
        type: typeInfo.type,
        pos,
        radius: asPositiveNumber(source.radius, typeInfo.type === 'boost' ? 3.25 : 2.9, 0.1),
    }, source.id);

    if (Array.isArray(source.rot)) {
        result.rot = sanitizeVectorArray(source.rot, [0, 0, 0]);
    }

    if (Array.isArray(source.forward)) {
        result.forward = sanitizeVectorArray(source.forward, [0, 0, 1]);
    }

    if (Array.isArray(source.up)) {
        result.up = sanitizeVectorArray(source.up, [0, 1, 0]);
    }

    if (Number.isFinite(Number(source.color))) {
        result.color = Math.round(Number(source.color));
    }

    const params = cloneJsonValue(source.params);
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        result.params = params;
    }

    if (typeInfo.sourceType && typeInfo.sourceType !== typeInfo.type) {
        result.legacyType = typeInfo.sourceType;
    }
    if (typeInfo.warningCode) {
        result.warningCode = typeInfo.warningCode;
        pushSanitizeWarning(warnings, `Unknown gate type "${typeInfo.sourceType}" normalized to "${typeInfo.type}".`);
    }

    return result;
}

function sanitizeGateList(rawGates, options = {}) {
    const gates = [];
    const warnings = Array.isArray(options.warnings) ? options.warnings : null;

    asArray(rawGates).forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            pushSanitizeWarning(warnings, `Gate entry ${index + 1} was ignored because it is not an object.`);
            return;
        }

        const hasPosArray = Array.isArray(entry.pos) && entry.pos.length >= 3;
        const hasVectorCoordinates = Number.isFinite(Number(entry.x))
            || Number.isFinite(Number(entry.y))
            || Number.isFinite(Number(entry.z));
        if (!hasPosArray && !hasVectorCoordinates) {
            pushSanitizeWarning(
                warnings,
                `Gate entry ${index + 1} was ignored because it has no numeric position.`
            );
            return;
        }

        gates.push(sanitizeGate(entry, { warnings }));
    });

    return gates;
}

export function normalizeMapSchemaDocument(rawMap, options = {}) {
    if (!rawMap || typeof rawMap !== 'object') {
        throw new Error('Map root must be an object.');
    }

    const arenaSize = sanitizeArenaSize(rawMap.arenaSize);
    const playerSpawnDefault = { x: -800, y: arenaSize.height * 0.55, z: 0 };
    const warnings = Array.isArray(options.warnings) ? options.warnings : null;
    const portals = sanitizePortalList(rawMap.portals, { warnings });
    const items = asArray(rawMap.items).map((entry, index) => sanitizeItem(entry, { warnings, index }));

    const normalized = withOptionalStringField({
        schemaVersion: MAP_SCHEMA_VERSION,
        arenaSize,
        tunnels: asArray(rawMap.tunnels).map((entry) => sanitizeTunnel(entry)),
        hardBlocks: asArray(rawMap.hardBlocks).map((entry) => sanitizeBlock(entry)),
        foamBlocks: asArray(rawMap.foamBlocks).map((entry) => sanitizeBlock(entry)),
        portals,
        portalLevels: sanitizePortalLevels(rawMap.portalLevels),
        gates: sanitizeGateList(rawMap.gates, { warnings }),
        items,
        aircraft: asArray(rawMap.aircraft).map((entry) => sanitizeAircraft(entry)),
        botSpawns: asArray(rawMap.botSpawns).map((entry) => sanitizeVector3(entry, { x: 0, y: playerSpawnDefault.y, z: 0 })),
        playerSpawn: sanitizeVector3(rawMap.playerSpawn, playerSpawnDefault),
        preferAuthoredPortals: rawMap.preferAuthoredPortals === true,
        portalMode: normalizePortalMode(rawMap.portalMode, {
            legacyPreferAuthored: rawMap.preferAuthoredPortals === true,
            hasAuthoredPortalPairs: Math.floor(portals.length / 2) > 0,
            warnings,
        }),
        itemSpawnMode: normalizeItemSpawnMode(rawMap.itemSpawnMode, {
            hasAuthoredItems: items.length > 0,
            warnings,
        }),
    }, 'glbModel', rawMap.glbModel);

    const glbColliderMode = normalizeGlbColliderMode(rawMap.glbColliderMode);
    if (glbColliderMode) {
        normalized.glbColliderMode = glbColliderMode;
    }

    const parcours = sanitizeParcours(rawMap.parcours);
    if (parcours) {
        normalized.parcours = parcours;
    }

    return normalized;
}
