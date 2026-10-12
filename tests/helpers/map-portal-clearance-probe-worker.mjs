import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAllowedGLBUrl } from '../../src/entities/mapSchema/MapSchemaGlbOps.js';
import { normalizeMapAnimationClock } from '../../src/shared/contracts/MapAnimationClockContract.js';

const COLLIDER_MODES = new Set(['dynamic', 'scene', 'mesh', 'fallbackOnly']);

function isFiniteVector3(value) {
    return Array.isArray(value)
        && value.length === 3
        && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function assertPositiveFinite(value, field, mapKey) {
    assert.ok(typeof value === 'number' && Number.isFinite(value) && value > 0,
        `${mapKey} worker payload ${field} must be finite and positive`);
}

export function validatePortalClearancePayload(payload) {
    assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload),
        'portal worker payload must be an object');
    const { mapKey, model, mapSize, obstacles, mapScale, wallThickness, colliderMode, animationClock, approaches, vehicleShapes, runtimeMap, portalConfig, coverage } = payload;
    assert.ok(typeof mapKey === 'string' && mapKey.trim().length > 0,
        'portal worker payload mapKey must be a non-empty string');
    assert.ok(model && typeof model === 'object' && !Array.isArray(model),
        `${mapKey} worker payload includes one GLB model object`);
    assert.ok(typeof model.id === 'string' && model.id.trim().length > 0,
        `${mapKey} worker payload model id must be a non-empty string`);
    assert.notEqual(model.collision, false,
        `${mapKey}/${model.id} collision:false GLB descriptors must be filtered before loader invocation`);
    assert.ok(typeof model.url === 'string' && normalizeAllowedGLBUrl(model.url) === model.url.trim().replace(/^\.\//, '').replace(/^\//, ''),
        `${mapKey}/${model.id} worker payload model URL must be an allowed GLB URL`);
    for (const field of ['position', 'rotation']) {
        if (model[field] !== undefined) {
            assert.ok(isFiniteVector3(model[field]),
                `${mapKey}/${model.id} worker payload model ${field} must be a finite 3-number vector`);
        }
    }
    if (model.scale !== undefined) assertPositiveFinite(model.scale, 'model scale', mapKey);
    if (model.targetSize !== undefined) assertPositiveFinite(model.targetSize, 'model targetSize', mapKey);
    // Match GLBMapLoader's permissive defaults. Partial and out-of-range raw descriptors
    // are normalized by production before the animation driver uses them.
    normalizeMapAnimationClock(model.animationClock, normalizeMapAnimationClock(animationClock));

    assert.ok(isFiniteVector3(mapSize) && mapSize.every((dimension) => dimension > 0),
        `${mapKey} worker payload map size must be three finite positive dimensions`);
    assertPositiveFinite(mapScale, 'mapScale', mapKey);
    assertPositiveFinite(wallThickness, 'wallThickness', mapKey);
    assert.ok(COLLIDER_MODES.has(colliderMode),
        `${mapKey} worker payload colliderMode must be one of ${[...COLLIDER_MODES].join(', ')}`);
    assert.ok(runtimeMap && Array.isArray(runtimeMap.portals) && runtimeMap.portals.length === 4,
        `${mapKey} worker payload carries all four runtime portal definitions`);
    assert.ok(portalConfig && Number.isFinite(portalConfig.RADIUS) && portalConfig.RADIUS > 0,
        `${mapKey} worker payload carries runtime portal placement settings`);
    for (const [index, portal] of runtimeMap.portals.entries()) {
        assert.ok(isFiniteVector3(portal?.a) && isFiniteVector3(portal?.b),
            `${mapKey} worker runtime portal ${index} has finite authored endpoints`);
    }
    normalizeMapAnimationClock(animationClock);

    assert.ok(Array.isArray(obstacles),
        `${mapKey}/${model.id} worker payload authored obstacles must be an array`);
    if (coverage !== undefined) {
        assert.ok(coverage && typeof coverage === 'object' && !Array.isArray(coverage),
            `${mapKey}/${model.id} worker coverage metadata must be an object`);
        assert.ok(typeof coverage.coverageComplete === 'boolean'
            && ['full-catalog', 'filtered-diagnostic'].includes(coverage.mode)
            && Number.isInteger(coverage.eligibleModelCount) && coverage.eligibleModelCount > 0
            && Number.isInteger(coverage.selectedModelCount) && coverage.selectedModelCount > 0
            && Number.isInteger(coverage.selectedEndpointCount) && coverage.selectedEndpointCount > 0
            && typeof coverage.diagnosticSubset === 'boolean',
        `${mapKey}/${model.id} worker coverage metadata has a malformed scope/count`);
        assert.equal(coverage.coverageComplete, coverage.mode === 'full-catalog',
            `${mapKey}/${model.id} worker coverage mode and completeness must agree`);
        assert.equal(coverage.diagnosticSubset, !coverage.coverageComplete,
            `${mapKey}/${model.id} worker diagnosticSubset must identify incomplete coverage`);
        if (coverage.coverageComplete) {
            assert.equal(coverage.eligibleModelCount, coverage.selectedModelCount,
                `${mapKey}/${model.id} full-catalog coverage must select every eligible model`);
        }
    }
    assert.ok(Array.isArray(vehicleShapes) && vehicleShapes.length > 0 && vehicleShapes.length <= 64,
        `${mapKey} worker payload includes a bounded set of selectable vehicle hitbox shapes`);
    for (const [index, shape] of vehicleShapes.entries()) {
        assert.ok(shape && typeof shape.id === 'string' && shape.id.length > 0
            && Number.isFinite(shape.boundRadius) && shape.boundRadius > 0
            && Array.isArray(shape.probes) && shape.probes.length > 0 && shape.probes.length <= 256,
        `${mapKey} worker vehicle shape ${index} must have a positive bound and at most 256 sphere probes`);
        assert.ok(shape.probeMode === undefined || shape.probeMode === 'broad',
            `${mapKey} worker vehicle shape ${index} probeMode may only select the conservative broad collision query`);
        for (const probe of shape.probes) {
            assert.ok(isFiniteVector3(probe?.center) && Number.isFinite(probe?.radius) && probe.radius > 0,
                `${mapKey} worker vehicle shape ${index} has a malformed sphere probe`);
        }
    }
    for (const [index, obstacle] of obstacles.entries()) {
        const shape = String(obstacle?.shape || '').toLowerCase();
        const shared = obstacle && typeof obstacle === 'object' && !Array.isArray(obstacle)
            && typeof obstacle.id === 'string' && obstacle.id.trim().length > 0
            && (obstacle.kind === undefined || typeof obstacle.kind === 'string')
            && (obstacle.rotateY === undefined || Number.isFinite(obstacle.rotateY))
            && (obstacle.renderWithGlb === undefined || typeof obstacle.renderWithGlb === 'boolean')
            && (obstacle.compileWithGlb === undefined || typeof obstacle.compileWithGlb === 'boolean');
        const validVector = (value) => isFiniteVector3(value);
        const validBox = validVector(obstacle?.pos) && validVector(obstacle?.size)
            && obstacle.size.every((dimension) => dimension > 0)
            && (obstacle.tunnel === undefined || (obstacle.tunnel && typeof obstacle.tunnel === 'object'
                && !Array.isArray(obstacle.tunnel)
                && (obstacle.tunnel.radius === undefined || Number.isFinite(obstacle.tunnel.radius))
                && (obstacle.tunnel.axis === undefined || ['x', 'y', 'z'].includes(obstacle.tunnel.axis))));
        const validTube = (shape === 'tube' || shape === 'beam')
            && validVector(obstacle?.start) && validVector(obstacle?.end)
            && Number.isFinite(obstacle?.radius);
        assert.ok(obstacle && typeof obstacle === 'object' && !Array.isArray(obstacle)
            && shared && (validBox || validTube),
        `${mapKey}/${model.id} worker obstacle ${index} must match an authored box/tunnel/tube/beam compiler definition`);
        if (validTube) assert.ok(obstacle.radius > 0,
            `${mapKey}/${model.id} worker tube/beam obstacle ${index} radius must be positive`);
        if (validBox && obstacle.tunnel) assert.ok(Number.isFinite(obstacle.tunnel.radius) && obstacle.tunnel.radius > 0,
            `${mapKey}/${model.id} worker tunnel obstacle ${index} radius must be positive`);
    }

    assert.ok(Array.isArray(approaches) && approaches.length > 0,
        `${mapKey}/${model.id} worker payload includes portal approaches`);
    assert.ok(approaches.some((approach) => Array.isArray(approach?.exitPoints) && approach.exitPoints.length >= 6),
        `${mapKey}/${model.id} worker payload includes sampled portal exits`);
    for (const [index, approach] of approaches.entries()) {
        assert.ok(approach && typeof approach === 'object' && !Array.isArray(approach)
            && Number.isInteger(approach.portalIndex) && approach.portalIndex >= 0
            && (approach.end === 'a' || approach.end === 'b'),
        `${mapKey}/${model.id} worker approach ${index} needs a non-negative portal index and end a/b`);
        assert.ok(isFiniteVector3(approach.world) && isFiniteVector3(approach.finish)
            && Array.isArray(approach.exitPoints) && approach.exitPoints.length <= 32
            && (approach.exitPoints.length === 0 || approach.exitPoints.length >= 6),
        `${mapKey}/${model.id} worker approach ${index} needs finite world and finish vectors and bounded 3D exits`);
        for (const point of approach.exitPoints) {
            assert.ok(isFiniteVector3(point), `${mapKey}/${model.id} worker approach ${index} has a malformed portal exit point`);
        }
    }
    if (coverage !== undefined) {
        const probedEndpointCount = new Set(approaches
            .filter((approach) => approach.exitPoints.length > 0)
            .map((approach) => `${approach.portalIndex}.${approach.end}`)).size;
        assert.equal(coverage.selectedEndpointCount, probedEndpointCount,
            `${mapKey}/${model.id} worker coverage endpoint count must match distinct approaches with exit probes`);
    }
    return true;
}

// Called only after checkCollisionBroad reports a hit. Recheck the broad-phase candidates one at a
// time through that same runtime API, isolating the first cause without cloning model geometry.
export function diagnosePortalBroadHit(collision, position, radius) {
    const point = [position.x, position.y, position.z];
    if (collision._checkBoundsCollision(position, radius, collision.arena.openFaces)) {
        return { sourceName: 'arena-bounds', modelId: null, colliderType: 'bounds', point, radius, box: null };
    }

    const originalObstacles = collision.arena.obstacles;
    const candidates = collision._getFastCollisionObstacles(position, radius);
    const isolatedObstacles = [null];
    try {
        for (const candidate of candidates) {
            isolatedObstacles[0] = candidate;
            collision.arena.obstacles = isolatedObstacles;
            if (!collision.checkCollisionBroad(position, radius)) continue;
            const box = candidate.box;
            return {
                sourceName: candidate.sourceName || candidate.name || candidate.sourceId || 'unnamed-collider',
                modelId: candidate.modelId || candidate.meshCollider?.modelId || null,
                colliderType: candidate.meshCollider ? 'mesh' : candidate.tube ? 'tube' : candidate.tunnel ? 'tunnel' : 'box',
                point,
                radius,
                box: box ? { min: box.min.toArray(), max: box.max.toArray() } : null,
            };
        }
    } finally {
        collision.arena.obstacles = originalObstacles;
        isolatedObstacles[0] = null;
    }
    return { sourceName: 'unresolved-broad-hit', modelId: null, colliderType: 'unknown', point, radius, box: null };
}

export function collectAnimationPoseTimes(animationTracks) {
    const samples = new Set([0]);
    for (const track of animationTracks) {
        const duration = Number(track?.durationSeconds);
        if (!Number.isFinite(duration) || duration <= 0) continue;
        const clock = track.clock || {};
        const playbackRate = Number(clock.playbackRate) || 1;
        const clip = track.action?.getClip?.();
        const clipTimes = new Set([0, duration]);
        for (const clipTrack of clip?.tracks || []) {
            for (const keyframeTime of clipTrack.times || []) {
                const time = Number(keyframeTime);
                if (Number.isFinite(time) && time >= 0 && time <= duration) clipTimes.add(time);
            }
        }
        const orderedClipTimes = [...clipTimes].sort((left, right) => left - right);
        if (clock.mode === 'once') {
            const startSeconds = Number(track.startSeconds) || 0;
            for (let index = 0; index < orderedClipTimes.length; index += 1) {
                samples.add(startSeconds + orderedClipTimes[index] / playbackRate);
                if (index + 1 < orderedClipTimes.length) {
                    const midpoint = (orderedClipTimes[index] + orderedClipTimes[index + 1]) / 2;
                    samples.add(startSeconds + midpoint / playbackRate);
                }
            }
            continue;
        }

        // Runtime loop phase is elapsedSeconds * playbackRate + phaseOffsetBeats * beatSeconds.
        // Convert each clip-space keyframe to its actual match-time phase, then cover both the
        // intervals between adjacent phases and the interval that wraps across the clip end.
        const period = duration / playbackRate;
        const offsetSeconds = (Number(clock.phaseOffsetBeats) || 0) * (Number(clock.beatSeconds) || 4);
        const loopPhases = [...new Set(orderedClipTimes.map((clipTime) => {
            const rawTime = (clipTime - offsetSeconds) / playbackRate;
            return ((rawTime % period) + period) % period;
        }))].sort((left, right) => left - right);
        for (let index = 0; index < loopPhases.length; index += 1) {
            const phase = loopPhases[index];
            samples.add(phase);
            const nextPhase = index + 1 < loopPhases.length ? loopPhases[index + 1] : loopPhases[0] + period;
            samples.add(((phase + nextPhase) / 2) % period);
        }
    }
    return [...samples].filter(Number.isFinite).sort((left, right) => left - right);
}

export function visitPortalApproachesAtPoses(poseTimes, approaches, applyPose, visitApproach) {
    for (const elapsedSeconds of poseTimes) {
        applyPose(elapsedSeconds);
        for (const approach of approaches) {
            if ((approach.exitPoints || []).length === 0) continue;
            visitApproach(approach, elapsedSeconds);
        }
    }
}

function reportMemory(stage) {
    const memory = process.memoryUsage();
    console.info(`PORTAL_PROBE_MEMORY ${JSON.stringify({
        stage,
        rssMb: Math.round(memory.rss / 1048576),
        heapUsedMb: Math.round(memory.heapUsed / 1048576),
        externalMb: Math.round(memory.external / 1048576),
        arrayBuffersMb: Math.round(memory.arrayBuffers / 1048576),
    })}`);
}

export async function runPortalClearanceProbe(payload) {
    validatePortalClearancePayload(payload);
    const { coverage = null } = payload;
    reportMemory('worker-start');
    const memoryLimit = 2.5 * 1024 * 1024 * 1024;
    assert.ok(freemem() > memoryLimit,
        `portal worker stopped before heavy imports: only ${Math.round(freemem() / 1048576)} MiB free of ${Math.round(totalmem() / 1048576)} MiB`);
    reportMemory('before-heavy-imports');
    const memoryMonitor = setInterval(() => {
        const available = freemem();
        if (available < memoryLimit) {
            console.error(`PORTAL_PROBE_MEMORY_ABORT ${JSON.stringify({ freeMiB: Math.round(available / 1048576), limitMiB: Math.round(memoryLimit / 1048576) })}`);
            process.exit(75);
        }
    }, 250);
    memoryMonitor.unref();
    const [
        { ArenaCollision },
        { ArenaGeometryCompilePipeline },
        { loadGLBMapCollection },
        { GlbAnimationDriver },
        { refreshDynamicMeshCollider },
        THREE,
        { geometryOnlyGlbLoader },
        { PortalLayoutBuilder },
        { createPortalGateVisualRegistry },
        { createEntityRuntimeConfig },
    ] = await Promise.all([
        import('../../src/entities/arena/ArenaCollision.js'),
        import('../../src/entities/arena/ArenaGeometryCompilePipeline.js'),
        import('../../src/entities/GLBMapLoader.js'),
        import('../../src/entities/arena/GlbAnimationDriver.js'),
        import('../../src/entities/arena/StaticMeshCollider.js'),
        import('three'),
        import('./glb-geometry-loader.mjs'),
        import('../../src/entities/arena/portal/PortalLayoutBuilder.js'),
        import('../../src/entities/arena/PortalGateMeshFactory.js'),
        import('../../src/shared/contracts/EntityRuntimeConfig.js'),
    ]);

    const {
        mapKey,
        model,
        mapSize,
        obstacles,
        mapScale,
        wallThickness,
        colliderMode,
        animationClock,
        approaches,
        vehicleShapes,
        runtimeMap,
        portalConfig,
    } = payload;
    const arena = {
        entityRuntimeConfig: createEntityRuntimeConfig(null),
        renderer: { addToScene() {}, removeFromScene() {}, getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; } },
        portalsEnabled: true,
        portals: [],
        portalLayoutWarnings: [],
        currentMapKey: mapKey,
        bounds: { minX: -mapSize[0] * mapScale / 2, maxX: mapSize[0] * mapScale / 2,
            minY: 0, maxY: mapSize[1] * mapScale, minZ: -mapSize[2] * mapScale / 2, maxZ: mapSize[2] * mapScale / 2 },
        openFaces: [],
        playableVolumes: [],
        obstacles: [],
        staticCollisionRevision: 0,
        _pendingObstacleGeos: [],
        _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [],
        _pendingFoamEdgeGeos: [],
    };
    arena.entityRuntimeConfig.PORTAL = portalConfig;
    arena.entityRuntimeConfig.GAMEPLAY.PLANAR_MODE = false;
    arena.entityRuntimeConfig.GAMEPLAY.PORTAL_COUNT = 0;
    arena.checkCollision = (position, radius) => collision.getCollisionInfo(position, radius);
    const geometryPipeline = new ArenaGeometryCompilePipeline(arena);
    geometryPipeline.compileObstacleStage({ obstacleDefs: obstacles, scale: mapScale });
    const collision = new ArenaCollision(arena);
    const animation = new GlbAnimationDriver();
    reportMemory('runtime-collision-setup');

    const loaded = await loadGLBMapCollection([model], {
            loader: geometryOnlyGlbLoader,
            placementScale: mapScale,
            colliderMode,
            animationClock,
            requireComplete: true,
            concurrency: 1,
        });
    reportMemory('glb-parse-collider-creation');
    try {
            assert.equal(loaded.failedCount, 0, `${mapKey}/${model.id || model.url} GLB loads for collision probing`);
            assert.deepEqual(loaded.warnings, [], `${mapKey}/${model.id || model.url} GLB probe has no fallback warnings`);
            animation.setTracks(loaded.animationTracks);
            arena.obstacles.push(...loaded.colliders);
            const visualRegistry = createPortalGateVisualRegistry(arena.renderer);
            const portalBuilder = new PortalLayoutBuilder(arena);
            portalBuilder._visualRegistry = visualRegistry;
            portalBuilder._buildPortals(payload.runtimeMap, mapScale);
            assert.equal(arena.portals.length, payload.runtimeMap.portals.length,
                `${mapKey}/${model.id || model.url} runtime portal build retained every authored pair against loaded GLB colliders`);
            for (const [portalIndex, portal] of arena.portals.entries()) {
                const authored = payload.runtimeMap.portals[portalIndex];
                for (const [end, actual, expected] of [['a', portal.posA, authored.a], ['b', portal.posB, authored.b]]) {
                    const expectedWorld = expected.map((coordinate) => coordinate * mapScale);
                    const authoredWorld = new THREE.Vector3(...expectedWorld);
                    const authoredHit = collision.getCollisionInfo(authoredWorld, portalConfig.RADIUS * 0.75);
                    assert.ok(actual.distanceTo(authoredWorld) < 1e-6,
                        `${mapKey}/${model.id || model.url} runtime portal[${portalIndex}].${end} moved from authored ${JSON.stringify(expectedWorld)} to ${JSON.stringify(actual.toArray())}; authoredCollider=${authoredHit?.sourceName || authoredHit?.obstacle?.sourceId || 'none'}; delta=${JSON.stringify(actual.clone().sub(authoredWorld).toArray())}`);
                    // Compare the hit's absence, not the hit: a failing assert.equal would inspect the
                    // collision record with its mesh collider and grow the worker past 4 GB.
                    assert.ok(collision.getCollisionInfo(actual, portalConfig.RADIUS * 0.75) === null,
                        `${mapKey}/${model.id || model.url} resolved portal[${portalIndex}].${end} clears authored plus loaded GLB colliders`);
                }
            }
            portalBuilder._disposeVisualRegistry();
            const dynamicColliders = loaded.colliders.filter((obstacle) => obstacle.dynamic);

            const beatSeconds = Number(animationClock?.beatSeconds) || 4;
            const oneShotTracks = loaded.animationTracks.filter((track) => track.clock?.mode === 'once');
            const onceEndSeconds = Math.max(0, ...oneShotTracks.map((track) => (
                (Number(track.startSeconds) || 0)
                    + track.durationSeconds / (Number(track.clock?.playbackRate) || 1)
            )));
            const animationSamples = collectAnimationPoseTimes(loaded.animationTracks);
            const poseTimes = dynamicColliders.length > 0
                ? [...new Set([
                    0,
                    beatSeconds * 0.25,
                    beatSeconds * 0.5,
                    beatSeconds * 0.75,
                    beatSeconds,
                    onceEndSeconds,
                    ...animationSamples,
                ])].sort((left, right) => left - right)
                : [0];
            reportMemory('before-pose-queries');

            visitPortalApproachesAtPoses(poseTimes, approaches, (elapsedSeconds) => {
                animation.setElapsedSeconds(elapsedSeconds);
                loaded.scene.updateMatrixWorld(true);
                for (const obstacle of dynamicColliders) refreshDynamicMeshCollider(obstacle.meshCollider, obstacle.box);
                collision.invalidateDynamicObstacles();
            }, (approach, elapsedSeconds) => {
                // The old nearest-checkpoint line only limits candidate models. Runtime exits
                // are checked below at their actual 1.8-unit destination points and vehicle shape.
                const exitDirections = approach.exitPoints.map((point) => new THREE.Vector3(...point).sub(new THREE.Vector3(...approach.world)).normalize());
                for (const direction of exitDirections) {
                    const exit = new THREE.Vector3(...approach.world).addScaledVector(direction, 1.8);
                    // Player.getDirection transforms its local -Z forward vector by quaternion.
                    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
                    for (const shape of vehicleShapes) {
                        for (const sphere of shape.probes) {
                            const point = new THREE.Vector3(...sphere.center).applyQuaternion(rotation).add(exit);
                            if (shape.probeMode === 'broad') {
                                const broadHit = collision.checkCollisionBroad(point, sphere.radius);
                                const diagnostic = broadHit
                                    ? diagnosePortalBroadHit(collision, point, sphere.radius)
                                    : null;
                                assert.equal(broadHit, false,
                                    `${mapKey}/${model.id || model.url} sampled portal exit portal[${approach.portalIndex}].${approach.end}, conservative ${shape.id} envelope must clear at ${elapsedSeconds}s; broadHit=${JSON.stringify(diagnostic)}`);
                            } else {
                                const exactHit = collision.getCollisionInfo(point, sphere.radius);
                                assert.ok(exactHit === null,
                                    `${mapKey}/${model.id || model.url} sampled portal exit portal[${approach.portalIndex}].${approach.end}, vehicle ${shape.id}, sphere probe must clear at ${elapsedSeconds}s (${exactHit?.sourceName || 'bounds'} / ${exactHit?.obstacle?.modelId || 'arena'})`);
                            }
                        }
                    }
                }
            });
            return {
                mapKey,
                modelId: model.id || model.url,
                colliders: loaded.colliders.length,
                dynamicColliders: dynamicColliders.length,
                animationTracks: loaded.animationTracks.length,
                endpoints: approaches.length,
                poseSampleCount: poseTimes.length,
                sampledOnly: true,
                probeScope: 'sampled-runtime-exit-poses; parent-selected model/endpoint scope; worker rejects collision:false before load',
                ...(coverage ? { coverage } : {}),
                poseRangeSeconds: [poseTimes[0], poseTimes[poseTimes.length - 1]],
            };
    } finally {
        clearInterval(memoryMonitor);
        animation.clear();
        // This child owns the model scene and exits after the probe, releasing its GLB memory.
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const payload = JSON.parse(readFileSync(0, 'utf8'));
        const result = await runPortalClearanceProbe(payload);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        console.error(error?.stack || error);
        process.exitCode = 1;
    }
}
