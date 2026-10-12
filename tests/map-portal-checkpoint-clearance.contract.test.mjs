import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Quaternion, Vector3 } from 'three';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { getPlayerVehicleIds, getVehicleDefinition, getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { ARCADE_PART_SIZE_GROUPS, ARCADE_PART_SIZE_MAX_PCT } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { ARCADE_LAB_MAX_SWEEP_RADIUS, createArcadeLabStarterConfig, validateArcadeLabShip } from '../src/shared/contracts/ArcadeLabContract.js';
import { listRegisteredArcadeLabShips, registerArcadeLabShips } from '../src/shared/contracts/ArcadeLabRegistryContract.js';
import { isArcadeSelectableVehicleId } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { resolveGLBColliderMode } from '../src/entities/mapSchema/MapSchemaGlbOps.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { listCompiledBoxObstacles } from '../scripts/parcours-ring-clearance.mjs';
import { analyzeMapAnchors } from './helpers/map-anchor-guard.mjs';
import { normalizeAllowedGLBUrl } from '../src/entities/mapSchema/MapSchemaGlbOps.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { createPortalGateVisualRegistry } from '../src/entities/arena/PortalGateMeshFactory.js';
import { resolvePortalMode } from '../src/shared/contracts/PortalAuthoringContract.js';
import {
    collectAnimationPoseTimes,
    diagnosePortalBroadHit,
    validatePortalClearancePayload,
    visitPortalApproachesAtPoses,
} from './helpers/map-portal-clearance-probe-worker.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORTAL_PROBE_WORKER = fileURLToPath(new URL('./helpers/map-portal-clearance-probe-worker.mjs', import.meta.url));

const TARGET_MAPS = Object.freeze([
    'eclipse_foundry',
    'kinetic_tide',
    'notre_dame',
    'notre_dame_fire',
]);

const PORTAL_CLEARANCE_BASELINE = Object.freeze({
    eclipse_foundry: Object.freeze({
        pairs: Object.freeze([0, 1, 2, 3]),
        endpoints: Object.freeze([
            Object.freeze({ a: Object.freeze([-102, 36, -29]), b: Object.freeze([-78, 56, 27]) }),
            Object.freeze({ a: Object.freeze([91, 92, -47]), b: Object.freeze([80, 103, 41]) }),
            Object.freeze({ a: Object.freeze([105, 78, 101]), b: Object.freeze([61, 123, 130]) }),
            Object.freeze({ a: Object.freeze([-90, 96, 22]), b: Object.freeze([-25, 72, -59]) }),
        ]),
    }),
    kinetic_tide: Object.freeze({
        pairs: Object.freeze([0, 1, 2, 3]),
        endpoints: Object.freeze([
            Object.freeze({ a: Object.freeze([-139, 29, 27]), b: Object.freeze([-99, 24, 50]) }),
            Object.freeze({ a: Object.freeze([36, 84, -30]), b: Object.freeze([33, 85, 34]) }),
            Object.freeze({ a: Object.freeze([209, 114, 63]), b: Object.freeze([151, 113, 86]) }),
            Object.freeze({ a: Object.freeze([42, 101, 98]), b: Object.freeze([-6, 92, 30]) }),
        ]),
    }),
    notre_dame: Object.freeze({
        pairs: Object.freeze([1, 3]),
        endpoints: Object.freeze({
            1: Object.freeze({ a: Object.freeze([17.15, 83, -52]), b: Object.freeze([44.6, 34, 7]) }),
            3: Object.freeze({ a: Object.freeze([136, 24, 0]), b: Object.freeze([-159, 24, -4]) }),
        }),
    }),
});

// These probes use the actual maximum-size Arcade wall shape for every player-selectable
// registry entry (including registered Arcade Lab ships). Mesh-only craft use their runtime
// hitbox radius as a conservative one-sphere shape; the worker never imports the registry.
const MAX_PART_SIZES = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, ARCADE_PART_SIZE_MAX_PCT]));
const toWorldWallShape = (id, shape) => {
    const scale = SETTINGS_LIMITS.gameplay.planeScale.max;
    const probes = [];
    for (let index = 0; index < shape.probes.length; index += 4) {
        probes.push({ center: [shape.probes[index] * scale, shape.probes[index + 1] * scale, shape.probes[index + 2] * scale], radius: shape.probes[index + 3] * scale });
    }
    return { id, boundRadius: shape.boundRadius * scale, probes };
};
const MAX_LAB_SHAPES = ['fighter', 'allrounder', 'tank'].map((role, index) => {
    const config = createArcadeLabStarterConfig(role);
    const probeId = `arcade_lab_${900 + index}`;
    const validation = validateArcadeLabShip({ id: probeId, config });
    assert.equal(validation.ok, true, `maximum ${role} Lab fixture obeys authored limits`);
    const shape = buildArcadeHitboxShape(config.parts, MAX_PART_SIZES, {
        originScale: resolveArcadeWallHitboxScale(probeId),
    });
    assert.ok(shape.boundRadius <= ARCADE_LAB_MAX_SWEEP_RADIUS,
        `maximum ${role} Lab fixture stays within the validated sweep-radius ceiling`);
    return toWorldWallShape(probeId, shape);
});
// A fresh contract process can have an empty Lab registry. Register these validated selectable
// archetypes explicitly so the probe payload and coverage loops cannot pass vacuously.
const PREEXISTING_LAB_SHIPS = listRegisteredArcadeLabShips();
registerArcadeLabShips([
    ...PREEXISTING_LAB_SHIPS,
    ...MAX_LAB_SHAPES.map((shape, index) => ({
        id: shape.id,
        label: shape.id,
        role: ['fighter', 'allrounder', 'tank'][index],
        config: createArcadeLabStarterConfig(['fighter', 'allrounder', 'tank'][index]),
    })),
]);
const REGISTERED_LAB_SHIPS = listRegisteredArcadeLabShips();
const SELECTABLE_VEHICLE_IDS = [...new Set([
    ...getPlayerVehicleIds().filter((vehicleId) => isArcadeSelectableVehicleId(vehicleId)),
    ...REGISTERED_LAB_SHIPS.filter((entry) => isArcadeSelectableVehicleId(entry.id)).map((entry) => entry.id),
])];
assert.ok(SELECTABLE_VEHICLE_IDS.length > 0 && SELECTABLE_VEHICLE_IDS.length <= 64,
    'portal clearance starts from the bounded current selectable vehicle set');
const VEHICLE_WALL_SHAPES = SELECTABLE_VEHICLE_IDS.map((vehicleId) => {
    const scale = SETTINGS_LIMITS.gameplay.planeScale.max;
    const parts = getVehicleModularConfig(vehicleId)?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
        return toWorldWallShape(vehicleId, buildArcadeHitboxShape(parts, MAX_PART_SIZES, {
            originScale: resolveArcadeWallHitboxScale(vehicleId),
        }));
    }
    const radius = (Number(getVehicleDefinition(vehicleId)?.hitbox?.radius) || CONFIG.PLAYER.HITBOX_RADIUS || 0.8) * scale;
    return { id: vehicleId, boundRadius: radius, probes: [{ center: [0, 0, 0], radius }] };
});
for (const shape of MAX_LAB_SHAPES) {
    if (!VEHICLE_WALL_SHAPES.some((entry) => entry.id === shape.id)) VEHICLE_WALL_SHAPES.push(shape);
}
const MAX_LAB_SWEEP_RADIUS = ARCADE_LAB_MAX_SWEEP_RADIUS * SETTINGS_LIMITS.gameplay.planeScale.max;
VEHICLE_WALL_SHAPES.push({
    id: 'arcade_lab_max_sweep_envelope',
    boundRadius: MAX_LAB_SWEEP_RADIUS,
    probes: [{ center: [0, 0, 0], radius: MAX_LAB_SWEEP_RADIUS }],
    probeMode: 'broad',
});
assert.ok(VEHICLE_WALL_SHAPES.length <= 64,
    `final worker payload including ${MAX_LAB_SHAPES.length} Lab archetypes and envelope fits the 64-shape cap (${VEHICLE_WALL_SHAPES.length})`);
for (const ship of REGISTERED_LAB_SHIPS) {
    if (!isArcadeSelectableVehicleId(ship.id)) continue;
    const shape = VEHICLE_WALL_SHAPES.find((entry) => entry.id === ship.id);
    assert.ok(shape, `${ship.id} is represented in the worker vehicle payload`);
    const raw = buildArcadeHitboxShape(ship.config.parts, MAX_PART_SIZES, {
        originScale: resolveArcadeWallHitboxScale(ship.id),
    });
    assert.ok(raw.boundRadius <= ARCADE_LAB_MAX_SWEEP_RADIUS,
        `${ship.id} maximum part-size wall envelope stays within the validated Lab sweep-radius ceiling`);
}
const MAX_SELECTABLE_WALL_BOUND = Math.max(...VEHICLE_WALL_SHAPES.map((shape) => shape.boundRadius));

// Bounded 3D aim samples plus the authored portal forward. Each point is the runtime 1.8-unit
// destination offset. Coverage is discrete evidence; a successful runtime flight remains needed.
const EXIT_DIRECTIONS = Object.freeze([
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
]);

const RUNTIME_PORTAL_CACHE = new Map();

function getAffectedPortalPairs(mapKey) {
    const baselineKey = mapKey === 'notre_dame_fire' ? 'notre_dame' : mapKey;
    return PORTAL_CLEARANCE_BASELINE[baselineKey].pairs;
}

function getExpectedAuthoredEndpoints(mapKey) {
    const baselineKey = mapKey === 'notre_dame_fire' ? 'notre_dame' : mapKey;
    const baseline = PORTAL_CLEARANCE_BASELINE[baselineKey];
    return baseline.pairs.flatMap((portalIndex) => ['a', 'b'].map((end) => ({
        portalIndex,
        end,
        authored: baseline.endpoints[portalIndex][end],
    })));
}

function buildRuntimePortalSnapshot(mapKey) {
    if (RUNTIME_PORTAL_CACHE.has(mapKey)) return RUNTIME_PORTAL_CACHE.get(mapKey);
    const map = MAP_PRESET_CATALOG[mapKey];
    const scale = CONFIG.ARENA.MAP_SCALE;
    const runtimeConfig = createEntityRuntimeConfig(null);
    runtimeConfig.ARENA.MAP_SCALE = scale;
    runtimeConfig.PORTAL = CONFIG.PORTAL;
    runtimeConfig.GAMEPLAY.PLANAR_MODE = false;
    runtimeConfig.GAMEPLAY.PORTAL_COUNT = 0;
    assert.equal(resolvePortalMode(map), 'authored', `${mapKey} resolves to authored portal mode`);
    const renderer = {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle() { return 'modern'; },
        getMaxAnisotropy() { return 1; },
    };
    const portalResolutionChecks = [];
    const arena = {
        entityRuntimeConfig: runtimeConfig,
        renderer,
        portalsEnabled: true,
        portals: [],
        portalLayoutWarnings: [],
        bounds: {
            minX: -map.size[0] * scale / 2,
            maxX: map.size[0] * scale / 2,
            minY: 0,
            maxY: map.size[1] * scale,
            minZ: -map.size[2] * scale / 2,
            maxZ: map.size[2] * scale / 2,
        },
        openFaces: [],
        playableVolumes: [],
        obstacles: [],
        staticCollisionRevision: 0,
        _pendingObstacleGeos: [],
        _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [],
        _pendingFoamEdgeGeos: [],
        checkCollision(position, radius) {
            const hit = collision.getCollisionInfo(position, radius);
            const tube = hit?.obstacle?.tube;
            const hitBox = hit?.obstacle?.box;
            const tubePoints = tube ? [[tube.ax, tube.ay, tube.az], [tube.bx, tube.by, tube.bz]] : null;
            const same = (left, right) => Math.hypot(...left.map((coordinate, axis) => coordinate - right[axis])) < 1e-6;
            const matchedAuthoredIndex = map.obstacles.findIndex((definition) => {
                if (tubePoints) {
                    if (!['tube', 'beam'].includes(String(definition.shape || '').toLowerCase())) return false;
                    const start = definition.start.map((coordinate) => coordinate * scale);
                    const end = definition.end.map((coordinate) => coordinate * scale);
                    return (same(start, tubePoints[0]) && same(end, tubePoints[1]))
                        || (same(start, tubePoints[1]) && same(end, tubePoints[0]));
                }
                if (!hitBox || !Array.isArray(definition.pos) || !Array.isArray(definition.size)
                    || Boolean(definition.tunnel) !== Boolean(hit.obstacle?.tunnel)) return false;
                const angle = Number(definition.rotateY) || 0;
                const halfX = definition.size[0] * scale / 2;
                const halfY = definition.size[1] * scale / 2;
                const halfZ = definition.size[2] * scale / 2;
                const extentX = Math.abs(Math.cos(angle)) * halfX + Math.abs(Math.sin(angle)) * halfZ;
                const extentZ = Math.abs(Math.sin(angle)) * halfX + Math.abs(Math.cos(angle)) * halfZ;
                const center = definition.pos.map((coordinate) => coordinate * scale);
                return same(hitBox.min.toArray(), [center[0] - extentX, center[1] - halfY, center[2] - extentZ])
                    && same(hitBox.max.toArray(), [center[0] + extentX, center[1] + halfY, center[2] + extentZ]);
            });
            portalResolutionChecks.push({
                point: position.toArray(),
                radius,
                hit: hit ? { sourceName: hit.sourceName || null, sourceId: hit.obstacle?.sourceId || null,
                    modelId: hit.obstacle?.modelId || null, kind: hit.obstacle?.kind || hit.kind || null,
                    colliderType: hit.obstacle?.meshCollider ? 'mesh' : hit.obstacle?.tube ? 'tube'
                        : hit.obstacle?.tunnel ? 'tunnel' : hit.obstacle ? 'box' : 'bounds',
                    obstacleKeys: hit.obstacle ? Object.keys(hit.obstacle) : [],
                    authoredDefinition: matchedAuthoredIndex >= 0 ? {
                        index: matchedAuthoredIndex,
                        id: map.obstacles[matchedAuthoredIndex].id || null,
                        shape: map.obstacles[matchedAuthoredIndex].shape || (map.obstacles[matchedAuthoredIndex].tunnel ? 'tunnel' : 'box'),
                        pos: map.obstacles[matchedAuthoredIndex].pos || null,
                        size: map.obstacles[matchedAuthoredIndex].size || null,
                        start: map.obstacles[matchedAuthoredIndex].start || null,
                        end: map.obstacles[matchedAuthoredIndex].end || null,
                        radius: map.obstacles[matchedAuthoredIndex].radius || map.obstacles[matchedAuthoredIndex].tunnel?.radius || null,
                    } : null,
                    box: hit.obstacle?.box ? { min: hit.obstacle.box.min.toArray(), max: hit.obstacle.box.max.toArray() } : null,
                    isWall: hit.obstacle?.isWall === true || hit.isWall === true } : null,
            });
            return hit;
        },
    };
    const allRuntimeObstacles = !map.glbModels?.length
        || ['dynamic', 'fallbackOnly'].includes(resolveGLBColliderMode(map.glbColliderMode));
    const obstacleDefs = allRuntimeObstacles
        ? map.obstacles
        : map.obstacles.filter((obstacle) => obstacle?.compileWithGlb === true);
    const geometryPipeline = new ArenaGeometryCompilePipeline(arena);
    geometryPipeline.compileObstacleStage({ obstacleDefs, scale });
    const collision = new ArenaCollision(arena);
    const builder = new PortalLayoutBuilder(arena);
    builder._visualRegistry = createPortalGateVisualRegistry(renderer);
    builder._buildPortals(map, scale);
    const snapshot = arena.portals.map((portal) => ({
        posA: portal.posA.toArray(),
        posB: portal.posB.toArray(),
        forwardA: portal.forwardA?.toArray?.() || null,
        forwardB: portal.forwardB?.toArray?.() || null,
    }));
    snapshot.resolutionChecks = portalResolutionChecks;
    builder._disposeVisualRegistry();
    for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
        for (const geometry of arena[key]) geometry.dispose();
    }
    RUNTIME_PORTAL_CACHE.set(mapKey, snapshot);
    return snapshot;
}

function normalizeDirection(direction) {
    const length = Math.hypot(...direction) || 1;
    return direction.map((coordinate) => coordinate / length);
}

function analyze(mapKey) {
    const map = MAP_PRESET_CATALOG[mapKey];
    assert.equal(resolvePortalMode(map), 'authored', `${mapKey} uses authored portals`);
    return analyzeMapAnchors(mapKey, map, CONFIG.ARENA.MAP_SCALE, { checkPortalCheckpointOverlaps: true });
}

function getPortalApproaches(mapKey) {
    const map = MAP_PRESET_CATALOG[mapKey];
    const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
    const routeAnchors = [
        ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
        ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
    ];
    // Retain the nearest-checkpoint route line for the authored portal endpoints that moved.
    const expectedEndpoints = getExpectedAuthoredEndpoints(mapKey);
    const changedPairs = getAffectedPortalPairs(mapKey);
    const routeApproaches = expectedEndpoints.map(({ portalIndex, end }) => {
        const local = map.portals[portalIndex][end];
        const world = local.map((coordinate) => coordinate * CONFIG.ARENA.MAP_SCALE);
        const nearest = routeAnchors.reduce((best, anchor) => {
            const distance = Math.hypot(...world.map((coordinate, axis) => coordinate - anchor.pos[axis]));
            return distance < best.distance ? { anchor, distance } : best;
        }, { anchor: null, distance: Infinity }).anchor;
        const direction = world.map((coordinate, axis) => nearest.pos[axis] - coordinate);
        const length = Math.hypot(...direction) || 1;
        const finish = world.map((coordinate, axis) => coordinate + direction[axis] / length * 12);
        return { portalIndex, end, local, world, nearest, finish };
    });
    // Portal exits are checked for both endpoints of each affected pair. Include the runtime
    // target orientation and a bounded set of 3D aim directions around the actual 1.8 offset.
    const exitApproaches = changedPairs.flatMap((portalIndex) => ['a', 'b'].map((end) => {
        const runtimePair = buildRuntimePortalSnapshot(mapKey)[portalIndex];
        assert.ok(runtimePair, `${mapKey} runtime portal pair ${portalIndex} was built`);
        const world = end === 'a' ? runtimePair.posA : runtimePair.posB;
        const local = world.map((coordinate) => coordinate / CONFIG.ARENA.MAP_SCALE);
        const forward = normalizeDirection((end === 'a' ? runtimePair.forwardA : runtimePair.forwardB) || [0, 0, 1]);
        const directions = [forward, ...EXIT_DIRECTIONS.map(normalizeDirection)];
        const exitPoints = directions.map((direction) => world.map((coordinate, axis) => coordinate + direction[axis] * 1.8));
        return { portalIndex, end, local, world, finish: world, exitPoints };
    }));
    return [...routeApproaches, ...exitApproaches];
}

function modelCanReachApproach(model, approach) {
    // No spatial bound is proven for every authored transform/animation, so retain all
    // collision-enabled models. This avoids false negatives; the option is cost, not coverage.
    return model?.collision !== false;
}

function getCandidateModelIndexes(mapKey) {
    const map = MAP_PRESET_CATALOG[mapKey];
    return map.glbModels.flatMap((model, index) => (
        modelCanReachApproach(model) ? [index] : []
    ));
}

function resolvePortalGlbSelection({
    mapFilter = process.env.CURVIOS_PORTAL_CLEARANCE_MAP || '',
    modelFilter = process.env.CURVIOS_PORTAL_CLEARANCE_MODEL || '',
    endpointFilter = process.env.CURVIOS_PORTAL_CLEARANCE_ENDPOINT || '',
} = {}) {
    const mapKeyFilter = String(mapFilter).trim();
    const modelIdFilter = String(modelFilter).trim();
    const endpointKeyFilter = String(endpointFilter).trim();
    assert.ok(!mapKeyFilter || TARGET_MAPS.includes(mapKeyFilter),
        `unknown portal GLB map filter: ${mapKeyFilter}`);
    assert.ok(!endpointKeyFilter || /^\d+\.[ab]$/.test(endpointKeyFilter),
        `invalid portal GLB endpoint filter: ${endpointKeyFilter}; expected <pairIndex>.a or <pairIndex>.b`);
    assert.ok(!endpointKeyFilter || mapKeyFilter,
        'portal endpoint filtering requires one explicit map filter');

    const mapKeys = mapKeyFilter ? [mapKeyFilter] : TARGET_MAPS;
    let selection = mapKeys.flatMap((mapKey) => getCandidateModelIndexes(mapKey).map((modelIndex) => ({ mapKey, modelIndex })));
    if (modelIdFilter) {
        selection = selection.filter(({ mapKey, modelIndex }) => {
            const model = MAP_PRESET_CATALOG[mapKey].glbModels[modelIndex];
            return model.id === modelIdFilter || model.url === modelIdFilter;
        });
        assert.ok(selection.length > 0, `unknown portal GLB model filter: ${modelIdFilter}`);
        assert.equal(selection.length, 1,
            `portal GLB model filter ${modelIdFilter} is ambiguous; specify its exact map`);
    }
    if (endpointKeyFilter) {
        const [portalIndexText, end] = endpointKeyFilter.split('.');
        const portalIndex = Number(portalIndexText);
        assert.ok(getPortalApproaches(mapKeyFilter).some((approach) => (
            approach.portalIndex === portalIndex && approach.end === end
        )), `unknown portal GLB endpoint filter: ${mapKeyFilter} portal[${endpointKeyFilter.replace('.', '].')}`);
    }
    assert.ok(selection.length > 0, 'portal GLB selection must contain at least one collision-enabled model');
    return {
        selection,
        filters: { map: mapKeyFilter || null, model: modelIdFilter || null, endpoint: endpointKeyFilter || null },
    };
}

function getPortalGlbCoverageMetadata(selection, filters, mapKey = null) {
    const filtered = Object.values(filters).some(Boolean);
    const scopeMapKeys = mapKey
        ? [mapKey]
        : TARGET_MAPS.filter((key) => selection.some((entry) => entry.mapKey === key));
    const eligibleModelCount = scopeMapKeys.reduce((count, key) => count + getCandidateModelIndexes(key).length, 0);
    const selectedModels = selection.filter((entry) => !mapKey || entry.mapKey === mapKey);
    const endpointKeys = scopeMapKeys.flatMap((key) => getPortalApproaches(key)
        .filter((approach) => (approach.exitPoints || []).length > 0)
        .map((approach) => `${key}:${approach.portalIndex}.${approach.end}`))
        .filter((key) => !filters.endpoint || key.endsWith(`:${filters.endpoint}`));
    return {
        coverageComplete: !filtered,
        mode: filtered ? 'filtered-diagnostic' : 'full-catalog',
        eligibleModelCount,
        selectedModelCount: selectedModels.length,
        selectedEndpointCount: new Set(endpointKeys).size,
        diagnosticSubset: filtered,
    };
}

function selectRuntimeObstacleDefs(map) {
    const usesFallback = !map.glbModels?.length
        || ['dynamic', 'fallbackOnly'].includes(resolveGLBColliderMode(map.glbColliderMode));
    return (Array.isArray(map.obstacles) ? map.obstacles : [])
        .filter((obstacle) => usesFallback || obstacle?.compileWithGlb === true);
}

function createPortalProbePayload(mapKey, modelIndex, { endpointFilter = '', coverage = null } = {}) {
    const map = MAP_PRESET_CATALOG[mapKey];
    const model = map.glbModels[modelIndex];
    assert.ok(model, `${mapKey} model index ${modelIndex} exists`);
    return {
        mapKey,
        model,
        mapSize: map.size,
        obstacles: selectRuntimeObstacleDefs(map).map((obstacle, index) => ({
            ...obstacle,
            id: String(obstacle.id || `${mapKey}-runtime-obstacle-${index + 1}`),
        })),
        mapScale: CONFIG.ARENA.MAP_SCALE,
        wallThickness: CONFIG.ARENA.WALL_THICKNESS,
        colliderMode: map.glbColliderMode,
        animationClock: map.glbAnimationClock,
        runtimeMap: { portals: map.portals },
        portalConfig: CONFIG.PORTAL,
        vehicleShapes: VEHICLE_WALL_SHAPES,
        ...(coverage ? { coverage } : {}),
        approaches: getPortalApproaches(mapKey)
            .filter((approach) => !endpointFilter
                || (`${approach.portalIndex}.${approach.end}` === endpointFilter && (approach.exitPoints || []).length > 0))
            .map(({ portalIndex, end, world, finish, exitPoints = [] }) => ({
            portalIndex,
            end,
            world,
            finish,
            exitPoints,
            })),
    };
}

test('optional GLB diagnostic filters select one known model/endpoint and reject unknown filters', () => {
    const full = resolvePortalGlbSelection({ mapFilter: '', modelFilter: '', endpointFilter: '' });
    assert.deepEqual(full.filters, { map: null, model: null, endpoint: null }, 'empty filters preserve the default full-catalog run');
    const fullEligibleCount = TARGET_MAPS.reduce((count, mapKey) => count + getCandidateModelIndexes(mapKey).length, 0);
    assert.equal(full.selection.length, fullEligibleCount, 'default selection retains every collision-enabled model');
    const fullCoverage = getPortalGlbCoverageMetadata(full.selection, full.filters);
    assert.deepEqual(fullCoverage, {
        coverageComplete: true,
        mode: 'full-catalog',
        eligibleModelCount: fullEligibleCount,
        selectedModelCount: fullEligibleCount,
        selectedEndpointCount: new Set(TARGET_MAPS.flatMap((mapKey) => getPortalApproaches(mapKey)
            .filter((approach) => (approach.exitPoints || []).length > 0)
            .map((approach) => `${mapKey}:${approach.portalIndex}.${approach.end}`))).size,
        diagnosticSubset: false,
    }, 'unfiltered metadata identifies complete model and endpoint coverage');

    const filtered = resolvePortalGlbSelection({
        mapFilter: 'eclipse_foundry',
        modelFilter: 'eclipse-foundry-arrival-station',
        endpointFilter: '0.a',
    });
    assert.equal(filtered.selection.length, 1, 'map and exact model filters isolate one GLB descriptor');
    const [{ mapKey, modelIndex }] = filtered.selection;
    const filteredCoverage = getPortalGlbCoverageMetadata(filtered.selection, filtered.filters);
    assert.deepEqual(filteredCoverage, {
        coverageComplete: false,
        mode: 'filtered-diagnostic',
        eligibleModelCount: getCandidateModelIndexes('eclipse_foundry').length,
        selectedModelCount: 1,
        selectedEndpointCount: 1,
        diagnosticSubset: true,
    }, 'explicit map/model/endpoint filters identify a diagnostic subset');
    assert.deepEqual(getPortalGlbCoverageMetadata(filtered.selection, filtered.filters, 'eclipse_foundry'), filteredCoverage,
        'per-map metadata reports the same selected diagnostic scope');
    const payload = createPortalProbePayload(mapKey, modelIndex, {
        endpointFilter: filtered.filters.endpoint,
        coverage: filteredCoverage,
    });
    assert.equal(validatePortalClearancePayload(payload), true,
        'filtered coverage metadata is validated and passed to the child');
    assert.deepEqual(payload.approaches.map(({ portalIndex, end }) => `${portalIndex}.${end}`), ['0.a'],
        'endpoint filter passes only the selected runtime portal end into the child');
    assert.ok(payload.approaches[0].exitPoints.length >= 6, 'filtered endpoint retains bounded 3D runtime-exit probes');
    assert.throws(() => resolvePortalGlbSelection({ mapFilter: 'unknown_map' }), /unknown portal GLB map filter/);
    assert.throws(() => resolvePortalGlbSelection({ mapFilter: 'eclipse_foundry', modelFilter: 'unknown_model' }), /unknown portal GLB model filter/);
    assert.throws(() => resolvePortalGlbSelection({ mapFilter: 'eclipse_foundry', endpointFilter: '9.a' }), /unknown portal GLB endpoint filter/);
});

test('animation probe samples loop and one-shot keyframes at their runtime clock phases', () => {
    const clip = { tracks: [{ times: [0, 1, 3, 4] }] };
    const samples = collectAnimationPoseTimes([
        {
            durationSeconds: 4,
            clock: { mode: 'loop', beatSeconds: 3, phaseOffsetBeats: 1, playbackRate: 2 },
            action: { getClip: () => clip },
        },
        {
            durationSeconds: 4,
            startSeconds: 5,
            clock: { mode: 'once', beatSeconds: 3, phaseOffsetBeats: 9, playbackRate: 2 },
            action: { getClip: () => clip },
        },
    ]);

    assert.deepEqual(samples, [0, 0.25, 0.5, 0.75, 1, 1.5, 5, 5.25, 5.5, 6, 6.5, 6.75, 7]);
});

test('portal worker applies each sampled pose once, then visits every exit approach at that pose', () => {
    const poseTimes = [0, 1, 2];
    const approaches = [
        { id: 'route-line' },
        { id: 'portal-a', exitPoints: [[1, 2, 3], [4, 5, 6]] },
        { id: 'portal-b', exitPoints: [[7, 8, 9]] },
    ];
    const appliedPoses = [];
    const visits = [];
    visitPortalApproachesAtPoses(
        poseTimes,
        approaches,
        (time) => appliedPoses.push(time),
        (approach, time) => visits.push(`${time}:${approach.id}`),
    );
    assert.deepEqual(appliedPoses, poseTimes,
        'animation, world matrices, and dynamic colliders are refreshed once per pose');
    assert.deepEqual(visits, [
        '0:portal-a', '0:portal-b',
        '1:portal-a', '1:portal-b',
        '2:portal-a', '2:portal-b',
    ], 'all exit approaches are checked for every sampled pose while route-only lines remain skipped');
});

test('raw Notre-Dame loop and one-shot descriptors accept production clock defaults', () => {
    const descriptors = MAP_PRESET_CATALOG.notre_dame.glbModels.filter((model) => model.animationClock?.clipName);
    assert.ok(descriptors.some((model) => model.animationClock.mode === 'loop'), 'catalog includes an actual loop descriptor');
    assert.ok(descriptors.some((model) => model.animationClock.mode === 'once'), 'catalog includes actual once descriptors');
    for (const descriptor of descriptors) {
        const modelIndex = MAP_PRESET_CATALOG.notre_dame.glbModels.indexOf(descriptor);
        assert.equal(validatePortalClearancePayload(createPortalProbePayload('notre_dame', modelIndex)), true,
            `${descriptor.id} raw catalog descriptor is valid without normalized-only fields`);
    }
    const partialPayload = createPortalProbePayload('notre_dame', MAP_PRESET_CATALOG.notre_dame.glbModels.indexOf(descriptors[0]));
    partialPayload.model.animationClock = { mode: 'loop', clipName: descriptors[0].animationClock.clipName };
    partialPayload.animationClock = { beatSeconds: -1 };
    assert.equal(validatePortalClearancePayload(partialPayload), true,
        'partial and out-of-range clock fields are accepted for the same runtime normalization defaults');
});

test('portal probe worker payload contains only scoped model and collision inputs', () => {
    const payload = createPortalProbePayload('kinetic_tide', 0);
    assert.deepEqual(Object.keys(payload).sort(), [
        'animationClock',
        'approaches',
        'colliderMode',
        'mapKey',
        'mapScale',
        'mapSize',
        'model',
        'obstacles',
        'portalConfig',
        'runtimeMap',
        'vehicleShapes',
        'wallThickness',
    ]);
    assert.ok(payload.obstacles.length > 0);
    assert.ok(payload.obstacles.some((obstacle) => obstacle.compileWithGlb !== true),
        'dynamic Kinetic Tide payload contains authored boxes without compileWithGlb');
    const changedPairCount = getAffectedPortalPairs('kinetic_tide').length;
    assert.equal(payload.approaches.length, changedPairCount * 4,
        'payload retains both route endpoints and both exit endpoints for every affected pair');
    assert.ok(payload.approaches.some((approach) => approach.exitPoints.length >= 14),
        'payload covers the actual 1.8-unit exit in multiple 3D directions');
    assert.equal(payload.model, MAP_PRESET_CATALOG.kinetic_tide.glbModels[0]);
    assert.equal('parcours' in payload, false);
    assert.equal('allMaps' in payload, false);
    assert.equal(validatePortalClearancePayload(payload), true);
});

test('authored collision-box payload follows Arena dynamic, fallbackOnly, scene, and mesh selection', () => {
    const ordinary = { id: 'ordinary', pos: [0, 10, 0], size: [4, 2, 4] };
    const compiled = { id: 'compiled', pos: [8, 10, 0], size: [4, 2, 4], compileWithGlb: true };
    const tunnelBox = { id: 'tunnel', pos: [0, 20, 0], size: [8, 5, 8], tunnel: { radius: 2, axis: 'y' } };
    const tube = { id: 'tube', shape: 'tube', start: [0, 1, 0], end: [0, 4, 0], radius: 0.5 };
    const beam = { id: 'beam', shape: 'beam', start: [2, 1, 0], end: [2, 4, 0], radius: 0.5, compileWithGlb: true };
    const map = { glbModels: [{ url: 'fixture.glb' }], obstacles: [ordinary, compiled, tunnelBox, tube, beam] };
    for (const mode of ['dynamic', 'fallbackOnly']) {
        assert.deepEqual(selectRuntimeObstacleDefs({ ...map, glbColliderMode: mode }), [ordinary, compiled, tunnelBox, tube, beam],
            `${mode} runtime payload includes box, tunnel, tube, and beam definitions`);
    }
    for (const mode of ['scene', 'mesh']) {
        assert.deepEqual(selectRuntimeObstacleDefs({ ...map, glbColliderMode: mode }), [compiled, beam],
            `${mode} runtime payload retains only compileWithGlb definitions`);
    }
    const payload = createPortalProbePayload('kinetic_tide', 0);
    assert.deepEqual(new Set(payload.obstacles.map((obstacle) => obstacle.shape || (obstacle.tunnel ? 'tunnel' : 'box'))),
        new Set(['box', 'tunnel', 'tube']), 'dynamic Kinetic authored runtime payload retains collider classes');
    assert.equal(validatePortalClearancePayload({ ...payload, obstacles: [beam] }), true,
        'worker accepts the runtime beam definition schema');
});

test('portal exits cover both ends of every changed pair and survive candidate prefiltering', () => {
    for (const mapKey of TARGET_MAPS) {
        const map = MAP_PRESET_CATALOG[mapKey];
        const approaches = getPortalApproaches(mapKey).filter((approach) => approach.exitPoints?.length);
        const pairIndexes = getAffectedPortalPairs(mapKey);
        assert.deepEqual(
            approaches.map(({ portalIndex, end }) => `${portalIndex}.${end}`).sort(),
            pairIndexes.flatMap((index) => [`${index}.a`, `${index}.b`]).sort(),
            `${mapKey} covers both endpoints of every changed portal pair`,
        );
        for (const approach of approaches) {
            assert.ok(approach.exitPoints.every((point) => Math.abs(
                Math.hypot(...point.map((value, axis) => value - approach.world[axis])) - 1.8,
            ) < 1e-9), `${mapKey} sampled endpoint exits use the runtime 1.8-world-unit offset`);
            const clearanceFixture = mapKey === 'eclipse_foundry'
                ? ({
                    '0.b': { pos: [-78, 39, 27], size: [13, 3, 10] },
                    '1.a': { pos: [82, 74, -48], size: [18, 3, 16] },
                    '1.b': { pos: [80, 85, 42], size: [13, 3, 12] },
                    '2.a': {
                        shape: 'tube', start: [100, 98, 96], end: [61, 113, 108], radius: 3.4,
                        boxMin: [171.6, 282.6, 276.6], boxMax: [311.4, 350.4, 335.4],
                    },
                    '2.b': {
                        shape: 'tube', start: [58, 113, 107], end: [35, 112, 96], radius: 5.0,
                        boxMin: [88.8, 319.8, 271.8], boxMax: [190.2, 355.2, 337.2],
                    },
                    '3.a': {
                        shape: 'tube', start: [-40, 99, 48], end: [-63, 85, 3], radius: 4.2,
                        boxMin: [-202.8, 241.2, -4.800000000000001], boxMax: [-106.2, 310.8, 157.8],
                    },
                    '3.b': { pos: [-35, 69, -38], size: [13, 3, 12] },
                }[`${approach.portalIndex}.${approach.end}`] || null)
                : mapKey === 'kinetic_tide' && approach.portalIndex === 0 && approach.end === 'a'
                    ? { pos: [-136, 16, 0], size: [18, 3, 34], boxMin: [-435, 43.5, -51], boxMax: [-381, 52.5, 51] }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'a'
                    ? {
                        shape: 'tube', start: [28, 67, -12], end: [68, 74, -18], radius: 4.2,
                        boxMin: [70.2, 187.2, -67.8], boxMax: [217.8, 235.8, -22.2],
                    }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'b'
                    ? {
                        pos: [52, 78, 32], size: [14, 3, 13],
                        boxMin: [135, 229.5, 76.5], boxMax: [177, 238.5, 115.5], reserve: 0,
                    }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 2 && approach.end === 'a'
                    ? {
                        pos: [190, 100, 58], size: [18, 4, 17],
                        boxMin: [543, 294, 148.5], boxMax: [597, 306, 199.5],
                    }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 2 && approach.end === 'b'
                    ? {
                        pos: [170, 99.2, 96], size: [12, 4, 11],
                        boxMin: [492, 291.6000061035156, 271.5], boxMax: [528, 303.6000061035156, 304.5],
                    }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 3 && approach.end === 'a'
                    ? {
                        shape: 'tube', start: [62, 93, 86], end: [32, 86, 72], radius: 4.2,
                        boxMin: [82.2, 244.2, 202.2], boxMax: [199.8, 292.8, 271.8],
                    }
                : mapKey === 'kinetic_tide' && approach.portalIndex === 3 && approach.end === 'b'
                    ? {
                        shape: 'tube', start: [28, 84, 66], end: [-4, 71, 32], radius: 3.8,
                        boxMin: [-24.599999999999998, 200.4, 83.4], boxMax: [96.6, 264.6, 210.6],
                    }
                : mapKey === 'notre_dame' && approach.portalIndex === 3 && approach.end === 'a'
                    ? {
                        pos: [110, 16, 0], size: [24, 3, 26], compileWithGlb: true,
                        runtimeIndex: 4, boxMin: [294, 43.5, -39], boxMax: [366, 52.5, 39],
                    }
                : mapKey === 'notre_dame' && approach.portalIndex === 3 && approach.end === 'b'
                    ? {
                        pos: [-31, 4, 0], size: [364, 8, 130], compileWithGlb: true,
                        runtimeIndex: 0, boxMin: [-639, 0, -195], boxMax: [453, 24, 195],
                    }
                : null;
            if (clearanceFixture) {
                const supportingObstacle = map.obstacles.find((obstacle) => (
                    clearanceFixture.shape === 'tube'
                        ? obstacle.shape === 'tube'
                            && JSON.stringify(obstacle.start) === JSON.stringify(clearanceFixture.start)
                            && JSON.stringify(obstacle.end) === JSON.stringify(clearanceFixture.end)
                            && obstacle.radius === clearanceFixture.radius
                        : JSON.stringify(obstacle.pos) === JSON.stringify(clearanceFixture.pos)
                            && JSON.stringify(obstacle.size) === JSON.stringify(clearanceFixture.size)
                ));
                assert.ok(supportingObstacle,
                    `${mapKey} portal ${approach.portalIndex}.${approach.end} clearance fixture remains authored`);
                if (clearanceFixture.compileWithGlb === true) {
                    const runtimeObstacleDefs = selectRuntimeObstacleDefs(map);
                    assert.equal(supportingObstacle.compileWithGlb, true,
                        `${mapKey} diagnosed obstacle remains selected for scene-mode authored collision`);
                    assert.equal(runtimeObstacleDefs.indexOf(supportingObstacle), clearanceFixture.runtimeIndex,
                        `${mapKey} diagnosed obstacle remains runtime authored collider ${clearanceFixture.runtimeIndex + 1}`);
                }
                const scale = CONFIG.ARENA.MAP_SCALE;
                let obstacleBox;
                let compiledArena = null;
                if (clearanceFixture.shape === 'tube') {
                    compiledArena = {
                        bounds: { minX: -1_000, maxX: 1_000, minY: 0, maxY: 1_000, minZ: -1_000, maxZ: 1_000 },
                        openFaces: [], obstacles: [], playableVolumes: [],
                        _pendingObstacleGeos: [], _pendingFoamGeos: [],
                        _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
                    };
                    new ArenaGeometryCompilePipeline(compiledArena).compileObstacleStage({
                        obstacleDefs: [supportingObstacle], scale,
                    });
                    const compiledTube = compiledArena.obstacles.find((obstacle) => obstacle.tube);
                    assert.ok(compiledTube, 'authored tube is compiled through ArenaGeometryCompilePipeline');
                    obstacleBox = compiledTube.box;
                    assert.deepEqual(obstacleBox.min.toArray(), clearanceFixture.boxMin,
                        'authored tube compiler bounds match the runtime collider minimum');
                    assert.deepEqual(obstacleBox.max.toArray(), clearanceFixture.boxMax,
                        'authored tube compiler bounds match the runtime collider maximum');
                } else {
                    const obstacleCenter = new Vector3(...supportingObstacle.pos.map((coordinate) => coordinate * scale));
                    const obstacleHalfSize = supportingObstacle.size.map((dimension) => dimension * scale / 2);
                    obstacleBox = new Box3(
                        obstacleCenter.clone().sub(new Vector3(...obstacleHalfSize)),
                        obstacleCenter.clone().add(new Vector3(...obstacleHalfSize)),
                    );
                    if (clearanceFixture.boxMin) {
                        compiledArena = {
                            bounds: { minX: -1_000, maxX: 1_000, minY: 0, maxY: 1_000, minZ: -1_000, maxZ: 1_000 },
                            openFaces: [], obstacles: [], playableVolumes: [],
                            _pendingObstacleGeos: [], _pendingFoamGeos: [],
                            _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
                        };
                        new ArenaGeometryCompilePipeline(compiledArena).compileObstacleStage({
                            obstacleDefs: [supportingObstacle], scale,
                        });
                        const runtimeBox = compiledArena.obstacles.find((obstacle) => obstacle.box)?.box;
                        assert.ok(runtimeBox, `${mapKey} diagnosed authored box compiles through the runtime pipeline`);
                        obstacleBox = runtimeBox;
                        assert.deepEqual(obstacleBox.min.toArray(), clearanceFixture.boxMin,
                            `${mapKey} authored obstacle compiler bounds match the diagnosed minimum`);
                        assert.deepEqual(obstacleBox.max.toArray(), clearanceFixture.boxMax,
                            `${mapKey} authored obstacle compiler bounds match the diagnosed maximum`);
                    }
                }
                if (clearanceFixture.shape !== 'tube') {
                    for (const point of approach.exitPoints) {
                        const closest = new Vector3(...point).clamp(obstacleBox.min, obstacleBox.max);
                        const requiredReserve = clearanceFixture.reserve ?? 8;
                        assert.ok(closest.distanceTo(new Vector3(...point)) >= MAX_LAB_SWEEP_RADIUS + requiredReserve,
                            `${mapKey} portal ${approach.portalIndex}.${approach.end} probe ${JSON.stringify(point)} keeps the Lab envelope plus ${requiredReserve} units reserve from authored obstacle ${map.obstacles.indexOf(supportingObstacle) + 1}`);
                    }
                }
                if (compiledArena) {
                    for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
                        for (const geometry of compiledArena[key]) geometry.dispose();
                    }
                }
            }
            if (mapKey === 'eclipse_foundry' && approach.portalIndex === 2 && approach.end === 'a') {
                const adjacentBox = map.obstacles.find((obstacle) => (
                    JSON.stringify(obstacle.pos) === JSON.stringify([105, 98, 94])
                    && JSON.stringify(obstacle.size) === JSON.stringify([20, 4, 18])
                ));
                assert.ok(adjacentBox, 'Eclipse portal 2.a adjacent authored box fixture remains present');
                const scale = CONFIG.ARENA.MAP_SCALE;
                const center = new Vector3(...adjacentBox.pos.map((coordinate) => coordinate * scale));
                const half = adjacentBox.size.map((dimension) => dimension * scale / 2);
                const box = new Box3(center.clone().sub(new Vector3(...half)), center.clone().add(new Vector3(...half)));
                for (const point of approach.exitPoints) {
                    const closest = new Vector3(...point).clamp(box.min, box.max);
                    assert.ok(closest.distanceTo(new Vector3(...point)) >= MAX_LAB_SWEEP_RADIUS + 8,
                        `Eclipse portal 2.a probe ${JSON.stringify(point)} clears the adjacent authored shipyard box by the full envelope plus reserve`);
                }
            }
            if (mapKey === 'eclipse_foundry' && approach.portalIndex === 2 && approach.end === 'b') {
                const adjacentBox = map.obstacles.find((obstacle) => (
                    JSON.stringify(obstacle.pos) === JSON.stringify([61, 113, 108])
                    && JSON.stringify(obstacle.size) === JSON.stringify([18, 4, 17])
                ));
                assert.ok(adjacentBox, 'Eclipse portal 2.b adjacent authored shipyard box fixture remains present');
                const scale = CONFIG.ARENA.MAP_SCALE;
                const center = new Vector3(...adjacentBox.pos.map((coordinate) => coordinate * scale));
                const half = adjacentBox.size.map((dimension) => dimension * scale / 2);
                const box = new Box3(center.clone().sub(new Vector3(...half)), center.clone().add(new Vector3(...half)));
                for (const point of approach.exitPoints) {
                    const closest = new Vector3(...point).clamp(box.min, box.max);
                    assert.ok(closest.distanceTo(new Vector3(...point)) >= MAX_LAB_SWEEP_RADIUS + 8,
                        `Eclipse portal 2.b probe ${JSON.stringify(point)} clears the adjacent authored shipyard box by the full envelope plus reserve`);
                }
                const route = buildRouteFromParcours(map.parcours, { positionScale: scale });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP12_PORTAL',
                    `Eclipse portal 2.b remains nearest to CP12_PORTAL (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'eclipse_foundry' && approach.portalIndex === 3 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const nearest = route.checkpoints.map((checkpoint) => ({
                    id: checkpoint.id,
                    distance: Math.hypot(...checkpoint.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP15',
                    `Eclipse portal 3.a remains nearest to CP15 (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'eclipse_foundry' && approach.portalIndex === 3 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const nearest = route.checkpoints.map((checkpoint) => ({
                    id: checkpoint.id,
                    distance: Math.hypot(...checkpoint.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP16',
                    `Eclipse portal 3.b remains nearest to CP16 (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 0 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const nearest = route.checkpoints.map((checkpoint) => ({
                    id: checkpoint.id,
                    distance: Math.hypot(...checkpoint.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP03',
                    `Kinetic Tide portal 0.a remains nearest to CP03 (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 0 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const nearest = route.checkpoints.map((checkpoint) => ({
                    id: checkpoint.id,
                    distance: Math.hypot(...checkpoint.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP04_FAST',
                    `Kinetic Tide portal 0.b remains nearest to CP04_FAST (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 120,
                    `Kinetic Tide portal 0.b remains within 120 world units of CP04_FAST (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP08_INNER',
                    `Kinetic Tide portal 1.a remains nearest to CP08_INNER (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 60,
                    `Kinetic Tide portal 1.a remains within 60 world units of CP08_INNER (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP08_OUTER',
                    `Kinetic Tide portal 1.b remains nearest to CP08_OUTER (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 60,
                    `Kinetic Tide portal 1.b remains within 60 world units of CP08_OUTER (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 2 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP12_LIFT',
                    `Kinetic Tide portal 2.a remains nearest to CP12_LIFT (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 120,
                    `Kinetic Tide portal 2.a remains within 120 world units of CP12_LIFT (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 2 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP13',
                    `Kinetic Tide portal 2.b remains nearest to CP13 (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 120,
                    `Kinetic Tide portal 2.b remains within 120 world units of CP13 (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 3 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP15',
                    `Kinetic Tide portal 3.a remains nearest to CP15 (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 120,
                    `Kinetic Tide portal 3.a remains within 120 world units of CP15 (actual ${nearest.distance})`);
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 3 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP16',
                    `Kinetic Tide portal 3.b remains nearest to CP16 (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 120,
                    `Kinetic Tide portal 3.b remains within 120 world units of CP16 (actual ${nearest.distance})`);
            }
            if (mapKey === 'notre_dame' && approach.portalIndex === 3 && approach.end === 'a') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP12',
                    `Notre-Dame portal 3.a remains nearest to CP12 (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'notre_dame' && approach.portalIndex === 3 && approach.end === 'b') {
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP02',
                    `Notre-Dame portal 3.b remains nearest to CP02 (next: ${nearest.id} at ${nearest.distance})`);
            }
            if (mapKey === 'notre_dame' && approach.portalIndex === 1 && approach.end === 'b') {
                const choirApse = map.glbModels.find((model) => model.id === 'notre-dame-choir-apse');
                assert.ok(choirApse, 'Notre-Dame portal 1.b model-clearance fixture has its choir apse model');
                assert.equal(choirApse.url, 'assets/maps/notre_dame/glb/04_choir_apse.glb',
                    'Notre-Dame portal 1.b fixture remains bound to the choir apse GLB');
                assert.deepEqual(choirApse.position, [41.4 * 1.4, 6.88, 0],
                    'Notre-Dame choir apse collider placement matches its authored metre transform');
                assert.deepEqual(choirApse.rotation, [0, 0, 0], 'Notre-Dame choir apse collider remains unrotated');
                assert.equal(choirApse.scale, 1.4, 'Notre-Dame choir apse collider keeps the authored metre scale');
                assert.ok(!(Number(choirApse.targetSize) > 0),
                    'Notre-Dame choir apse is placed by scale, not targetSize, as the envelope below assumes');
                // Portal 1.b was moved off CP09 into the choir, beside the CP10 -> CP11_CHOIR line.
                // Conservative whole-part bounds of the measured 04_choir_apse source (spans
                // 45.4 x 34.4 x 41.7 m), placed like computeCollectionPlacement does: centred on the
                // slot in x/z with its lowest point on the slot height, then grown by 2 % around
                // that production box. The collision shell is non-convex, so this envelope only
                // ties the endpoint to the choir model; mesh clearance is the GLB probe's job.
                const choirScale = choirApse.scale * CONFIG.ARENA.MAP_SCALE;
                const choirSpans = new Vector3(45.4, 34.4, 41.7).multiplyScalar(choirScale);
                const choirHalfSpans = choirSpans.clone().multiplyScalar(1.02 / 2);
                const choirCentre = new Vector3(...choirApse.position).multiplyScalar(CONFIG.ARENA.MAP_SCALE);
                choirCentre.y += choirSpans.y / 2;
                const choirSourceBounds = new Box3(
                    choirCentre.clone().sub(choirHalfSpans),
                    choirCentre.clone().add(choirHalfSpans),
                );
                assert.ok(choirSourceBounds.containsPoint(new Vector3(...approach.world)),
                    'Notre-Dame portal 1.b lies within the choir-apse model envelope (model binding only, not a clearance proof)');
                const builtB = buildRuntimePortalSnapshot(mapKey)[1].posB;
                assert.ok(new Vector3(...builtB).distanceTo(new Vector3(...approach.world)) < 1e-6,
                    `PortalLayoutBuilder keeps Notre-Dame portal 1.b at its authored point instead of rescuing it (built ${JSON.stringify(builtB)})`);
                const transept = map.glbModels.find((model) => model.id === 'notre-dame-transept');
                assert.ok(transept, 'Notre-Dame portal 1.b model-clearance fixture has its transept model');
                assert.equal(transept.url, 'assets/maps/notre_dame/glb/03_transept.glb',
                    'Notre-Dame portal 1.b fixture remains bound to the transept GLB');
                assert.deepEqual(transept.position, [17.15, 6.88, 0],
                    'Notre-Dame transept collider placement matches its authored metre transform');
                assert.deepEqual(transept.rotation, [0, 0, 0], 'Notre-Dame transept collider remains unrotated');
                assert.equal(transept.scale, 1.4, 'Notre-Dame transept collider keeps the authored metre scale');
                const transeptStoneBounds = new Box3(
                    new Vector3(15.750000000000004, 24.000000050067904, -104.57999839782713),
                    new Vector3(87.15, 150.00000005006788, 104.57999839782713),
                );
                for (const point of approach.exitPoints) {
                    const probe = new Vector3(...point);
                    const closest = probe.clone().clamp(transeptStoneBounds.min, transeptStoneBounds.max);
                    assert.ok(closest.distanceTo(probe) >= MAX_LAB_SWEEP_RADIUS + 8,
                        `Notre-Dame portal 1.b probe ${JSON.stringify(point)} clears transept_stone / notre-dame-transept compiled bounds by the sweep envelope plus reserve`);
                }
                const nave = map.glbModels.find((model) => model.id === 'notre-dame-nave');
                assert.ok(nave, 'Notre-Dame portal 1.b model-clearance fixture has its nave model');
                assert.equal(nave.url, 'assets/maps/notre_dame/glb/02_nave.glb',
                    'Notre-Dame portal 1.b fixture remains bound to the nave GLB');
                assert.deepEqual(nave.position, [-34.65, 6.88, 0],
                    'Notre-Dame nave collider placement matches its authored metre transform');
                assert.deepEqual(nave.rotation, [0, 0, 0], 'Notre-Dame nave collider remains unrotated');
                assert.equal(nave.scale, 1.4, 'Notre-Dame nave collider keeps the authored metre scale');
                const naveRuntimeBounds = new Box3(
                    new Vector3(-231.41999659538266, 24.000000050067904, -87.77999839782713),
                    new Vector3(23.51999659538268, 150.00000005006788, 87.77999839782713),
                );
                for (const point of approach.exitPoints) {
                    const probe = new Vector3(...point);
                    const closest = probe.clone().clamp(naveRuntimeBounds.min, naveRuntimeBounds.max);
                    assert.ok(closest.distanceTo(probe) >= MAX_LAB_SWEEP_RADIUS + 8,
                        `Notre-Dame portal 1.b probe ${JSON.stringify(point)} clears nave_stone / notre-dame-nave compiled bounds by the sweep envelope plus reserve`);
                }
                const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
                const anchors = [
                    ...route.checkpoints.map((entry) => ({ id: entry.id, pos: entry.pos })),
                    ...(route.finish ? [{ id: route.finish.id, pos: route.finish.pos }] : []),
                ];
                const nearest = anchors.map((anchor) => ({
                    id: anchor.id,
                    distance: Math.hypot(...anchor.pos.map((coordinate, axis) => coordinate - approach.world[axis])),
                })).sort((left, right) => left.distance - right.distance)[0];
                assert.equal(nearest.id, 'CP11_CHOIR',
                    `Notre-Dame portal 1.b remains nearest to CP11_CHOIR (next: ${nearest.id} at ${nearest.distance})`);
                assert.ok(nearest.distance <= 60,
                    `Notre-Dame portal 1.b remains within 60 world units of CP11_CHOIR (actual ${nearest.distance})`);
            }
            if ((mapKey === 'eclipse_foundry'
                    && ((approach.portalIndex === 2 && ['a', 'b'].includes(approach.end))
                        || (approach.portalIndex === 3 && ['a', 'b'].includes(approach.end))))
                || (mapKey === 'kinetic_tide' && approach.portalIndex === 0
                    && (approach.end === 'a' || (approach.end === 'b' && approach.exitPoints.length > 0)))
                || (mapKey === 'kinetic_tide' && approach.portalIndex === 1
                    && (approach.end === 'a' || approach.end === 'b'))
                || (mapKey === 'kinetic_tide' && approach.portalIndex === 2
                    && ['a', 'b'].includes(approach.end))
                || (mapKey === 'kinetic_tide' && approach.portalIndex === 3
                    && ['a', 'b'].includes(approach.end))
                || (mapKey === 'notre_dame' && approach.portalIndex === 3
                    && ['a', 'b'].includes(approach.end))
                || (mapKey === 'notre_dame' && approach.portalIndex === 1 && approach.end === 'b')) {
                const scale = CONFIG.ARENA.MAP_SCALE;
                const fullArena = {
                    bounds: {
                        minX: -map.size[0] * scale / 2, maxX: map.size[0] * scale / 2,
                        minY: 0, maxY: map.size[1] * scale,
                        minZ: -map.size[2] * scale / 2, maxZ: map.size[2] * scale / 2,
                    },
                    openFaces: [], obstacles: [], playableVolumes: [],
                    _pendingObstacleGeos: [], _pendingFoamGeos: [],
                    _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
                };
                new ArenaGeometryCompilePipeline(fullArena).compileObstacleStage({
                    obstacleDefs: selectRuntimeObstacleDefs(map), scale,
                });
                const fullCollision = new ArenaCollision(fullArena);
                const clearanceRadius = mapKey === 'kinetic_tide'
                    && ((approach.portalIndex === 0 && approach.end === 'b')
                        || (approach.portalIndex === 1 && ['a', 'b'].includes(approach.end)))
                    ? MAX_LAB_SWEEP_RADIUS
                    : MAX_LAB_SWEEP_RADIUS + 8;
                for (const point of approach.exitPoints) {
                    assert.equal(fullCollision.checkCollisionBroad(new Vector3(...point), clearanceRadius), false,
                        `${mapKey} portal ${approach.portalIndex}.${approach.end} probe ${JSON.stringify(point)} clears every authored runtime obstacle and arena bound at radius ${clearanceRadius}`);
                }
                for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
                    for (const geometry of fullArena[key]) geometry.dispose();
                }
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'a') {
                const tubeDefinition = map.obstacles.find((obstacle) => (
                    obstacle.shape === 'tube'
                    && JSON.stringify(obstacle.start) === JSON.stringify([28, 67, -12])
                    && JSON.stringify(obstacle.end) === JSON.stringify([68, 74, -18])
                    && obstacle.radius === 4.2
                ));
                assert.ok(tubeDefinition, 'Kinetic portal 1.a diagnosed authored tube fixture remains present');
                const scale = CONFIG.ARENA.MAP_SCALE;
                const tubeArena = {
                    bounds: { minX: -1_000, maxX: 1_000, minY: 0, maxY: 1_000, minZ: -1_000, maxZ: 1_000 },
                    openFaces: [], obstacles: [], playableVolumes: [],
                    _pendingObstacleGeos: [], _pendingFoamGeos: [],
                    _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
                };
                new ArenaGeometryCompilePipeline(tubeArena).compileObstacleStage({ obstacleDefs: [tubeDefinition], scale });
                const compiledTube = tubeArena.obstacles.find((obstacle) => obstacle.tube);
                assert.ok(compiledTube, 'Kinetic portal 1.a diagnosed tube compiles through the runtime pipeline');
                assert.deepEqual(compiledTube.box.min.toArray(), [70.2, 187.2, -67.8],
                    'Kinetic portal 1.a tube runtime bounds match the diagnosed minimum');
                assert.deepEqual(compiledTube.box.max.toArray(), [217.8, 235.8, -22.2],
                    'Kinetic portal 1.a tube runtime bounds match the diagnosed maximum');
                const tubeCollision = new ArenaCollision(tubeArena);
                for (const point of approach.exitPoints) {
                    const worldPoint = new Vector3(...point);
                    assert.equal(tubeCollision.checkCollisionBroad(worldPoint, MAX_LAB_SWEEP_RADIUS), false,
                        `Kinetic portal 1.a exit ${JSON.stringify(point)} clears diagnosed authored tube at radius ${MAX_LAB_SWEEP_RADIUS}`);
                }
                for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
                    for (const geometry of tubeArena[key]) geometry.dispose();
                }
            }
            if (mapKey === 'kinetic_tide' && approach.portalIndex === 1 && approach.end === 'a') {
                const neighborBox = map.obstacles.find((obstacle) => (
                    JSON.stringify(obstacle.pos) === JSON.stringify([50, 70, -30])
                    && JSON.stringify(obstacle.size) === JSON.stringify([18, 3, 16])
                ));
                assert.ok(neighborBox, 'Kinetic portal 1.a neighboring authored box fixture remains present');
                const scale = CONFIG.ARENA.MAP_SCALE;
                const boxArena = {
                    bounds: { minX: -1_000, maxX: 1_000, minY: 0, maxY: 1_000, minZ: -1_000, maxZ: 1_000 },
                    openFaces: [], obstacles: [], playableVolumes: [],
                    _pendingObstacleGeos: [], _pendingFoamGeos: [],
                    _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
                };
                new ArenaGeometryCompilePipeline(boxArena).compileObstacleStage({ obstacleDefs: [neighborBox], scale });
                const runtimeBox = boxArena.obstacles.find((obstacle) => obstacle.box)?.box;
                assert.ok(runtimeBox, 'Kinetic portal 1.a neighboring box compiles through the runtime pipeline');
                assert.deepEqual(runtimeBox.min.toArray(), [123, 205.5, -114],
                    'Kinetic portal 1.a neighboring box runtime bounds match the diagnosed minimum');
                assert.deepEqual(runtimeBox.max.toArray(), [177, 214.5, -66],
                    'Kinetic portal 1.a neighboring box runtime bounds match the diagnosed maximum');
                const boxCollision = new ArenaCollision(boxArena);
                for (const point of approach.exitPoints) {
                    assert.equal(boxCollision.checkCollisionBroad(new Vector3(...point), MAX_LAB_SWEEP_RADIUS), false,
                        `Kinetic portal 1.a exit ${JSON.stringify(point)} clears neighboring authored box at radius ${MAX_LAB_SWEEP_RADIUS}`);
                }
                for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
                    for (const geometry of boxArena[key]) geometry.dispose();
                }
            }
            if (mapKey === 'eclipse_foundry' && approach.portalIndex === 1 && approach.end === 'a') {
                const neighborObstacle = map.obstacles.find((obstacle) => (
                    JSON.stringify(obstacle.pos) === JSON.stringify([99, 78, -35])
                    && JSON.stringify(obstacle.size) === JSON.stringify([15, 3, 13])
                ));
                assert.ok(neighborObstacle, 'Eclipse portal 1.a neighboring authored obstacle fixture remains present');
                const scale = CONFIG.ARENA.MAP_SCALE;
                const center = new Vector3(...neighborObstacle.pos.map((coordinate) => coordinate * scale));
                const half = neighborObstacle.size.map((dimension) => dimension * scale / 2);
                const box = new Box3(center.clone().sub(new Vector3(...half)), center.clone().add(new Vector3(...half)));
                for (const point of approach.exitPoints) {
                    const closest = new Vector3(...point).clamp(box.min, box.max);
                    assert.ok(closest.distanceTo(new Vector3(...point)) >= MAX_LAB_SWEEP_RADIUS,
                        `Eclipse portal 1.a probe ${JSON.stringify(point)} does not intersect neighboring authored obstacle ${map.obstacles.indexOf(neighborObstacle) + 1}`);
                }
            }
            const point = approach.exitPoints.at(-1);
            const model = {
                id: 'prefilter-point-model',
                url: map.glbModels[0].url,
                targetSize: 0.001,
                position: point.map((coordinate) => coordinate / CONFIG.ARENA.MAP_SCALE),
            };
            assert.equal(modelCanReachApproach(model, approach), true,
                `${mapKey} model bounds at a sampled portal exit remain a candidate`);
        }
        const expectedEndpoints = getExpectedAuthoredEndpoints(mapKey);
        for (const endpoint of expectedEndpoints) {
            assert.deepEqual(map.portals[endpoint.portalIndex][endpoint.end], endpoint.authored,
                `${mapKey} authored endpoint baseline ${endpoint.portalIndex}.${endpoint.end} is unchanged`);
        }
        assert.deepEqual(getCandidateModelIndexes(mapKey), map.glbModels.flatMap((model, index) => (
            model.collision === false ? [] : [index]
        )), `${mapKey} keeps every potentially colliding GLB and filters collision:false before load`);
    }
});

test('vehicle probe orientation matches Player.getDirection local -Z runtime convention', () => {
    const localForward = new Vector3(0, 0, -1);
    for (const direction of EXIT_DIRECTIONS.map(normalizeDirection)) {
        const rotation = new Quaternion().setFromUnitVectors(localForward, new Vector3(...direction));
        const runtimeDirection = localForward.clone().applyQuaternion(rotation).normalize();
        assert.ok(runtimeDirection.distanceTo(new Vector3(...direction)) < 1e-9,
            'worker quaternion transforms Player local -Z forward into the sampled aim direction');
    }
    const playerSource = readFileSync(resolve(REPO_ROOT, 'src/entities/Player.js'), 'utf8');
    assert.match(playerSource, /getDirection\(out\s*=\s*null\)[\s\S]{0,180}set\(0,\s*0,\s*-1\)\.applyQuaternion\(this\.quaternion\)/,
        'runtime Player.getDirection continues to use local -Z and its quaternion');
});

test('selectable registered Lab ships and maximum sweep-envelope archetypes have wall shapes', () => {
    const selectableRegistered = REGISTERED_LAB_SHIPS.filter((entry) => isArcadeSelectableVehicleId(entry.id));
    assert.ok(selectableRegistered.every((ship) => ship.id.startsWith('arcade_lab_')),
        'every registered selectable Lab entry has an Arcade Lab identity');
    for (const ship of selectableRegistered) {
        const wallShape = VEHICLE_WALL_SHAPES.find((shape) => shape.id === ship.id);
        assert.ok(wallShape?.probes.length > 0, `${ship.id} has exact per-part sphere probes`);
        const grown = buildArcadeHitboxShape(ship.config.parts, MAX_PART_SIZES, {
            originScale: resolveArcadeWallHitboxScale(ship.id),
        });
        assert.ok(grown.boundRadius <= ARCADE_LAB_MAX_SWEEP_RADIUS,
            `${ship.id} maximum selectable part sizes remain within the validated sweep-radius ceiling`);
        assert.ok(wallShape.boundRadius >= grown.boundRadius * SETTINGS_LIMITS.gameplay.planeScale.max - 1e-9,
            `${ship.id} serialized wall probes cover its maximum selectable part-size shape at maximum plane scale`);
    }
    assert.equal(MAX_LAB_SHAPES.length, 3, 'fighter, allrounder, and tank Lab size-envelope fixtures are built');
    assert.ok(MAX_LAB_SHAPES.every((shape) => shape.probes.length > 0));
    assert.ok(MAX_LAB_SHAPES.every((shape) => REGISTERED_LAB_SHIPS.some((ship) => ship.id === shape.id)),
        'the three validated archetypes are registered as selectable Lab fixtures even when the initial registry was empty');
    assert.ok(MAX_LAB_SHAPES.every((shape) => VEHICLE_WALL_SHAPES.some((entry) => entry.id === shape.id)),
        'each registered max-size Lab archetype is transferred into the final worker payload');
    assert.ok(getPlayerVehicleIds().filter((id) => isArcadeSelectableVehicleId(id)).every((id) => (
        VEHICLE_WALL_SHAPES.some((shape) => shape.id === id)
    )), 'the worker payload includes every factory vehicle accepted by Arcade selection');
    const envelope = VEHICLE_WALL_SHAPES.find((shape) => shape.id === 'arcade_lab_max_sweep_envelope');
    assert.equal(envelope.probes[0].radius, MAX_LAB_SWEEP_RADIUS,
        'global conservative Lab sphere encloses every valid ship within the validated max sweep radius at max plane scale');
    assert.equal(envelope.probeMode, 'broad', 'the global envelope uses the monotone broad collision API');
    assert.ok(VEHICLE_WALL_SHAPES.length <= 64, 'the final payload cap includes all archetypes and the envelope');
});

test('Lab sweep envelope uses broad tube-end semantics where exact point projection is non-monotone', () => {
    const tube = {
        box: new Box3(new Vector3(0, -2, -2), new Vector3(10, 2, 2)),
        kind: 'hard',
        tube: { ax: 0, ay: 0, az: 0, bx: 10, by: 0, bz: 0, innerRadius: 1, outerRadius: 2, lengthSq: 100 },
        sourceName: 'tube_endpoint_fixture',
    };
    const collision = new ArenaCollision({
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        obstacles: [tube],
    });
    const beyondEnd = new Vector3(11, 1.5, 0);
    assert.equal(collision.getCollisionInfo(beyondEnd, 1.5), null,
        'exact tube query rejects a probe center beyond the segment even when its sphere overlaps the cap');
    assert.equal(collision.checkCollisionBroad(beyondEnd, 1.5), true,
        'broad capsule query includes the rounded tube end and catches the enclosing sphere');
    const workerSource = readFileSync(PORTAL_PROBE_WORKER, 'utf8');
    assert.match(workerSource, /shape\.probeMode === 'broad'[\s\S]{0,180}checkCollisionBroad\(point, sphere\.radius\)/,
        'worker routes the global sweep envelope through the same broad API proven at tube ends');
});

test('broad-hit diagnostics isolate the first touching runtime candidate and preserve its source box', () => {
    const obstacle = {
        box: new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2)),
        kind: 'hard',
        sourceName: 'diagnostic_fixture_piece',
        modelId: 'fixture_glb_model',
    };
    const collision = new ArenaCollision({
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        openFaces: [],
        obstacles: [obstacle],
    });
    const point = new Vector3(2.25, 0, 0);
    const radius = 0.5;
    assert.equal(collision.checkCollisionBroad(point, radius), true, 'the runtime broad query reports contact');
    assert.deepEqual(diagnosePortalBroadHit(collision, point, radius), {
        sourceName: 'diagnostic_fixture_piece',
        modelId: 'fixture_glb_model',
        colliderType: 'box',
        point: [2.25, 0, 0],
        radius: 0.5,
        box: { min: [-2, -2, -2], max: [2, 2, 2] },
    }, 'diagnostic names the first broad-touch candidate and its exact box and sphere probe');
    assert.deepEqual(collision.arena.obstacles, [obstacle], 'candidate isolation restores the runtime obstacle array');
});

test('portal probe worker rejects malformed payloads before loading Arena or GLB code', () => {
    const validPayload = createPortalProbePayload('notre_dame', 0);
    validPayload.coverage = {
        coverageComplete: false,
        mode: 'filtered-diagnostic',
        eligibleModelCount: getCandidateModelIndexes('notre_dame').length,
        selectedModelCount: 1,
        selectedEndpointCount: new Set(validPayload.approaches
            .filter((approach) => approach.exitPoints.length > 0)
            .map((approach) => `${approach.portalIndex}.${approach.end}`)).size,
        diagnosticSubset: true,
    };
    const malformedPayloads = [
        ['map dimensions', (payload) => { payload.mapSize = [460, 0, 320]; }, /map size/],
        ['model identity', (payload) => { delete payload.model.id; }, /model id/],
        ['model URL', (payload) => { payload.model.url = '../outside.glb'; }, /allowed GLB URL/],
        ['non-colliding model', (payload) => { payload.model.collision = false; }, /collision:false.*filtered/],
        ['map scale', (payload) => { payload.mapScale = Infinity; }, /mapScale/],
        ['wall thickness', (payload) => { payload.wallThickness = 0; }, /wallThickness/],
        ['collider mode', (payload) => { payload.colliderMode = 'unknown'; }, /colliderMode/],
        ['authored obstacle identity', (payload) => { delete payload.obstacles[0].id; }, /obstacle 0/],
        ['authored obstacle geometry', (payload) => { payload.obstacles[0].size = [1, 2, NaN]; }, /obstacle 0/],
        ['portal reference', (payload) => { payload.approaches[0].portalIndex = -1; }, /portal index/],
        ['portal end', (payload) => { payload.approaches[0].end = 'c'; }, /portal index/],
        ['portal point vectors', (payload) => { payload.approaches[0].finish = [1, 2]; }, /world and finish/],
        ['coverage endpoint count', (payload) => { payload.coverage.selectedEndpointCount += 1; }, /coverage endpoint count must match/],
        ['unknown vehicle probe mode', (payload) => { payload.vehicleShapes[0].probeMode = 'guess'; }, /probeMode/],
    ];

    for (const [label, mutate, expectedError] of malformedPayloads) {
        const payload = JSON.parse(JSON.stringify(validPayload));
        mutate(payload);
        const child = spawnSync(process.execPath, [PORTAL_PROBE_WORKER], {
            cwd: REPO_ROOT,
            input: JSON.stringify(payload),
            encoding: 'utf8',
            timeout: 10_000,
            maxBuffer: 16 * 1024,
        });
        assert.equal(child.status, 1, `${label}: malformed worker input must exit with validation error`);
        assert.match(child.stderr, expectedError, `${label}: expected a field-specific validation error`);
        assert.doesNotMatch(`${child.stdout}\n${child.stderr}`, /PORTAL_PROBE_MEMORY/,
            `${label}: validation must reject before worker setup or heavy imports`);
    }
});

test('GLB probe stays isolated, checks exact part spheres, and has a best-effort host-headroom watchdog', () => {
    const workerSource = readFileSync(PORTAL_PROBE_WORKER, 'utf8');
    assert.doesNotMatch(workerSource, /import\([^\n]*\/Arena\.js|from ['"][^'"]*\/Arena\.js/,
        'worker avoids the full Arena wrapper and its vehicle-registry graph');
    assert.match(workerSource, /ArenaCollision[\s\S]*ArenaGeometryCompilePipeline[\s\S]*loadGLBMapCollection[\s\S]*GlbAnimationDriver/,
        'worker retains the production collision, compiler, GLB-loader, and animation paths');
    assert.match(workerSource, /const available = freemem\(\)[\s\S]*if \(available < memoryLimit\)[\s\S]*process\.exit\(75\)/,
        'child best-effort checks host free memory and exits when an observed sample falls below the floor');
    assert.doesNotMatch(workerSource, /getCollisionInfo\(exit,\s*shape\.boundRadius\)/,
        'every vehicle part sphere is queried directly without an unproven scalar prefilter');
    assert.match(workerSource, /getCollisionInfo\(point,\s*sphere\.radius\)/,
        'exact per-part sphere probes use runtime collision queries');
    const geometryLoaderSource = readFileSync(fileURLToPath(new URL('./helpers/glb-geometry-loader.mjs', import.meta.url)), 'utf8');
    assert.match(geometryLoaderSource, /result\.byteOffset === 0 && result\.byteLength === result\.buffer\.byteLength/,
        'GLB loader reuses a full-span backing buffer and slices only for a non-full-span view');
});

test('named portal endpoints clear every ordered checkpoint and finish trigger volume', () => {
    for (const mapKey of TARGET_MAPS) {
        const violations = analyze(mapKey).filter((entry) => entry.check === 'portal-checkpoint-trigger-overlap');
        assert.deepEqual(
            violations.map(({ point, reason }) => `${point}: ${reason}`),
            [],
            `${mapKey} portal endpoints must not overlap route triggers at maximum selectable player scale`,
        );
    }
});

test('portal clearance edits preserve named route order, branches, and collision setup', () => {
    const expected = {
        eclipse_foundry: {
            routeId: 'eclipse_foundry_v1',
            sequence: ['CP01', 'CP02', 'CP03', 'CP04_SAFE', 'CP05', 'CP06', 'CP07', 'CP08_BLUE', 'CP09', 'CP10', 'CP11', 'CP12_PORTAL', 'CP13', 'CP14', 'CP15', 'CP16'],
            checkpointIds: ['CP01', 'CP02', 'CP03', 'CP04_SAFE', 'CP04_FAST', 'CP05', 'CP06', 'CP07', 'CP08_BLUE', 'CP08_ORANGE', 'CP09', 'CP10', 'CP11', 'CP12_PORTAL', 'CP12_TECH', 'CP13', 'CP14', 'CP15', 'CP16'],
            obstacleCount: 62,
            glbModelCount: 27,
            glbColliderMode: 'dynamic',
            portalColors: [0x22aaff, 0xff8811, 0xaa66ff, 0x44ffbb],
        },
        kinetic_tide: {
            routeId: 'kinetic_tide_v1',
            sequence: ['CP01', 'CP02', 'CP03', 'CP04_SAFE', 'CP05', 'CP06', 'CP07', 'CP08_INNER', 'CP09', 'CP10', 'CP11', 'CP12_LIFT', 'CP13', 'CP14', 'CP15', 'CP16'],
            checkpointIds: ['CP01', 'CP02', 'CP03', 'CP04_SAFE', 'CP04_FAST', 'CP05', 'CP06', 'CP07', 'CP08_INNER', 'CP08_OUTER', 'CP09', 'CP10', 'CP11', 'CP12_LIFT', 'CP12_TECH', 'CP13', 'CP14', 'CP15', 'CP16'],
            obstacleCount: 105,
            glbModelCount: 43,
            glbColliderMode: 'dynamic',
            portalColors: [0x22ccdd, 0xff8811, 0xaa66ff, 0x44ffbb],
        },
        notre_dame: {
            routeId: 'notre_dame_evolution_v1',
            sequence: ['CP01', 'CP02', 'CP03', 'CP04', 'CP05_ROSE', 'CP06', 'CP07', 'CP08_ATTIC', 'CP09', 'CP10', 'CP11_CHOIR', 'CP11_APSE_EXIT', 'CP11_APSE_APPROACH', 'CP12', 'CP13', 'CP14'],
            checkpointIds: ['CP01', 'CP02', 'CP03', 'CP04', 'CP05_ROSE', 'CP05_PORTAL', 'CP06', 'CP07', 'CP08_ATTIC', 'CP08_AISLE', 'CP09', 'CP10', 'CP11_CHOIR', 'CP11_AMBULATORY', 'CP11_APSE_EXIT', 'CP11_APSE_EXIT_AMBULATORY', 'CP11_APSE_APPROACH', 'CP12', 'CP13', 'CP14'],
            obstacleCount: 5,
            glbModelCount: 45,
            glbColliderMode: 'scene',
            portalColors: [0x77aaff, 0xffaa33, 0xaa66ff, 0x44ffbb],
        },
    };
    for (const mapKey of TARGET_MAPS) {
        const map = MAP_PRESET_CATALOG[mapKey];
        const baselineKey = mapKey === 'notre_dame_fire' ? 'notre_dame' : mapKey;
        const contract = expected[baselineKey];
        const route = buildRouteFromParcours(map.parcours, { positionScale: CONFIG.ARENA.MAP_SCALE });
        assert.equal(route.routeId, contract.routeId, `${mapKey} route identity`);
        assert.deepEqual(route.sequence, contract.sequence, `${mapKey} ordered route and selected lane`);
        assert.deepEqual(route.checkpoints.map((entry) => entry.id), contract.checkpointIds, `${mapKey} checkpoint/lane IDs`);
        assert.equal(route.finish?.id, 'FINISH', `${mapKey} finish identity`);
        assert.ok(route.branches.every((branch) => branch.validMerge), `${mapKey} branch lanes still merge into the route`);
        assert.equal(listCompiledBoxObstacles(map).length, contract.obstacleCount, `${mapKey} compiled authored collision-box count`);
        assert.equal(map.glbModels.length, contract.glbModelCount, `${mapKey} placed GLB count`);
        assert.equal(map.glbColliderMode, contract.glbColliderMode, `${mapKey} GLB collision mode`);
        assert.equal(resolveGLBColliderMode(map.glbColliderMode), contract.glbColliderMode,
            `${mapKey} resolves to the authored runtime collision mode`);
        assert.equal(map.portals.length, 4, `${mapKey} portal pair count`);
        assert.equal(resolvePortalMode(map), 'authored', `${mapKey} resolves its authored portal mode`);
        assert.equal(buildRuntimePortalSnapshot(mapKey).length, 4,
            `${mapKey} runtime authored build resolves and produces all four portal pairs`);
        const collisionArena = { bounds: { minX: -map.size[0] * CONFIG.ARENA.MAP_SCALE / 2,
            maxX: map.size[0] * CONFIG.ARENA.MAP_SCALE / 2, minY: 0, maxY: map.size[1] * CONFIG.ARENA.MAP_SCALE,
            minZ: -map.size[2] * CONFIG.ARENA.MAP_SCALE / 2, maxZ: map.size[2] * CONFIG.ARENA.MAP_SCALE / 2 },
        obstacles: [], openFaces: [], playableVolumes: [],
        _pendingObstacleGeos: [], _pendingFoamGeos: [], _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [] };
        const collisionPipeline = new ArenaGeometryCompilePipeline(collisionArena);
        collisionPipeline.compileObstacleStage({ obstacleDefs: selectRuntimeObstacleDefs(map), scale: CONFIG.ARENA.MAP_SCALE });
        const runtimeCollision = new ArenaCollision(collisionArena);
        const runtimePairs = buildRuntimePortalSnapshot(mapKey);
        for (const endpoint of getExpectedAuthoredEndpoints(mapKey)) {
            const { portalIndex, end, authored } = endpoint;
            const pair = runtimePairs[portalIndex];
            const actual = end === 'a' ? pair.posA : pair.posB;
            {
                const expectedWorld = authored.map((coordinate) => coordinate * CONFIG.ARENA.MAP_SCALE);
                const authoredCheck = buildRuntimePortalSnapshot(mapKey).resolutionChecks.find((entry) => (
                    Math.hypot(...entry.point.map((coordinate, axis) => coordinate - expectedWorld[axis])) < 1e-6
                ));
                const authoredHit = runtimeCollision.getCollisionInfo(new Vector3(...expectedWorld), CONFIG.PORTAL.RADIUS * 0.75);
                const delta = actual.map((coordinate, axis) => coordinate - expectedWorld[axis]);
                assert.deepEqual(actual, expectedWorld,
                    `${mapKey} runtime portal ${portalIndex}.${end} must remain authored; actual=${JSON.stringify(actual)} authored=${JSON.stringify(expectedWorld)} delta=${JSON.stringify(delta)} resolverHit=${JSON.stringify(authoredCheck?.hit)} postBuildHit=${authoredHit?.sourceName || authoredHit?.obstacle?.sourceId || 'none'}`);
                assert.equal(runtimeCollision.getCollisionInfo(new Vector3(...actual), CONFIG.PORTAL.RADIUS * 0.75), null,
                    `${mapKey} runtime portal ${portalIndex}.${end} authored endpoint is clear at runtime placement radius`);
            }
        }
        for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
            for (const geometry of collisionArena[key]) geometry.dispose();
        }
        assert.deepEqual(map.portals.map((portal) => portal.color), contract.portalColors, `${mapKey} portal colors`);
        const misplacedPortalAnchors = analyze(mapKey).filter((entry) => entry.point.startsWith('portals[')
            && ['bounds', 'in-solid'].includes(entry.check));
        assert.deepEqual(misplacedPortalAnchors, [], `${mapKey} moved portal endpoints remain within authored bounds and clear of compiled boxes`);
        // A map that collides on its GLB still compiles every authored obstacle (boxes, tunnels,
        // tubes and beams) when the GLB fails to load, and Arena does that before it builds the
        // portals. Every endpoint must clear that set at the runtime placement radius as well.
        const fallbackArena = { bounds: collisionArena.bounds, obstacles: [], openFaces: [], playableVolumes: [],
            _pendingObstacleGeos: [], _pendingFoamGeos: [], _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [] };
        new ArenaGeometryCompilePipeline(fallbackArena).compileObstacleStage({
            obstacleDefs: selectRuntimeObstacleDefs({ ...map, glbColliderMode: 'fallbackOnly' }),
            scale: CONFIG.ARENA.MAP_SCALE,
        });
        const fallbackCollision = new ArenaCollision(fallbackArena);
        map.portals.forEach((portal, portalIndex) => {
            for (const end of ['a', 'b']) {
                const world = portal[end].map((coordinate) => coordinate * CONFIG.ARENA.MAP_SCALE);
                const hit = fallbackCollision.getCollisionInfo(new Vector3(...world), CONFIG.PORTAL.RADIUS * 0.75);
                assert.equal(hit, null,
                    `${mapKey} portal ${portalIndex}.${end} clears the GLB-failure fallback collision (${hit?.sourceName || hit?.obstacle?.sourceId || 'bounds'})`);
            }
        });
        for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
            for (const geometry of fallbackArena[key]) geometry.dispose();
        }
    }
    assert.deepEqual(MAP_PRESET_CATALOG.notre_dame_fire.portals, MAP_PRESET_CATALOG.notre_dame.portals,
        'the hidden fire alias inherits the corrected portal layout');
    assert.equal(CONFIG.PORTAL.RADIUS, 4, 'the runtime portal trigger radius remains unchanged');
});

const runPortalGLBSamples = process.env.CURVIOS_PORTAL_CLEARANCE_GLBS === '1';
const hasPortalGlbFilters = [
    process.env.CURVIOS_PORTAL_CLEARANCE_MAP,
    process.env.CURVIOS_PORTAL_CLEARANCE_MODEL,
    process.env.CURVIOS_PORTAL_CLEARANCE_ENDPOINT,
].some((value) => String(value || '').trim().length > 0);
const CHILD_TERMINATE_GRACE_MS = 150;
const CHILD_REAP_TIMEOUT_MS = 2_000;
// The full selection launches 95 isolated model workers; keep one bounded catalog deadline,
// with the worker retaining all models, endpoints, animation samples, and exact probes.
const PORTAL_GLB_CATALOG_BUDGET_MS = 30 * 60 * 1000;

function assertSuccessfulPortalChild(child, label, output = '') {
    assert.equal(child.abortReason, null, `${label} must not have an abort reason`);
    assert.equal(child.reaped, true, `${label} child must be reaped before success`);
    assert.equal(child.signal, null, `${label} child must not terminate by signal`);
    assert.equal(child.timedOut, false, `${label} child must not time out`);
    assert.equal(child.abortedForMemory, false, `${label} child must not hit the memory watchdog`);
    assert.equal(child.code, 0, `${label} GLB probe failed:\n${output}`);
}

// Exit code zero alone would also pass a worker that skipped its probe; the result line has to
// name the model and cover every endpoint and coverage record the parent sent.
function assertPortalProbeResult(child, payload, label) {
    const lastLine = String(child.stdout || '').trim().split(/\r?\n/).pop() || '';
    let result = null;
    try { result = JSON.parse(lastLine); } catch { /* reported below */ }
    assert.ok(result && typeof result === 'object', `${label} worker printed no result JSON (last line: ${lastLine.slice(0, 200)})`);
    assert.equal(result.mapKey, payload.mapKey, `${label} result names the probed map`);
    assert.equal(result.modelId, payload.model.id || payload.model.url, `${label} result names the probed model`);
    assert.equal(result.endpoints, payload.approaches.length, `${label} result covers every requested endpoint`);
    assert.ok(Number(result.poseSampleCount) >= 1, `${label} result sampled at least one pose`);
    if (payload.coverage) assert.deepEqual(result.coverage, payload.coverage, `${label} result echoes the requested coverage`);
}

async function waitForPromiseWithin(promise, timeoutMs, message) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function runMonitoredChild(command, args, {
    cwd = REPO_ROOT,
    input = '',
    endInput = true,
    timeoutMs,
    memoryFloorBytes = 2.5 * 1024 * 1024 * 1024,
    readFreeMemory = freemem,
    pollIntervalMs = 250,
    terminateGraceMs = CHILD_TERMINATE_GRACE_MS,
    reapTimeoutMs = CHILD_REAP_TIMEOUT_MS,
    sendSignal = (child, signal) => child.kill(signal),
    onChildSpawn = () => {},
} = {}) {
    const available = readFreeMemory();
    const safetyFloor = memoryFloorBytes;
    assert.ok(available >= safetyFloor,
        `GLB child not started: free RAM ${Math.round(available / 1048576)} MiB below 2560 MiB safety floor of ${Math.round(totalmem() / 1048576)} MiB`);
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    onChildSpawn(child);
    let stdout = '';
    let stderr = '';
    let abortReason = null;
    let termSignalsSent = 0;
    let hardKillsSent = 0;
    let monitor;
    let timeout;
    let graceTimer;
    let reapTimer;
    let resolveReapTimeout;
    const appendTail = (current, chunk, limit = 8192) => `${current}${chunk}`.slice(-limit);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = appendTail(stdout, chunk); });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = appendTail(stderr, chunk); });
    const close = new Promise((resolveClose) => child.once('close', (code, signal) => resolveClose({ code, signal, reaped: true })));
    const reapTimeout = new Promise((resolveTimeout) => { resolveReapTimeout = resolveTimeout; });
    const requestAbort = (reason) => {
        if (abortReason !== null) return;
        abortReason = reason;
        stderr = appendTail(stderr, `\nPORTAL_PROBE_${reason.toUpperCase()}_ABORT parent stopping owned child pid ${child.pid}`);
        termSignalsSent += 1;
        sendSignal(child, 'SIGTERM');
        graceTimer = setTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            hardKillsSent += 1;
            sendSignal(child, 'SIGKILL');
            reapTimer = setTimeout(() => resolveReapTimeout({ code: child.exitCode, signal: child.signalCode, reaped: false }), reapTimeoutMs);
        }, terminateGraceMs);
    };
    monitor = setInterval(() => {
        if (readFreeMemory() < safetyFloor && child.exitCode === null && child.signalCode === null) {
            requestAbort('memory');
        }
    }, pollIntervalMs);
    if (Number.isFinite(timeoutMs)) timeout = setTimeout(() => requestAbort('timeout'), timeoutMs);
    if (input) child.stdin.write(input);
    if (endInput) child.stdin.end();
    try {
        const result = await Promise.race([close, reapTimeout]);
        return {
            ...result,
            stdout,
            stderr,
            abortReason,
            abortedForMemory: abortReason === 'memory',
            timedOut: abortReason === 'timeout',
            termSignalsSent,
            hardKillsSent,
            pid: child.pid,
        };
    } finally {
        clearInterval(monitor);
        if (timeout) clearTimeout(timeout);
        if (graceTimer) clearTimeout(graceTimer);
        if (reapTimer) clearTimeout(reapTimer);
    }
}

async function runMonitoredPortalChild(workerPath, payload, timeoutMs) {
    return runMonitoredChild(process.execPath, [workerPath], {
        input: JSON.stringify(payload),
        timeoutMs,
    });
}

test('best-effort host-headroom watchdog cooperatively stops and reaps only its owned child once', async () => {
    let reads = 0;
    const signals = [];
    const result = await runMonitoredChild(process.execPath, ['-e', 'process.stdin.on("data", () => process.exit(0)); process.stdin.resume(); setInterval(() => {}, 1000)'], {
        input: '',
        endInput: false,
        timeoutMs: 5_000,
        memoryFloorBytes: 100,
        readFreeMemory: () => (++reads === 1 ? 1_000 : 0),
        pollIntervalMs: 10,
        // A cold Node start on a loaded Windows host can take longer than the production grace
        // before its stdin listener exists; this case asserts the cooperative path, not that race.
        terminateGraceMs: 5_000,
        sendSignal: (child, signal) => {
            signals.push(signal);
            if (signal === 'SIGTERM') child.stdin.write('stop');
            else child.kill(signal);
        },
    });
    assert.ok(Number.isInteger(result.pid) && result.pid > 0, 'contract spawned one owned helper child');
    assert.equal(result.abortedForMemory, true, 'injected memory-floor crossing activates the monitor');
    assert.equal(result.abortReason, 'memory', 'memory cause is returned explicitly');
    assert.equal(result.reaped, true, 'cooperative child is closed and reaped within the bound');
    assert.equal(result.code, 0, 'cooperative memory-aborted child exits normally');
    assert.deepEqual(signals, ['SIGTERM'], 'latched memory abort sends exactly one graceful signal');
    assert.equal(result.termSignalsSent, 1);
    assert.equal(result.hardKillsSent, 0, 'cooperative child exits inside the grace period');
    assert.match(result.stderr, /PORTAL_PROBE_MEMORY_ABORT parent stopping owned child/);
    assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' }, 'owned child is reaped before contract success');
});

test('success gate rejects code-zero aborts and any unreaped child', () => {
    assert.doesNotThrow(() => assertSuccessfulPortalChild({
        code: 0, signal: null, reaped: true, abortReason: null, timedOut: false, abortedForMemory: false,
    }, 'fixture'), 'only a normally closed, non-aborted child with code zero passes');
    const normalExitAfterMemoryAbort = {
        code: 0, signal: null, reaped: true, abortReason: 'memory', timedOut: false, abortedForMemory: true,
    };
    assert.throws(() => assertSuccessfulPortalChild(normalExitAfterMemoryAbort, 'fixture'), /abort reason/,
        'code zero cannot turn an aborted child into a successful GLB result');
    const notReaped = {
        code: 0, signal: null, reaped: false, abortReason: null, timedOut: false, abortedForMemory: false,
    };
    assert.throws(() => assertSuccessfulPortalChild(notReaped, 'fixture'), /must be reaped/,
        'reaped:false is always a gate failure even with an otherwise successful result');
    const payload = { mapKey: 'notre_dame', model: { id: 'm' }, approaches: [{}, {}], coverage: { mode: 'full' } };
    const line = (fields) => ({ stdout: `log\n${JSON.stringify({ mapKey: 'notre_dame', modelId: 'm', endpoints: 2, poseSampleCount: 1, coverage: { mode: 'full' }, ...fields })}\n` });
    assert.doesNotThrow(() => assertPortalProbeResult(line({}), payload, 'fixture'), 'a complete result line passes');
    assert.throws(() => assertPortalProbeResult({ stdout: '' }, payload, 'fixture'), /no result JSON/,
        'a code-zero worker that printed no result is a gate failure');
    assert.throws(() => assertPortalProbeResult(line({ endpoints: 1 }), payload, 'fixture'), /every requested endpoint/,
        'a result that skipped an endpoint is a gate failure');
    assert.throws(() => assertPortalProbeResult(line({ poseSampleCount: 0 }), payload, 'fixture'), /at least one pose/,
        'a result without sampled poses is a gate failure');
});

test('parent timeout escalates once for a stalled child and reaps it within a fixed bound', async () => {
    const signals = [];
    const started = Date.now();
    const result = await runMonitoredChild(process.execPath, ['-e', 'process.stderr.write("x".repeat(12000)); process.stdin.resume(); setInterval(() => {}, 1000)'], {
        endInput: false,
        timeoutMs: 35,
        memoryFloorBytes: 0,
        pollIntervalMs: 10,
        terminateGraceMs: 120,
        reapTimeoutMs: 1_000,
        sendSignal: (child, signal) => {
            signals.push(signal);
            if (signal === 'SIGTERM') child.stdin.write('ignored');
            else child.kill(signal);
        },
    });
    assert.ok(Date.now() - started < 2_000, 'bounded TERM grace and KILL reap return under two seconds');
    assert.equal(result.abortReason, 'timeout', 'timeout cause is returned explicitly');
    assert.equal(result.timedOut, true);
    assert.equal(result.reaped, true, 'SIGTERM-ignoring child was reaped after hard-kill escalation');
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'], 'stalled child receives exactly one graceful and one hard kill');
    assert.equal(result.termSignalsSent, 1);
    assert.equal(result.hardKillsSent, 1);
    assert.ok(result.stderr.length <= 8192, 'monitor output retains only its bounded tail');
    assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' }, 'only the owned child is gone');
});

test('reap-timeout result is fail-closed while its owned fixture child exits naturally under cleanup', async () => {
    let fixtureChild;
    let resolveFixtureClose;
    let naturalExitTimer;
    const fixtureClosed = new Promise((resolveClose) => { resolveFixtureClose = resolveClose; });
    const started = Date.now();
    try {
        const result = await runMonitoredChild(process.execPath, ['-e', 'process.stdin.on("data", chunk => { if (chunk.includes("finish") || chunk.includes("cleanup")) process.exit(0); }); process.stdin.resume(); setInterval(() => {}, 1000)'], {
            endInput: false,
            timeoutMs: 25,
            memoryFloorBytes: 0,
            pollIntervalMs: 10,
            terminateGraceMs: 35,
            reapTimeoutMs: 40,
            onChildSpawn: (child) => {
                fixtureChild = child;
                child.once('close', (code, signal) => resolveFixtureClose({ code, signal }));
            },
            sendSignal: (child, signal) => {
                if (signal === 'SIGTERM') child.stdin.write('ignored');
                else naturalExitTimer = setTimeout(() => child.stdin.write('finish'), 300);
            },
        });
        assert.ok(Date.now() - started < 1_000, 'monitor returns at the bounded grace plus reap deadline');
        assert.equal(result.abortReason, 'timeout');
        assert.equal(result.hardKillsSent, 1);
        assert.equal(result.reaped, false, 'ineffective injected SIGKILL produces the actual unreaped result path');
        assert.throws(() => assertSuccessfulPortalChild(result, 'fixture'), /abort reason/,
            'a timed-out child is rejected by the same success gate');
        const closeResult = await waitForPromiseWithin(fixtureClosed, 1_000,
            'owned fixture child did not close within cleanup bound');
        assert.equal(closeResult.code, 0, 'the owned fixture child exits naturally after the monitor returned');
        assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' }, 'only the fixture PID is confirmed reaped');
    } finally {
        if (naturalExitTimer) clearTimeout(naturalExitTimer);
        if (fixtureChild && fixtureChild.exitCode === null && fixtureChild.signalCode === null) {
            fixtureChild.stdin.write('cleanup');
            try {
                await waitForPromiseWithin(fixtureClosed, 1_000, 'owned fixture child cleanup exceeded its bound');
            } catch {
                fixtureChild.kill('SIGKILL');
                try { await waitForPromiseWithin(fixtureClosed, 1_000, 'owned fixture child did not reap after cleanup kill'); } catch { /* preserve the test failure */ }
            }
        }
    }
});

test('full-catalog GLB probe has a bounded 30-minute aggregate budget', () => {
    assert.equal(PORTAL_GLB_CATALOG_BUDGET_MS, 30 * 60 * 1000);
    assert.ok(PORTAL_GLB_CATALOG_BUDGET_MS > 0 && PORTAL_GLB_CATALOG_BUDGET_MS <= 30 * 60 * 1000,
        'the complete model selection remains guarded by a finite aggregate deadline');
});

test(`${hasPortalGlbFilters ? 'FILTERED DIAGNOSTIC ONLY — NOT FULL GATE: ' : ''}sampled GLB poses clear portal approaches (discrete evidence only; runtime flight remains required)`, { skip: !runPortalGLBSamples }, async () => {
    const startedAt = Date.now();
    const maxDurationMs = PORTAL_GLB_CATALOG_BUDGET_MS;
    const maximumEffectiveDurationMs = maxDurationMs + CHILD_TERMINATE_GRACE_MS + CHILD_REAP_TIMEOUT_MS;
    const workerPath = fileURLToPath(new URL('./helpers/map-portal-clearance-probe-worker.mjs', import.meta.url));
    const { selection, filters } = resolvePortalGlbSelection();
    const runCoverage = getPortalGlbCoverageMetadata(selection, filters);
    const selectedMapKeys = TARGET_MAPS.filter((mapKey) => selection.some((entry) => entry.mapKey === mapKey));
    console.info(`PORTAL_GLB_PROBE_SELECTION ${JSON.stringify({
        ...runCoverage,
        filters,
        fullCatalogUnchangedWhenFiltersEmpty: true,
    })}`);
    for (const mapKey of selectedMapKeys) {
        const map = MAP_PRESET_CATALOG[mapKey];
        const candidateIndexes = selection.filter((entry) => entry.mapKey === mapKey).map((entry) => entry.modelIndex);
        const mapCoverage = getPortalGlbCoverageMetadata(selection, filters, mapKey);
        console.info(`PORTAL_GLB_PROBE_MAP ${JSON.stringify({
            mapKey,
            ...mapCoverage,
            filters,
            colliderMode: map.glbColliderMode,
            placedModels: map.glbModels.length,
            elapsedBudgetMs: maxDurationMs,
            maxAbortOverheadMs: CHILD_TERMINATE_GRACE_MS + CHILD_REAP_TIMEOUT_MS,
            maximumEffectiveDurationMs,
            hostMemoryWatchdog: 'best-effort freemem sampling; not a hard child RSS or job-object limit',
            probe: mapCoverage.coverageComplete
                ? 'full-catalog: all collision-enabled models and all affected endpoints selected; collision:false is excluded before load'
                : 'diagnostic subset only; not a full gate',
            maxSelectableWallBound: MAX_SELECTABLE_WALL_BOUND,
            selectableVehicleShapes: VEHICLE_WALL_SHAPES.length,
            exactPerPartSphereProbes: true,
            continuousAnimationClearanceProven: false,
        })}`);

        for (const modelIndex of candidateIndexes) {
            const model = map.glbModels[modelIndex];
            const modelId = model.id || model.url || `model-${modelIndex + 1}`;
            const remainingMs = maxDurationMs - (Date.now() - startedAt);
            assert.ok(remainingMs > 0, `portal GLB probe budget was exhausted before child supervision grace/reap overhead for ${mapKey}/${modelId}`);
            const payload = createPortalProbePayload(mapKey, modelIndex, {
                endpointFilter: filters.endpoint || '',
                coverage: mapCoverage,
            });
            const child = await runMonitoredPortalChild(workerPath, payload, remainingMs);
            const childOutput = `${child.stdout || ''}${child.stderr || ''}`.trim();
            const cappedChildOutput = childOutput.length <= 8192
                ? childOutput
                : `${childOutput.slice(0, 8192)}\n[child output truncated; total ${childOutput.length} chars]`;
            assertSuccessfulPortalChild(child, `${mapKey}/${modelId}`, cappedChildOutput);
            assertPortalProbeResult(child, payload, `${mapKey}/${modelId}`);
            console.info(cappedChildOutput);
        }
    }
});

test.todo('runtime portal flight gate: verify every affected pair with a selectable Arcade vehicle and arbitrary 3D aim');
