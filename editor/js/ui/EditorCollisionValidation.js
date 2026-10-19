import * as THREE from 'three';
import { toArenaMapDefinition } from '../../../src/entities/MapSchema.js';
import { getCustomMapConversionScale } from '../../../src/entities/CustomMapLoader.js';
import { resolveGLBColliderMode } from '../../../src/entities/mapSchema/MapSchemaGlbOps.js';
import { getRuntimeMapScale } from '../../../src/shared/contracts/RuntimeMapCatalogContract.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../../../src/shared/contracts/GameplayConfigContract.js';
import { ArenaGeometryCompilePipeline } from '../../../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { ArenaCollision } from '../../../src/entities/arena/ArenaCollision.js';
import {
    collectsGlbColliders,
    isGlbModelSolidAfterLoad,
    resolveGlbMeshColliderKind,
    selectAuthoredObstacleDefs,
} from '../../../src/entities/arena/GlbColliderRules.js';
import { createDynamicMeshCollider, refreshDynamicMeshCollider, sphereIntersectsStaticMeshCollider } from '../../../src/entities/arena/StaticMeshCollider.js';

const cache = new WeakMap();
const meshCache = new WeakMap();

// The match drops the boxes only next to a complete world: some model that is more than an
// optional prop, and none of them failed. A model the editor still shows as a placeholder may be
// such a failure, so it counts as missing. Animation clips are unknown here, so in 'dynamic'
// only parts marked _dyn count as moving.
function isGlbWorldComplete(definition, objects) {
    const required = objects.filter((object) => object.userData?.type === 'glb' && object.userData?.role !== 'optionalProp');
    if (required.length === 0) return !!definition.glbModel;
    return required.every((object) => !object.userData?.isEditorPlaceholder);
}

export function createEditorCollisionProbe(editor, objects) {
    if (!editor.mapManager) return () => false;
    const json = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
    const runtimeScale = getRuntimeMapScale();
    // An asset that finishes loading changes the answer without changing the map JSON.
    const placeholders = objects.filter((object) => object.userData?.isEditorPlaceholder).length;
    let state = cache.get(editor);
    if (!state || state.json !== json || state.runtimeScale !== runtimeScale || state.placeholders !== placeholders) {
        const document = JSON.parse(json);
        const conversion = getCustomMapConversionScale(document).scale;
        const definition = toArenaMapDefinition(document, { mapScale: conversion }).map;
        const colliderMode = resolveGLBColliderMode(document.glbColliderMode);
        const arena = {
            obstacles: [],
            bounds: { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity, minZ: -Infinity, maxZ: Infinity },
            _pendingObstacleGeos: [], _pendingFoamGeos: [],
            _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
        };
        try {
            const obstacleDefs = selectAuthoredObstacleDefs(definition.obstacles || [], {
                usedGlbModel: (definition.glbModels?.length || 0) > 0 || !!definition.glbModel,
                requiredWorldComplete: isGlbWorldComplete(definition, objects),
                colliderMode,
            });
            new ArenaGeometryCompilePipeline(arena).compileObstacleStage({ obstacleDefs, scale: runtimeScale });
            state = { json, runtimeScale, placeholders, factor: runtimeScale / conversion, collision: new ArenaCollision(arena), colliderMode };
            cache.set(editor, state);
        } finally {
            for (const key of ['_pendingObstacleGeos', '_pendingFoamGeos', '_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
                arena[key].forEach((geometry) => geometry.dispose());
                arena[key].length = 0;
            }
        }
    }
    const colliders = [];
    for (const object of objects) {
        if (!collectsGlbColliders(state.colliderMode)) break;
        if (object.userData?.type !== 'glb' || object.userData?.isEditorPlaceholder || !isGlbModelSolidAfterLoad(object.userData)) continue;
        object.updateWorldMatrix(true, true);
        object.traverse((mesh) => {
            if (!mesh.isMesh || mesh.userData?.isSelectionOutline
                || !resolveGlbMeshColliderKind(mesh, { colliderMode: state.colliderMode })) return;
            let entry = meshCache.get(mesh);
            if (!entry || entry.geometry !== mesh.geometry) {
                entry = { geometry: mesh.geometry, collider: createDynamicMeshCollider(mesh) };
                meshCache.set(mesh, entry);
            }
            if (entry.collider) { refreshDynamicMeshCollider(entry.collider); colliders.push(entry.collider); }
        });
    }
    const point = new THREE.Vector3();
    return (position, radius = GAMEPLAY_CONFIG_DEFAULTS.PLAYER.HITBOX_RADIUS) => {
        point.copy(position).multiplyScalar(state.factor);
        return state.collision.checkCollisionFast(point, radius)
            || colliders.some((collider) => sphereIntersectsStaticMeshCollider(collider, position, radius / state.factor));
    };
}
