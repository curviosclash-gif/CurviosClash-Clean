import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../../src/core/config/ConfigSections.js';
import { computeCollectionPlacement } from '../../src/entities/GLBCollectionPlacement.js';
import { normalizeGLBModelCollection } from '../../src/entities/GLBMapLoader.js';
import { geometryOnlyGlbLoader } from './glb-geometry-loader.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

/**
 * Places one glbModels entry of a map the way GLBMapLoader.placeCollectionScene does (slot,
 * fit scale, bottom-centre offset from the bind-pose bounds), so a test can read world
 * positions without a renderer.
 */
export async function placeMapGlbModel(map, modelId) {
    const descriptor = normalizeGLBModelCollection(map.glbModels, { animationClock: map.glbAnimationClock })
        .find((entry) => entry.id === modelId);
    if (!descriptor) throw new Error(`${modelId} is not placed on the map`);
    const gltf = await geometryOnlyGlbLoader.loadAsync(path.join(REPO, descriptor.url));
    const scene = gltf.scene || gltf.scenes?.[0];
    scene.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    scene.traverse((child) => {
        if (!child.isMesh) return;
        const box = new THREE.Box3().setFromObject(child);
        if (!box.isEmpty()) bounds.union(box);
    });
    const placement = computeCollectionPlacement(bounds, descriptor, MAP_SCALE);
    const slot = new THREE.Group();
    slot.position.set(...placement.slotPosition);
    slot.rotation.set(...placement.slotRotation);
    const normalizer = new THREE.Group();
    normalizer.scale.setScalar(placement.fitScale);
    const offset = new THREE.Group();
    offset.position.set(...placement.offset);
    offset.add(scene);
    normalizer.add(offset);
    slot.add(normalizer);
    slot.updateMatrixWorld(true);

    const clip = (gltf.animations || []).find((entry) => entry.name === descriptor.animationClock.clipName)
        || gltf.animations?.[0] || null;
    const mixer = clip ? new THREE.AnimationMixer(scene) : null;
    const action = clip ? mixer.clipAction(clip) : null;
    action?.play();
    /** Poses the clip at `time` seconds and refreshes the world matrices. */
    const pose = (time) => {
        if (action) {
            action.time = time;
            mixer.update(0);
        }
        slot.updateMatrixWorld(true);
    };
    pose(0);
    return { descriptor, scene, clip, pose };
}

/** World bounding box of the meshes under `root` that pass `filter`. */
export function worldMeshBounds(root, filter = () => true) {
    const bounds = new THREE.Box3();
    root.traverse((child) => {
        if (child.isMesh && filter(child)) bounds.union(new THREE.Box3().setFromObject(child));
    });
    return bounds;
}
