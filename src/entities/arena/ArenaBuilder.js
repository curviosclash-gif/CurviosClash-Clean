import * as THREE from 'three';
import { ArenaGeometryCompilePipeline } from './ArenaGeometryCompilePipeline.js';
import { createArenaBuildSignature, createArenaMapFingerprint, getArenaMaterialBundle } from './ArenaBuildResourceCache.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

function asPositiveScale(value, fallback = 1) {
    const scale = Number(value);
    return Number.isFinite(scale) && scale > 0 ? scale : fallback;
}

export class ArenaBuilder {
    constructor(arena) {
        this.arena = arena;
        this.geometryPipeline = new ArenaGeometryCompilePipeline(arena);
    }

    build(mapKey, { previousBuildSignature = null } = {}) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const mapResolution = this._resolveMapDefinition(mapKey);
        this.arena.currentMapKey = mapResolution.currentMapKey;

        const scale = asPositiveScale(config.ARENA.MAP_SCALE, 1);
        const size = this._resolveScaledMapSize(mapResolution.map, mapResolution.fallbackMap, scale);
        this._applyArenaBounds(size);

        const buildSignature = createArenaBuildSignature({
            mapKey: mapResolution.currentMapKey,
            mapFingerprint: createArenaMapFingerprint(mapResolution.map),
            scale,
            sx: size.sx,
            sy: size.sy,
            sz: size.sz,
            portalsEnabled: this.arena.portalsEnabled,
            planarMode: !!config.GAMEPLAY.PLANAR_MODE,
            portalCount: config.GAMEPLAY.PORTAL_COUNT,
            planarLevelCount: config.GAMEPLAY.PLANAR_LEVEL_COUNT,
        });
        const canReuse = previousBuildSignature
            && previousBuildSignature === buildSignature
            && this._hasCompiledGeometry();

        let materialBundle = null;
        if (!canReuse) {
            this.geometryPipeline.beginBuildStage();
            materialBundle = this._resolveMaterialBundle(size);
            this._assignArenaMaterials(materialBundle);
            this._compileFloorStage(size.sx, size.sz, materialBundle.floorMat);
            this.geometryPipeline.compileWallStage({ sx: size.sx, sy: size.sy, sz: size.sz, scale });
        }

        return {
            map: mapResolution.map,
            scale,
            sx: size.sx,
            sy: size.sy,
            sz: size.sz,
            obstacleDefs: Array.isArray(mapResolution.map.obstacles) ? mapResolution.map.obstacles : [],
            glbModel: typeof mapResolution.map?.glbModel === 'string' ? mapResolution.map.glbModel : '',
            glbLoadDelayMs: Number(mapResolution.map?.glbLoadDelayMs) || 0,
            glbColliderMode: typeof mapResolution.map?.glbColliderMode === 'string' ? mapResolution.map.glbColliderMode : 'mesh',
            materialBundle,
            buildSignature,
            rebuildPolicy: canReuse ? 'reuse' : 'rebuild',
        };
    }

    compileParticleStage(sx, sy, sz) {
        const count = 200;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * sx;
            positions[i * 3 + 1] = Math.random() * sy;
            positions[i * 3 + 2] = (Math.random() - 0.5) * sz;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: 0x4488ff,
            size: 0.15,
            transparent: true,
            opacity: 0.4,
            sizeAttenuation: true,
        });

        this.arena.particles = new THREE.Points(geo, mat);
        this.arena.renderer.addToScene(this.arena.particles);
    }

    addParticles(sx, sy, sz) {
        this.compileParticleStage(sx, sy, sz);
    }

    _resolveMapDefinition(mapKey) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const runtimeMapKey = typeof this.arena.runtimeMapKey === 'string'
            ? this.arena.runtimeMapKey
            : null;
        const runtimeMap = this.arena.runtimeMapDefinition;
        const fallbackMap = config.MAPS.standard || Object.values(config.MAPS || {})[0] || {
            name: 'Fallback Map',
            size: [80, 30, 80],
            obstacles: [],
            portals: [],
        };
        const hasRuntimeMap = typeof mapKey === 'string'
            && runtimeMapKey === mapKey
            && runtimeMap
            && typeof runtimeMap === 'object';
        const hasRequestedMap = typeof mapKey === 'string' && !!config.MAPS[mapKey];
        const map = hasRuntimeMap ? runtimeMap : (hasRequestedMap ? config.MAPS[mapKey] : fallbackMap);
        const currentMapKey = hasRuntimeMap || hasRequestedMap ? mapKey : 'standard';
        return { map, fallbackMap, currentMapKey };
    }

    _resolveScaledMapSize(map, fallbackMap, scale) {
        const fallbackSize = Array.isArray(fallbackMap.size) ? fallbackMap.size : [80, 30, 80];
        const mapSize = Array.isArray(map.size) ? map.size : fallbackSize;
        const baseSx = Number.isFinite(mapSize[0]) && mapSize[0] > 0 ? mapSize[0] : fallbackSize[0];
        const baseSy = Number.isFinite(mapSize[1]) && mapSize[1] > 0 ? mapSize[1] : fallbackSize[1];
        const baseSz = Number.isFinite(mapSize[2]) && mapSize[2] > 0 ? mapSize[2] : fallbackSize[2];
        return {
            sx: baseSx * scale,
            sy: baseSy * scale,
            sz: baseSz * scale,
        };
    }

    _applyArenaBounds({ sx, sy, sz }) {
        const halfX = sx / 2;
        const halfZ = sz / 2;
        this.arena.bounds = {
            minX: -halfX, maxX: halfX,
            minY: 0, maxY: sy,
            minZ: -halfZ, maxZ: halfZ,
        };
    }

    _resolveMaterialBundle({ sx, sy, sz }) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const checkerWorldSize = Math.max(1, config.ARENA.CHECKER_WORLD_SIZE || 18);
        return getArenaMaterialBundle({
            checkerLightColor: config.ARENA.CHECKER_LIGHT_COLOR,
            checkerDarkColor: config.ARENA.CHECKER_DARK_COLOR,
            checkerWorldSize,
            sx,
            sy,
            sz,
        });
    }

    _assignArenaMaterials(materialBundle) {
        this.arena._wallMat = materialBundle.wallMat;
        this.arena._obstacleMat = materialBundle.obstacleMat;
        this.arena._foamMat = materialBundle.foamMat;
        this.arena._obstacleEdgeMat = materialBundle.obstacleEdgeMat;
        this.arena._foamEdgeMat = materialBundle.foamEdgeMat;
    }

    _compileFloorStage(sx, sz, floorMaterial) {
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(sx, sz),
            floorMaterial
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        floor.matrixAutoUpdate = false;
        floor.updateMatrix();
        this.arena._floorMesh = floor;
        this.arena.renderer.addToScene(floor);
    }

    _hasCompiledGeometry() {
        return !!this.arena._floorMesh?.parent && !!this.arena._mergedWallMesh?.parent;
    }
}
