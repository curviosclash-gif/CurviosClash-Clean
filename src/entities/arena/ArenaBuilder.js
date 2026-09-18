import * as THREE from 'three';
import { ArenaGeometryCompilePipeline } from './ArenaGeometryCompilePipeline.js';
import { createArenaBuildSignature, createArenaMapFingerprint, getArenaMaterialBundle } from './ArenaBuildResourceCache.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { normalizeGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';
import { AuthoredMapLightRig } from './AuthoredMapLightRig.js';
import { MapFireFxController } from './MapFireFxController.js';
import { MapHazardVisualController } from './MapHazardVisualController.js';
import { resolveVisibleShadowBounds } from './ShadowCoverageOps.js';
import { resolveMapExclusionZone } from '../../shared/contracts/ExclusionZoneContract.js';
import { isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { resolveGLBColliderMode } from '../mapSchema/MapSchemaGlbOps.js';
import { ArenaExpansionController } from './ArenaExpansionController.js';

function asPositiveScale(value, fallback = 1) {
    const scale = Number(value);
    return Number.isFinite(scale) && scale > 0 ? scale : fallback;
}

export class ArenaBuilder {
    constructor(arena) {
        this.arena = arena;
        this.geometryPipeline = new ArenaGeometryCompilePipeline(arena);
        this.mapLightRig = new AuthoredMapLightRig(arena.renderer);
        this.fireFxController = new MapFireFxController(arena.renderer);
        this.mapHazardVisualController = new MapHazardVisualController(arena.renderer);
        this.expansionController = new ArenaExpansionController(arena);
    }

    build(mapKey, { previousBuildSignature = null } = {}) {
        const config = resolveEntityRuntimeConfig(this.arena);
        const mapResolution = this._resolveMapDefinition(mapKey);
        this.arena.currentMapKey = mapResolution.currentMapKey;

        const scale = asPositiveScale(config.ARENA.MAP_SCALE, 1);
        const size = this._resolveScaledMapSize(mapResolution.map, mapResolution.fallbackMap, scale);
        this.arena.openFaces = resolveMapExclusionZone(mapResolution.map).openFaces;
        const graphicsStyle = normalizeGraphicsStyle(this.arena.renderer?.getGraphicsStyle?.());
        // Passed on every build, including the maps that state no profile: the renderer holds the
        // last one it was given, so leaving it out would carry the previous map's lighting over.
        // Only the maps that scale their authored anchors state their fog heights in that space too.
        // A map without the flag authors in world units already, and scaling those would move its
        // fog layer somewhere it never asked for.
        this.arena.renderer?.setMapLighting?.(
            mapResolution.map?.lighting,
            mapResolution.map?.scaleAuthoredAnchors === true ? scale : 1
        );
        // Rebuilt on every build for the same reason: the rig clears what the previous map placed,
        // so a map without its own lamps does not inherit them.
        this.mapLightRig.build(mapResolution.map, scale);
        this.fireFxController.build(mapResolution.map, scale, this.mapLightRig.lights);
        this.mapHazardVisualController.build(mapResolution.map, scale);
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
            graphicsStyle,
            runVariant: isFivePortalsConfig(this.arena.runtimeConfig) ? 'five_portals' : '',
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
            this.geometryPipeline.compileWallStage({
                sx: size.sx,
                sy: size.sy,
                sz: size.sz,
                scale,
                openFaces: this.arena.openFaces,
            });
            this.arena._exclusionBoundaryVisual?.build?.(this.arena.openFaces, this.arena.bounds);
        }
        // Last, so everything above is built for the whole map: only the collision bounds
        // start at the first stage of a growing map.
        this.expansionController.build(mapResolution.map, scale);

        return {
            map: mapResolution.map,
            scale,
            sx: size.sx,
            sy: size.sy,
            sz: size.sz,
            obstacleDefs: Array.isArray(mapResolution.map.obstacles) ? mapResolution.map.obstacles : [],
            glbModel: typeof mapResolution.map?.glbModel === 'string' ? mapResolution.map.glbModel : '',
            glbModels: Array.isArray(mapResolution.map?.glbModels)
                ? mapResolution.map.glbModels.filter((entry) => entry?.graphicsStyle !== 'modern' || graphicsStyle === 'modern')
                : [],
            glbLoadDelayMs: Number(mapResolution.map?.glbLoadDelayMs) || 0,
            glbLoadConcurrency: Number(mapResolution.map?.glbLoadConcurrency) || 4,
            glbColliderMode: resolveGLBColliderMode(mapResolution.map?.glbColliderMode),
            glbAnimationClock: mapResolution.map?.glbAnimationClock ?? null,
            materialBundle,
            graphicsStyle,
            buildSignature,
            rebuildPolicy: canReuse ? 'reuse' : 'rebuild',
        };
    }

    // One match time drives everything on the map that changes during a round. The frame
    // update and a host, replay or restart override both come through here, so the fire, the
    // hazards and the arena size can never disagree about where in the round it is.
    updateMapClock(elapsedSeconds) {
        this.fireFxController.update(elapsedSeconds);
        this.mapHazardVisualController.update(elapsedSeconds);
        this.expansionController.update(elapsedSeconds);
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
        // The shadow camera has to learn the map size here, or it keeps covering a fixed box around
        // the origin and everything further out loses its shadow entirely.
        this.arena.renderer?.setShadowCoverage?.(this.arena.bounds);
    }

    // _applyArenaBounds has to fit the shadow frustum to the arena box, because that is all that
    // exists at build time - the GLBs load asynchronously afterwards. This is the second pass, once
    // the geometry is there: a map whose content is far smaller than the box it is allowed to use
    // gets its shadow texels spent on the content instead of on empty air.
    refitShadowCoverage(glbScene, arenaBounds) {
        // A growing map starts on smaller collision bounds, but its shadows have to cover the
        // stages that open later as well.
        const bounds = resolveVisibleShadowBounds({
            scene: glbScene,
            arenaBounds: this.expansionController.outerBounds || arenaBounds,
        });
        if (!bounds) return null;
        this.arena.renderer?.setShadowCoverage?.(bounds);
        return bounds;
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
            graphicsStyle: this.arena.renderer?.getGraphicsStyle?.(),
            maxAnisotropy: this.arena.renderer?.getMaxAnisotropy?.() ?? 1,
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
        const hasExpectedWalls = this.arena.openFaces?.length === 5 || !!this.arena._mergedWallMesh?.parent;
        return !!this.arena._floorMesh?.parent && hasExpectedWalls;
    }
}
