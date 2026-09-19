import * as THREE from 'three';
import { ArenaBuilder } from './arena/ArenaBuilder.js';
import { ArenaCollision } from './arena/ArenaCollision.js';
import { PortalGateSystem } from './arena/PortalGateSystem.js';
import {
    loadGLBMap,
    loadGLBMapCollection,
    normalizeGLBModelCollection,
    resolveGLBCollectionFootprint,
    resolveGLBFootprint,
    shouldDiscardAuthoredObstacleVisuals,
} from './GLBMapLoader.js';
import { GlbAnimationDriver } from './arena/GlbAnimationDriver.js';
import { applyArenaMapDestructibleEvents, attachArenaGlbLoadResult, clearArenaBreakScenes, refreshArenaGlbDynamicObstacles, resetArenaMapDestructibleScenes } from './arena/ArenaGlbSceneOps.js';
import { disposeObject3DResources } from '../shared/rendering/ThreeDisposal.js';
import { createVehicleMesh, isValidVehicleId } from './vehicle-registry.js';
import { ExclusionBoundaryVisual } from './arena/ExclusionBoundaryVisual.js';
import { DandelionSeedController } from './arena/DandelionSeedController.js';

const AIRCRAFT_DECORATION_PALETTE = Object.freeze([
    0xe5e7eb,
    0x93c5fd,
    0xfca5a5,
    0xfde68a,
    0x86efac,
    0xc4b5fd,
]);

function resolveAircraftDecorationVehicleId(jetId) {
    const normalized = String(jetId || '').trim().toLowerCase();
    if (normalized.startsWith('jet_ship')) {
        const suffix = normalized.slice('jet_'.length);
        if (isValidVehicleId(suffix)) return suffix;
    }
    if (normalized.startsWith('ship') && isValidVehicleId(normalized)) {
        return normalized;
    }
    if (isValidVehicleId(normalized)) {
        return normalized;
    }
    return 'aircraft';
}

function resolveAircraftDecorationColor(index = 0) {
    return AIRCRAFT_DECORATION_PALETTE[index % AIRCRAFT_DECORATION_PALETTE.length];
}

export class Arena {
    constructor(renderer) {
        this.renderer = renderer;
        this.obstacles = [];
        this.portals = [];
        this.specialGates = [];
        this.portalsEnabled = true;
        this.currentMapKey = 'standard';
        this.currentMapDefinition = null;
        this.runtimeConfig = null;
        this.runtimeMapKey = null;
        this.runtimeMapDefinition = null;
        this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }; this.openFaces = Object.freeze([]);

        this.particles = null;
        this._floorMesh = null;
        this._mergedWallMesh = null;
        this._mergedObstacleMesh = null;
        this._mergedFoamMesh = null;
        this._mergedObstacleEdges = null;
        this._mergedFoamEdges = null;
        this._glbScene = null; this._dandelionSeeds = null; this._dandelionSeedNetworkReplica = false;
        this._glbAnimation = new GlbAnimationDriver();
        this._glbDynamicObstacles = [];
        this._mapBreakScenes = null;
        this._pendingMapBreakEvents = [];
        this._glbLoadError = null;
        this._glbLoadWarnings = [];
        this._glbFootprint = null;
        this._lastBuildSignature = null;
        this._aircraftDecorations = [];
        // The scale the last build ran at. A prewarmed arena skips the decorations and only
        // syncs them at match start, where the build context is long gone.
        this._lastAuthoredBuildScale = 1;
        this._authoredPlayerSpawn = null;
        this._authoredBotSpawns = [];
        this._authoredItemAnchors = [];
        this.staticCollisionRevision = 0;
        this._staticColliderBatches = new Map();
        this._staticStreamingSnapshot = null;

        this._builder = new ArenaBuilder(this);
        this._collision = new ArenaCollision(this);
        this._portalGateSystem = new PortalGateSystem(this); this._exclusionBoundaryVisual = new ExclusionBoundaryVisual(renderer);
    }

    /** Elapsed match time the animated setpieces are posed for. */
    get glbAnimationElapsedSeconds() {
        return this._glbAnimation.elapsedSeconds;
    }

    getTelemetryMapRevision() {
        const explicitRevision = this.currentMapDefinition?.revision
            || this.currentMapDefinition?.version
            || this.runtimeMapDefinition?.revision
            || this.runtimeMapDefinition?.version;
        return String(explicitRevision || this._lastBuildSignature || 'unknown').slice(0, 192);
    }

    setGlbAnimationTracks(tracks) {
        this._glbAnimation.setTracks(tracks);
    }

    /**
     * Overrides the time the setpieces are posed for. A round restart passes 0; a client
     * that fell behind passes the time the host reports, which snaps every moving obstacle
     * back onto the pose the other players already see.
     */
    setGlbAnimationElapsedSeconds(seconds) {
        this._glbAnimation.setElapsedSeconds(seconds); this._builder.updateMapClock(this._glbAnimation.elapsedSeconds); this._dandelionSeeds?.update(this._glbAnimation.elapsedSeconds); this._refreshDynamicObstacles();
    }

    _clearLoadedGlbScene() {
        this._glbAnimation.clear(); this._dandelionSeeds = null;
        this._glbDynamicObstacles.length = 0;
        clearArenaBreakScenes(this);
        if (!this._glbScene) return;
        this.renderer.removeFromScene(this._glbScene);
        disposeObject3DResources(this._glbScene);
        this._glbScene = null;
    }

    _clearAuthoredAircraftDecorations() {
        if (!Array.isArray(this._aircraftDecorations) || this._aircraftDecorations.length === 0) return;
        for (const entry of this._aircraftDecorations) {
            // The decoration vehicles load their model asynchronously. Without this the loader
            // still attaches geometry and materials to a root nobody disposes any more.
            entry?.mesh?.cancelPendingLoad?.();
            const root = entry?.root;
            if (!root) continue;
            this.renderer.removeFromScene(root);
            disposeObject3DResources(root);
        }
        this._aircraftDecorations = [];
    }

    _buildAuthoredAircraftDecorations(map, mapScale = 1) {
        this._clearAuthoredAircraftDecorations();
        const authoredAircraft = Array.isArray(map?.aircraft) ? map.aircraft : [];
        if (authoredAircraft.length === 0) return;
        const scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(mapScale) || 1)
            : 1;

        for (let i = 0; i < authoredAircraft.length; i += 1) {
            const entry = authoredAircraft[i];
            if (!entry) continue;

            const root = new THREE.Group();
            root.name = `map-aircraft-${entry.id || i}`;
            root.position.set(
                (Number(entry.x) || 0) * scale,
                (Number(entry.y) || 0) * scale,
                (Number(entry.z) || 0) * scale,
            );
            root.rotation.y = Number(entry.rotateY) || 0;
            root.scale.setScalar(Math.max(0.05, (Number(entry.scale) || 1) * scale));

            const vehicleId = resolveAircraftDecorationVehicleId(entry.jetId);
            const mesh = createVehicleMesh(vehicleId, resolveAircraftDecorationColor(i));
            root.add(mesh);
            root.userData = {
                ...(root.userData || {}),
                authoredAircraftId: entry.id || null,
                authoredJetId: entry.jetId || vehicleId,
            };
            this.renderer.addToScene(root);
            this._aircraftDecorations.push({
                id: entry.id || null,
                jetId: entry.jetId || vehicleId,
                vehicleId,
                root,
                mesh,
            });
        }
    }

    _cacheAuthoredMapAnchors(map, mapScale = 1) {
        const source = map && typeof map === 'object' ? map : {};
        const scale = source.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(mapScale) || 1)
            : 1;
        const scaleAnchor = (entry) => {
            if (!entry || typeof entry !== 'object') return null;
            return {
                ...entry,
                x: (Number(entry.x) || 0) * scale,
                y: (Number(entry.y) || 0) * scale,
                z: (Number(entry.z) || 0) * scale,
            };
        };

        this._authoredPlayerSpawn = scaleAnchor(source.playerSpawn);
        this._authoredBotSpawns = Array.isArray(source.botSpawns)
            ? source.botSpawns.map(scaleAnchor).filter(Boolean)
            : [];
        this._authoredItemAnchors = Array.isArray(source.items)
            ? source.items.map(scaleAnchor).filter(Boolean)
            : [];
    }

    getAuthoredPlayerSpawn() {
        return this._authoredPlayerSpawn;
    }

    getAuthoredBotSpawns() {
        return this._authoredBotSpawns;
    }

    getAuthoredItemAnchors() {
        return this._authoredItemAnchors;
    }

    syncAuthoredAircraftDecorations() {
        this._buildAuthoredAircraftDecorations(this.currentMapDefinition, this._lastAuthoredBuildScale);
    }

    build(mapKey, options = {}) {
        const includeAuthoredAircraft = options?.includeAuthoredAircraft !== false;
        const buildContext = this._builder.build(mapKey, {
            previousBuildSignature: this._lastBuildSignature,
        });
        this.currentMapDefinition = buildContext.map || null;
        const buildScale = Number(buildContext.scale);
        this._lastAuthoredBuildScale = Number.isFinite(buildScale) && buildScale > 0 ? buildScale : 1;
        this._cacheAuthoredMapAnchors(buildContext.map, this._lastAuthoredBuildScale);

        if (buildContext.rebuildPolicy === 'reuse') {
            if (includeAuthoredAircraft) {
                this._buildAuthoredAircraftDecorations(buildContext.map, buildContext.scale);
            } else {
                this._clearAuthoredAircraftDecorations();
            }
            return buildContext;
        }

        this._glbLoadError = null;
        this._glbLoadWarnings = [];
        this.portalLayoutWarnings = [];
        const glbModels = normalizeGLBModelCollection(buildContext.glbModels, {
            animationClock: buildContext.glbAnimationClock,
        });
        this._glbFootprint = glbModels.length > 0
            ? resolveGLBCollectionFootprint(glbModels, { colliderMode: buildContext.glbColliderMode })
            : (buildContext.glbModel
                ? resolveGLBFootprint(buildContext.glbModel, { colliderMode: buildContext.glbColliderMode })
                : null);
        this._clearLoadedGlbScene();

        let usedGlbModel = false;
        const finalizeBuild = () => {
            // 'dynamic' only adds colliders for the moving GLB parts, so the authored box
            // obstacles stay responsible for the static set dressing. Exact scene collision can
            // still request a small supplemental set for things no GLB surface represents.
            const useFallbackObstacles = !usedGlbModel
                || buildContext.glbColliderMode === 'fallbackOnly'
                || buildContext.glbColliderMode === 'dynamic';
            const obstacleDefs = useFallbackObstacles
                ? buildContext.obstacleDefs
                : buildContext.obstacleDefs.filter((obstacle) => obstacle?.compileWithGlb === true);
            if (obstacleDefs.length > 0) {
                this._builder.geometryPipeline.compileObstacleStage({
                    obstacleDefs,
                    scale: buildContext.scale,
                });
                const collisionOnlyObstacleVisuals = shouldDiscardAuthoredObstacleVisuals({
                    usedGlbModel,
                    loadWarnings: this._glbLoadWarnings,
                    map: buildContext.map,
                });
                if (collisionOnlyObstacleVisuals) {
                    this._builder.geometryPipeline.discardObstacleVisualStage();
                }
            }

            this._builder.refitShadowCoverage(this._glbScene, this.bounds);
            this._builder.geometryPipeline.flushMergeStage(buildContext.materialBundle);
            this._portalGateSystem.build(buildContext.map, buildContext.scale);
            if (includeAuthoredAircraft) {
                this._buildAuthoredAircraftDecorations(buildContext.map, buildContext.scale);
            } else {
                this._clearAuthoredAircraftDecorations();
            }
            this._builder.compileParticleStage(buildContext.sx, buildContext.sy, buildContext.sz);
            // A degraded build must retry its assets on the next round instead of
            // permanently reusing the fallback after a transient load failure.
            this._lastBuildSignature = this._glbLoadError ? null : buildContext.buildSignature;
            return {
                ...buildContext,
                usedGlbModel,
                glbLoadError: this._glbLoadError,
                glbLoadWarnings: [...this._glbLoadWarnings],
                portalLayoutWarnings: [...this.portalLayoutWarnings],
            };
        };

        if (!buildContext.glbModel && glbModels.length === 0) {
            return finalizeBuild();
        }

        const glbLoad = glbModels.length > 0
            ? loadGLBMapCollection(glbModels, {
                loadDelayMs: buildContext.glbLoadDelayMs,
                concurrency: buildContext.glbLoadConcurrency,
                placementScale: buildContext.scale,
                requireComplete: buildContext.glbColliderMode !== 'fallbackOnly',
                sceneName: `glbMap-${this.currentMapKey}`,
                collectColliders: buildContext.glbColliderMode !== 'fallbackOnly',
                colliderMode: buildContext.glbColliderMode,
                animationClock: buildContext.glbAnimationClock,
            })
            : loadGLBMap(buildContext.glbModel, {
                loadDelayMs: buildContext.glbLoadDelayMs,
                sceneName: `glbMap-${this.currentMapKey}`,
                collectColliders: buildContext.glbColliderMode !== 'fallbackOnly',
                colliderMode: buildContext.glbColliderMode,
                animationClock: buildContext.glbAnimationClock,
            });

        return glbLoad.then((glbResult) => {
            attachArenaGlbLoadResult(this, glbResult);
            const seeds = new DandelionSeedController(glbResult.scene); this._dandelionSeeds = seeds.count > 0 ? seeds : null; usedGlbModel = true;
            return finalizeBuild();
        }).catch((error) => {
            this._glbLoadError = error?.message || 'Unknown GLB loading error';
            this._glbLoadWarnings = [`GLB fallback active: ${this._glbLoadError}`];
            return finalizeBuild();
        });
    }

    toggleBeams(enabled) {
        // Dummy method when beams are not configured.
    }

    setWallVisibility(visible) {
        if (this._mergedWallMesh) this._mergedWallMesh.visible = visible;
        if (this._mergedObstacleMesh) this._mergedObstacleMesh.visible = visible;
        if (this._mergedFoamMesh) this._mergedFoamMesh.visible = visible;
        if (this._mergedObstacleEdges) this._mergedObstacleEdges.visible = visible;
        if (this._mergedFoamEdges) this._mergedFoamEdges.visible = visible;
    }

    enterStaticStreamingMode(bounds) {
        if (this._staticStreamingSnapshot) return;
        const visibility = new Map();
        for (const object of [
            this._floorMesh,
            this._mergedWallMesh,
            this._mergedObstacleMesh,
            this._mergedFoamMesh,
            this._mergedObstacleEdges,
            this._mergedFoamEdges,
            this._glbScene,
            ...this._aircraftDecorations.map((entry) => entry?.root),
            ...this.portals.flatMap((entry) => [entry?.meshA, entry?.meshB]),
            ...this.specialGates.map((entry) => entry?.mesh),
            ...(this.exitPortals || []).map((entry) => entry?.mesh),
            ...(this.checkpointRings || []).map((entry) => entry?.mesh),
        ]) {
            if (!object) continue;
            visibility.set(object, object.visible);
            object.visible = false;
        }
        this._staticStreamingSnapshot = {
            bounds: { ...this.bounds },
            obstacles: this.obstacles,
            portalsEnabled: this.portalsEnabled,
            portals: this.portals,
            specialGates: this.specialGates,
            exitPortals: this.exitPortals,
            checkpointRings: this.checkpointRings,
            visibility,
        };
        this.portalsEnabled = false;
        this.portals = [];
        this.specialGates = [];
        this.exitPortals = [];
        this.checkpointRings = [];
        this.bounds = { ...bounds };
        this._rebuildStaticColliderView();
    }

    exitStaticStreamingMode() {
        const snapshot = this._staticStreamingSnapshot;
        if (!snapshot) return;
        this._staticColliderBatches.clear();
        this.bounds = snapshot.bounds;
        this.obstacles = snapshot.obstacles;
        this.portalsEnabled = snapshot.portalsEnabled;
        this.portals = snapshot.portals;
        this.specialGates = snapshot.specialGates;
        this.exitPortals = snapshot.exitPortals;
        this.checkpointRings = snapshot.checkpointRings;
        for (const [object, visible] of snapshot.visibility) object.visible = visible;
        this._staticStreamingSnapshot = null;
        this.staticCollisionRevision += 1;
    }

    registerStaticColliderBatch(ownerId, colliders) {
        const id = String(ownerId || '').trim();
        if (!id) throw new Error('Static collider batches require a stable owner id.');
        this._staticColliderBatches.set(id, Array.isArray(colliders) ? colliders : []);
        this._rebuildStaticColliderView();
    }

    unregisterStaticColliderBatch(ownerId) {
        if (!this._staticColliderBatches.delete(String(ownerId || ''))) return false;
        this._rebuildStaticColliderView();
        return true;
    }

    getStaticColliderBatchCount() {
        return this._staticColliderBatches.size;
    }

    _rebuildStaticColliderView() {
        const base = this._staticStreamingSnapshot ? [] : this.obstacles;
        const combined = [...base];
        for (const colliders of this._staticColliderBatches.values()) combined.push(...colliders);
        this.obstacles = combined;
        this.staticCollisionRevision += 1;
    }

    checkPortal(position, radius, entityId, previousPosition = null) {
        return this._portalGateSystem.checkPortal(position, radius, entityId, previousPosition);
    }

    checkExitPortal(position, radius, entityId) {
        return this._portalGateSystem.checkExitPortal(position, radius, entityId);
    }

    getCollisionInfo(position, radius) { return this._collision.getCollisionInfo(position, radius); } raycast(origin, direction, maxDistance) { return this._collision.raycast(origin, direction, maxDistance); } raycastDandelionSeed(origin, direction, maxDistance, padding = 0) { return this._dandelionSeeds?.raycast(origin, direction, maxDistance, padding) || null; } releaseDandelionSeed(name) { return !this._dandelionSeedNetworkReplica && this._dandelionSeeds?.releaseByName(name, this.glbAnimationElapsedSeconds) === true; } consumeDandelionSeedCollision(position, radius, playerIndex) { return !this._dandelionSeedNetworkReplica ? this._dandelionSeeds?.consumeCollision(position, radius, playerIndex) || null : null; } resetDandelionSeeds() { this._dandelionSeeds?.reset(); } serializeDandelionSeeds() { return this._dandelionSeeds?.serialize() || null; } applyDandelionSeedState(state) { this._dandelionSeeds?.applyNetworkState(state); } setDandelionSeedNetworkReplica(enabled) { this._dandelionSeedNetworkReplica = enabled === true; }
    checkCollisionFast(position, radius = 0) { return this._collision.checkCollisionFast(position, radius); }
    getBotCollisionInfo(position, radius) { return this._collision.getBotCollisionInfo(position, radius); } checkBotCollisionFast(position, radius = 0) { return this._collision.checkBotCollisionFast(position, radius); } checkWorldGeometryCollision(position, radius = 0) { return this._collision.checkWorldGeometryCollision(position, radius); }

    /**
     * Plays the baked falls for the break events of the running match. Safe before the GLB
     * models finished loading: the events are kept and replayed once the scene is there, which
     * is what a replica joining a match in progress depends on.
     */
    applyMapDestructibleEvents(events) {
        applyArenaMapDestructibleEvents(this, events);
    }

    /** Puts a shot-apart map back together, for a round that reuses this arena as it is. */
    resetMapDestructibleScenes() {
        resetArenaMapDestructibleScenes(this);
    }

    checkSpecialGates(position, previousPosition, radius, entityId) {
        return this._portalGateSystem.checkSpecialGates(position, previousPosition, radius, entityId);
    }

    getTraversalSignalForEntity(entityId) {
        return this._portalGateSystem.getTraversalSignalForEntity(entityId);
    }
    getMapExpansionHudState() { return this._builder.expansionController.getHudState(); }

    checkCollision(position, radius) {
        return this.checkCollisionFast(position, radius);
    }

    getRandomPosition(margin = 5, random = Math.random) {
        const b = this.bounds;
        for (let attempts = 0; attempts < 50; attempts++) {
            const x = b.minX + margin + random() * (b.maxX - b.minX - 2 * margin);
            const y = 3 + random() * (b.maxY - 6);
            const z = b.minZ + margin + random() * (b.maxZ - b.minZ - 2 * margin);
            const pos = new THREE.Vector3(x, y, z);
            if (!this.checkCollision(pos, 3)) {
                return pos;
            }
        }
        const x = b.minX + margin + random() * (b.maxX - b.minX - 2 * margin);
        const y = 3 + random() * (b.maxY - 6);
        const z = b.minZ + margin + random() * (b.maxZ - b.minZ - 2 * margin);
        return new THREE.Vector3(x, y, z);
    }

    getRandomPositionOnLevel(level, margin = 5, random = Math.random) {
        const b = this.bounds;
        const y = Number.isFinite(level) ? level : (b.minY + b.maxY) * 0.5;
        for (let attempts = 0; attempts < 50; attempts++) {
            const x = b.minX + margin + random() * (b.maxX - b.minX - 2 * margin);
            const z = b.minZ + margin + random() * (b.maxZ - b.minZ - 2 * margin);
            const pos = new THREE.Vector3(x, y, z);
            if (!this.checkCollision(pos, 3)) {
                return pos;
            }
        }
        const x = b.minX + margin + random() * (b.maxX - b.minX - 2 * margin);
        const z = b.minZ + margin + random() * (b.maxZ - b.minZ - 2 * margin);
        return new THREE.Vector3(x, y, z);
    }

    getPortalLevelsFallback() {
        return this._portalGateSystem.getPortalLevelsFallback();
    }

    getPortalLevels() {
        return this._portalGateSystem.getPortalLevels();
    }

    /**
     * Moves the colliders of animated GLB meshes onto their current animation pose.
     * Runs after the mixers advanced, so collision queries in this frame see the same
     * transforms the renderer will draw.
     */
    _refreshDynamicObstacles() {
        refreshArenaGlbDynamicObstacles(this);
    }

    update(dt) {
        this._portalGateSystem.update(dt);
        this._glbAnimation.advance(dt); this._builder.updateMapClock(this._glbAnimation.elapsedSeconds); this._exclusionBoundaryVisual.update(dt); this._dandelionSeeds?.update(this._glbAnimation.elapsedSeconds);
        this._refreshDynamicObstacles();
        for (const entry of this._aircraftDecorations) {
            entry?.mesh?.tick?.(dt);
        }
    }

    dispose() {
        const removeObject = (object3d) => {
            if (!object3d) return;
            this.renderer?.removeFromScene?.(object3d);
            disposeObject3DResources(object3d);
        };

        removeObject(this._floorMesh);
        removeObject(this._mergedWallMesh);
        removeObject(this._mergedObstacleMesh);
        removeObject(this._mergedFoamMesh);
        removeObject(this._mergedObstacleEdges);
        removeObject(this._mergedFoamEdges);
        removeObject(this.particles);

        this._floorMesh = null;
        this._mergedWallMesh = null;
        this._mergedObstacleMesh = null;
        this._mergedFoamMesh = null;
        this._mergedObstacleEdges = null;
        this._mergedFoamEdges = null;
        this.particles = null;

        this._clearLoadedGlbScene(); this._builder.fireFxController.dispose(); this._builder.mapHazardVisualController.dispose(); this._builder.expansionController.clear(); this._exclusionBoundaryVisual.dispose();
        this._clearAuthoredAircraftDecorations();

        for (const portal of this.portals || []) {
            if (portal?.meshA) portal.meshA.visible = false;
            if (portal?.meshB) portal.meshB.visible = false;
        }
        for (const gate of this.specialGates || []) {
            if (gate?.mesh) gate.mesh.visible = false;
        }
        for (const exitPortal of this.exitPortals || []) {
            if (exitPortal?.mesh) exitPortal.mesh.visible = false;
        }
        for (const cpRing of this.checkpointRings || []) {
            if (cpRing?.mesh) {
                cpRing.mesh.visible = false;
                removeObject(cpRing.mesh);
            }
        }

        this.portals = [];
        this.specialGates = [];
        this.exitPortals = [];
        this.checkpointRings = [];
        this.obstacles = [];
        this._staticColliderBatches.clear();
        this._staticStreamingSnapshot = null;
        this.staticCollisionRevision += 1;
        this._glbDynamicObstacles = [];
        this.currentMapDefinition = null;
        this.runtimeMapDefinition = null;
        this._lastBuildSignature = null;
    }
}
