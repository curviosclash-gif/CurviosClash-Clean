import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../../src/entities/GLBMapLoader.js';
import { refreshDynamicMeshCollider } from '../../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './glb-geometry-loader.mjs';

const map = MAP_PRESET_CATALOG.storm_lighthouse_siege;
const loaded = await loadGLBMapCollection(map.glbModels, {
    loader: geometryOnlyGlbLoader,
    placementScale: 3,
    colliderMode: map.glbColliderMode,
    requireComplete: true,
});

try {
    const collapse = loaded.scene.getObjectByName('glb-slot-storm-lighthouse-collapse');
    const track = loaded.animationTracks.find((entry) => entry.modelId === 'storm-lighthouse-collapse');
    const island = loaded.scene.getObjectByName('glb-slot-storm-lighthouse-island');
    if (!collapse || !track || !island) throw new Error('Missing lighthouse GLB slot or collapse clip');

    loaded.scene.updateMatrixWorld(true);
    let terraceBounds = null;
    island.traverse((object) => {
        if (object.name.includes('lighthouse_island_terrace')) {
            terraceBounds = new THREE.Box3().setFromObject(object);
        }
    });
    if (!terraceBounds) throw new Error('Missing runtime island terrace');

    track.action.time = track.durationSeconds;
    track.mixer.update(0);
    loaded.scene.updateMatrixWorld(true);
    const colliders = loaded.colliders.filter((entry) =>
        entry.modelId === 'storm-lighthouse-collapse' && entry.dynamic);
    if (colliders.length !== 16) throw new Error(`Expected 16 solid wreck fragments, got ${colliders.length}`);

    const descriptor = map.glbModels.find((model) => model.id === 'storm-lighthouse-collapse');
    const sourceUnitScale = descriptor.scale * 3;
    if (!(sourceUnitScale > 0)) throw new Error('Invalid lighthouse GLB vertical scale');

    const colliderByName = new Map(colliders.map((entry) => [entry.sourceName, entry]));
    const meshes = [];
    collapse.traverse((object) => {
        if (object.isMesh && object.name.startsWith('lighthouse_tower_')) meshes.push(object);
    });
    if (meshes.length !== 24) throw new Error(`Expected 24 visual wreck fragments, got ${meshes.length}`);

    const corrections = {};
    for (const mesh of meshes) {
        const visibleBounds = new THREE.Box3().setFromObject(mesh);
        const collider = colliderByName.get(mesh.name);
        if (collider) {
            refreshDynamicMeshCollider(collider.meshCollider, collider.box);
            if (Math.abs(visibleBounds.min.y - collider.box.min.y) > 0.01) {
                throw new Error(`Runtime visible/collider bounds disagree for ${mesh.name}`);
            }
        }
        corrections[mesh.name] = (terraceBounds.max.y - visibleBounds.min.y) / sourceUnitScale;
    }
    process.stdout.write(JSON.stringify({ sourceUnitScale, terraceY: terraceBounds.max.y, corrections }));
} finally {
    disposeObject3DResources(loaded.scene);
}
