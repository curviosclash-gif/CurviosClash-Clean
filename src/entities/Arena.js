import * as THREE from 'three';
import { ArenaBuilder } from './arena/ArenaBuilder.js';
import { ArenaCollision } from './arena/ArenaCollision.js';
import { PortalGateSystem } from './arena/PortalGateSystem.js';
import { loadGLBMap, resolveGLBFootprint } from './GLBMapLoader.js';
import { disposeObject3DResources } from '../shared/rendering/ThreeDisposal.js';
import { createVehicleMesh, isValidVehicleId } from './vehicle-registry.js';

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
        this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

        this.particles = null;
        this._floorMesh = null;
        this._mergedWallMesh = null;
        this._mergedObstacleMesh = null;
        this._mergedFoamMesh = null;
        this._mergedObstacleEdges = null;
        this._mergedFoamEdges = null;
        this._glbScene = null;
        this._glbLoadError = null;
        this._glbLoadWarnings = [];
        this._glbFootprint = null;
        this._lastBuildSignature = null;
        this._aircraftDecorations = [];

        this._builder = new ArenaBuilder(this);
        this._collision = new ArenaCollision(this);
        this._portalGateSystem = new PortalGateSystem(this);
    }

    _clearLoadedGlbScene() {
        if (!this._glbScene) return;
        this.renderer.removeFromScene(this._glbScene);
        disposeObject3DResources(this._glbScene);
        this._glbScene = null;
    }

    _clearAuthoredAircraftDecorations() {
        if (!Array.isArray(this._aircraftDecorations) || this._aircraftDecorations.length === 0) return;
        for (const entry of this._aircraftDecorations) {
            const root = entry?.root;
            if (!root) continue;
            this.renderer.removeFromScene(root);
            disposeObject3DResources(root);
        }
        this._aircraftDecorations = [];
    }

    _buildAuthoredAircraftDecorations(map) {
        this._clearAuthoredAircraftDecorations();
        const authoredAircraft = Array.isArray(map?.aircraft) ? map.aircraft : [];
        if (authoredAircraft.length === 0) return;

        for (let i = 0; i < authoredAircraft.length; i += 1) {
            const entry = authoredAircraft[i];
            if (!entry) continue;

            const root = new THREE.Group();
            root.name = `map-aircraft-${entry.id || i}`;
            root.position.set(
                Number(entry.x) || 0,
                Number(entry.y) || 0,
                Number(entry.z) || 0,
            );
            root.rotation.y = Number(entry.rotateY) || 0;
            root.scale.setScalar(Math.max(0.05, Number(entry.scale) || 1));

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

    getAuthoredPlayerSpawn() {
        return this.currentMapDefinition?.playerSpawn || null;
    }

    getAuthoredBotSpawns() {
        return Array.isArray(this.currentMapDefinition?.botSpawns) ? this.currentMapDefinition.botSpawns : [];
    }

    getAuthoredItemAnchors() {
        return Array.isArray(this.currentMapDefinition?.items) ? this.currentMapDefinition.items : [];
    }

    syncAuthoredAircraftDecorations() {
        this._buildAuthoredAircraftDecorations(this.currentMapDefinition);
    }

    build(mapKey, options = {}) {
        const includeAuthoredAircraft = options?.includeAuthoredAircraft !== false;
        const buildContext = this._builder.build(mapKey, {
            previousBuildSignature: this._lastBuildSignature,
        });
        this.currentMapDefinition = buildContext.map || null;

        if (buildContext.rebuildPolicy === 'reuse') {
            if (includeAuthoredAircraft) {
                this._buildAuthoredAircraftDecorations(buildContext.map);
            } else {
                this._clearAuthoredAircraftDecorations();
            }
            return buildContext;
        }

        this._glbLoadError = null;
        this._glbLoadWarnings = [];
        this._glbFootprint = buildContext.glbModel
            ? resolveGLBFootprint(buildContext.glbModel, { colliderMode: buildContext.glbColliderMode })
            : null;
        this._clearLoadedGlbScene();

        let usedGlbModel = false;
        const finalizeBuild = () => {
            const useFallbackObstacles = !usedGlbModel || buildContext.glbColliderMode === 'fallbackOnly';
            if (useFallbackObstacles) {
                this._builder.geometryPipeline.compileObstacleStage({
                    obstacleDefs: buildContext.obstacleDefs,
                    scale: buildContext.scale,
                });
            }

            this._builder.geometryPipeline.flushMergeStage(buildContext.materialBundle);
            this._portalGateSystem.build(buildContext.map, buildContext.scale);
            if (includeAuthoredAircraft) {
                this._buildAuthoredAircraftDecorations(buildContext.map);
            } else {
                this._clearAuthoredAircraftDecorations();
            }
            this._builder.compileParticleStage(buildContext.sx, buildContext.sy, buildContext.sz);
            this._lastBuildSignature = buildContext.buildSignature;
            return {
                ...buildContext,
                usedGlbModel,
                glbLoadError: this._glbLoadError,
                glbLoadWarnings: [...this._glbLoadWarnings],
            };
        };

        if (!buildContext.glbModel) {
            return finalizeBuild();
        }

        return loadGLBMap(buildContext.glbModel, {
            loadDelayMs: buildContext.glbLoadDelayMs,
            sceneName: `glbMap-${this.currentMapKey}`,
            collectColliders: buildContext.glbColliderMode !== 'fallbackOnly',
        }).then((glbResult) => {
            this._glbScene = glbResult.scene;
            this._glbFootprint = glbResult.footprint || this._glbFootprint;
            this.renderer.addToScene(this._glbScene);
            if (Array.isArray(glbResult.colliders) && glbResult.colliders.length > 0) {
                this.obstacles.push(...glbResult.colliders);
            }
            usedGlbModel = true;
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

    checkPortal(position, radius, entityId) {
        return this._portalGateSystem.checkPortal(position, radius, entityId);
    }

    checkExitPortal(position, radius, entityId) {
        return this._portalGateSystem.checkExitPortal(position, radius, entityId);
    }

    getCollisionInfo(position, radius) {
        return this._collision.getCollisionInfo(position, radius);
    }

    checkCollisionFast(position, radius = 0) {
        return this._collision.checkCollisionFast(position, radius);
    }

    checkSpecialGates(position, previousPosition, radius, entityId) {
        return this._portalGateSystem.checkSpecialGates(position, previousPosition, radius, entityId);
    }

    getTraversalSignalForEntity(entityId) {
        return this._portalGateSystem.getTraversalSignalForEntity(entityId);
    }

    checkCollision(position, radius) {
        return this.checkCollisionFast(position, radius);
    }

    getRandomPosition(margin = 5) {
        const b = this.bounds;
        for (let attempts = 0; attempts < 50; attempts++) {
            const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
            const y = 3 + Math.random() * (b.maxY - 6);
            const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
            const pos = new THREE.Vector3(x, y, z);
            if (!this.checkCollision(pos, 3)) {
                return pos;
            }
        }
        const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
        const y = 3 + Math.random() * (b.maxY - 6);
        const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
        return new THREE.Vector3(x, y, z);
    }

    getRandomPositionOnLevel(level, margin = 5) {
        const b = this.bounds;
        const y = Number.isFinite(level) ? level : (b.minY + b.maxY) * 0.5;
        for (let attempts = 0; attempts < 50; attempts++) {
            const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
            const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
            const pos = new THREE.Vector3(x, y, z);
            if (!this.checkCollision(pos, 3)) {
                return pos;
            }
        }
        const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
        const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
        return new THREE.Vector3(x, y, z);
    }

    getPortalLevelsFallback() {
        return this._portalGateSystem.getPortalLevelsFallback();
    }

    getPortalLevels() {
        return this._portalGateSystem.getPortalLevels();
    }

    update(dt) {
        this._portalGateSystem.update(dt);
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

        this._clearLoadedGlbScene();
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
        this.currentMapDefinition = null;
        this.runtimeMapDefinition = null;
        this._lastBuildSignature = null;
    }
}
