import * as THREE from 'three';
import { toArenaMapDefinition } from '../../../src/entities/MapSchema.js';
import { getCustomMapConversionScale } from '../../../src/entities/CustomMapLoader.js';
import { getRuntimeMapScale } from '../../../src/shared/contracts/RuntimeMapCatalogContract.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../../../src/shared/contracts/GameplayConfigContract.js';
import { ArenaGeometryCompilePipeline } from '../../../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { ArenaCollision } from '../../../src/entities/arena/ArenaCollision.js';
import { createDynamicMeshCollider, refreshDynamicMeshCollider, sphereIntersectsStaticMeshCollider } from '../../../src/entities/arena/StaticMeshCollider.js';

const cache = new WeakMap();
const meshCache = new WeakMap();

export function createEditorCollisionProbe(editor, objects) {
    if (!editor.mapManager) return () => false;
    const json = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
    const runtimeScale = getRuntimeMapScale();
    let state = cache.get(editor);
    if (!state || state.json !== json || state.runtimeScale !== runtimeScale) {
        const document = JSON.parse(json);
        const conversion = getCustomMapConversionScale(document).scale;
        const definition = toArenaMapDefinition(document, { mapScale: conversion }).map;
        const arena = {
            obstacles: [],
            bounds: { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity, minZ: -Infinity, maxZ: Infinity },
            _pendingObstacleGeos: [], _pendingFoamGeos: [],
            _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
        };
        try {
            new ArenaGeometryCompilePipeline(arena).compileObstacleStage({ obstacleDefs: definition.obstacles, scale: runtimeScale });
            state = { json, runtimeScale, factor: runtimeScale / conversion, collision: new ArenaCollision(arena), colliderMode: document.glbColliderMode };
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
        if (object.userData?.type !== 'glb' || object.userData?.isEditorPlaceholder) continue;
        object.updateWorldMatrix(true, true);
        object.traverse((mesh) => {
            if (!mesh.isMesh || mesh.userData?.isSelectionOutline || mesh.name.toLowerCase().includes('_nocol')) return;
            if (state.colliderMode === 'dynamic' && !mesh.name.toLowerCase().includes('_dyn')) return;
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
