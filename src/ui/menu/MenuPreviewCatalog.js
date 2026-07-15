import { VEHICLE_DEFINITIONS } from '../../entities/vehicle-registry.js';
import { hasGLBMapSource, resolveGLBMapSourceFootprint } from '../../entities/GLBMapLoader.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function countTunnelFeatures(obstacles) {
    return Array.isArray(obstacles)
        ? obstacles.filter((entry) => entry?.tunnel || entry?.shape === 'tube').length
        : 0;
}

export function resolveMapCategory(mapDefinition) {
    const size = Array.isArray(mapDefinition?.size) ? mapDefinition.size : [];
    const width = toNumber(size[0], 80);
    const depth = toNumber(size[2], 80);
    const footprint = width * depth;
    if (footprint < 5000) return 'small';
    if (footprint > 10000) return 'large';
    return 'medium';
}

export function resolveVehicleCategory(vehicleDefinition) {
    const radius = toNumber(vehicleDefinition?.hitbox?.radius, 1.1);
    if (radius <= 1.0) return 'light';
    if (radius >= 1.35) return 'heavy';
    return 'medium';
}

export function listMapPreviewEntries() {
    const maps = getRuntimeMapCatalog();
    return Object.entries(maps).map(([mapKey, mapDefinition]) => {
        const size = Array.isArray(mapDefinition?.size) ? mapDefinition.size : [80, 30, 80];
        const obstacles = Array.isArray(mapDefinition?.obstacles) ? mapDefinition.obstacles.length : 0;
        const portals = Array.isArray(mapDefinition?.portals) ? mapDefinition.portals.length : 0;
        const gates = Array.isArray(mapDefinition?.gates) ? mapDefinition.gates.length : 0;
        const items = Array.isArray(mapDefinition?.items) ? mapDefinition.items.length : 0;
        const aircraft = Array.isArray(mapDefinition?.aircraft) ? mapDefinition.aircraft.length : 0;
        const portalLevels = Array.isArray(mapDefinition?.portalLevels) ? mapDefinition.portalLevels.length : 0;
        const spawnCount = (mapDefinition?.playerSpawn ? 1 : 0)
            + (Array.isArray(mapDefinition?.botSpawns) ? mapDefinition.botSpawns.length : 0);
        const hasGlbModel = hasGLBMapSource(mapDefinition);
        const glbFootprint = hasGlbModel
            ? resolveGLBMapSourceFootprint(mapDefinition)
            : null;
        const usesFallbackColliders = glbFootprint?.colliderMode === 'fallbackOnly';
        return {
            key: mapKey,
            name: normalizeString(mapDefinition?.name, mapKey),
            sizeText: `${toNumber(size[0], 80)} x ${toNumber(size[1], 30)} x ${toNumber(size[2], 80)}`,
            obstacleCount: obstacles,
            portalCount: portals,
            gateCount: gates,
            tunnelCount: countTunnelFeatures(mapDefinition?.obstacles),
            spawnCount,
            itemAnchorCount: items,
            aircraftCount: aircraft,
            portalLevelCount: portalLevels,
            category: resolveMapCategory(mapDefinition),
            hasGlbModel,
            usesFallbackColliders,
            glbSourceKind: glbFootprint?.sourceKind || 'none',
            glbColliderMode: glbFootprint?.colliderMode || '',
            glbFallbackMode: glbFootprint?.fallbackMode || '',
            renderMode: hasGlbModel ? (usesFallbackColliders ? 'GLB+FALLBACK' : 'GLB') : 'BOX',
        };
    });
}

export function resolveMapPreview(mapKey) {
    const normalizedMapKey = normalizeString(mapKey, 'standard');
    const entry = listMapPreviewEntries().find((candidate) => candidate.key === normalizedMapKey);
    if (entry) return entry;
    return {
        key: normalizedMapKey,
        name: normalizedMapKey,
        sizeText: 'n/a',
        obstacleCount: 0,
        portalCount: 0,
        gateCount: 0,
        tunnelCount: 0,
        spawnCount: 0,
        itemAnchorCount: 0,
        aircraftCount: 0,
        portalLevelCount: 0,
        category: 'medium',
        hasGlbModel: false,
        usesFallbackColliders: false,
        glbSourceKind: 'none',
        glbColliderMode: '',
        glbFallbackMode: '',
        renderMode: 'BOX',
    };
}

export function listVehiclePreviewEntries() {
    return VEHICLE_DEFINITIONS.map((vehicle) => ({
        id: normalizeString(vehicle?.id),
        label: normalizeString(vehicle?.label, vehicle?.id || 'Vehicle'),
        hitboxRadius: toNumber(vehicle?.hitbox?.radius, 1.1),
        category: resolveVehicleCategory(vehicle),
    }));
}

export function resolveVehiclePreview(vehicleId) {
    const normalizedVehicleId = normalizeString(vehicleId);
    const vehicle = listVehiclePreviewEntries().find((candidate) => candidate.id === normalizedVehicleId);
    if (vehicle) return vehicle;
    return {
        id: normalizedVehicleId,
        label: normalizedVehicleId || 'Vehicle',
        hitboxRadius: 1.1,
        category: 'medium',
    };
}
