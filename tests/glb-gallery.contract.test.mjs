import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import {
    GLB_GALLERY_MAPS,
    GLB_GALLERY_MODEL_COUNT,
} from '../src/core/config/maps/presets/glb_gallery.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import {
    loadGLBMap,
    loadGLBMapCollection,
    resolveGLBCollectionFootprint,
} from '../src/entities/GLBMapLoader.js';
import { Arena } from '../src/entities/Arena.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { listRuntimeMapPresetDescriptors } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

test('GLB gallery publishes every downloaded model exactly once', () => {
    const map = GLB_GALLERY_MAPS.glb_gallery;
    assert.equal(GLB_GALLERY_MODEL_COUNT, 120);
    assert.equal(map.glbModels.length, GLB_GALLERY_MODEL_COUNT);
    assert.equal(map.obstacles.length, GLB_GALLERY_MODEL_COUNT);
    assert.equal(new Set(map.glbModels.map((entry) => entry.id)).size, GLB_GALLERY_MODEL_COUNT);
    assert.equal(new Set(map.glbModels.map((entry) => entry.url)).size, GLB_GALLERY_MODEL_COUNT);
    assert.equal(new Set(map.glbModels.map((entry) => entry.position.join('|'))).size, GLB_GALLERY_MODEL_COUNT);

    for (const entry of map.glbModels) {
        assert.equal(existsSync(path.resolve(WORKSPACE_ROOT, entry.url)), true, `missing ${entry.url}`);
        assert.ok(entry.targetSize > 0);
    }
});

test('GLB gallery reaches the runtime map catalog and advertises collection loading', () => {
    const map = GLB_GALLERY_MAPS.glb_gallery;
    assert.equal(MAP_PRESET_CATALOG.glb_gallery, map);
    assert.equal(MAP_PRESETS_BASE.glb_gallery, map);
    assert.equal(map.glbColliderMode, 'mesh');
    assert.equal(map.glbLoadConcurrency, 4);

    const descriptor = listRuntimeMapPresetDescriptors(MAP_PRESETS_BASE)
        .find((entry) => entry.id === 'glb_gallery');
    assert.equal(descriptor?.hasGlbModel, true);
    assert.deepEqual(resolveGLBCollectionFootprint(map.glbModels, {
        colliderMode: map.glbColliderMode,
    }), {
        sourceKind: 'collection',
        colliderMode: 'mesh',
        fallbackMode: 'box-obstacles-on-load-error',
        modelCount: GLB_GALLERY_MODEL_COUNT,
    });
});

test('GLB collection loader limits concurrency, normalizes slots and tolerates partial failure', async () => {
    let activeLoads = 0;
    let maxActiveLoads = 0;
    const loader = {
        async loadAsync(url) {
            activeLoads += 1;
            maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
            await Promise.resolve();
            activeLoads -= 1;
            if (url.includes('broken')) {
                throw new Error('fixture failure');
            }
            const scene = new THREE.Group();
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(2, 4, 2),
                new THREE.MeshBasicMaterial(),
            );
            mesh.position.y = 2;
            scene.add(mesh);
            return {
                scene,
                animations: [new THREE.AnimationClip('rise', 1, [
                    new THREE.NumberKeyframeTrack(`${mesh.uuid}.position[y]`, [0, 1], [2, 3]),
                ])],
            };
        },
    };

    const result = await loadGLBMapCollection([
        { id: 'first', url: '/first.glb', position: [2, 1, 0], targetSize: 10 },
        { id: 'broken', url: '/broken.glb', position: [4, 1, 0], targetSize: 10 },
        { id: 'third', url: '/third.glb', position: [6, 1, 0], targetSize: 10 },
    ], {
        loader,
        concurrency: 2,
        placementScale: 3,
        collectColliders: false,
    });

    assert.ok(maxActiveLoads <= 2);
    assert.equal(result.loadedCount, 2);
    assert.equal(result.failedCount, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.scene.children.length, 2);
    assert.deepEqual(result.scene.children.map((entry) => entry.userData.glbModelId), ['first', 'third']);
    assert.equal(result.scene.children[0].position.x, 6);
    assert.equal(result.animationMixers.length, 2);

    const firstBounds = new THREE.Box3().setFromObject(result.scene.children[0]);
    const firstSize = firstBounds.getSize(new THREE.Vector3());
    assert.equal(firstBounds.min.y, 3);
    assert.equal(firstSize.y, 30);
    assert.equal(result.colliders.length, 0);
    disposeObject3DResources(result.scene);
});

test('GLB animation playback uses the first exported clip and is owned by the arena lifecycle', async () => {
    const scene = new THREE.Group();
    const animatedNode = new THREE.Object3D();
    animatedNode.name = 'animated-node';
    scene.add(animatedNode);
    const loader = {
        async loadAsync() {
            return {
                scene,
                animations: [
                    new THREE.AnimationClip('move-x', 1, [
                        new THREE.NumberKeyframeTrack('animated-node.position[x]', [0, 1], [0, 4]),
                    ]),
                    new THREE.AnimationClip('move-y', 1, [
                        new THREE.NumberKeyframeTrack('animated-node.position[y]', [0, 1], [0, 8]),
                    ]),
                ],
            };
        },
    };
    const result = await loadGLBMap('/animated.glb', {
        loader,
        collectColliders: false,
    });
    const arena = new Arena({
        addToScene() {},
        removeFromScene() {},
    });
    arena._portalGateSystem.update = () => {};
    arena._glbScene = result.scene;
    arena.setGlbAnimationTracks(result.animationTracks);

    assert.equal(result.animationMixers.length, 1);
    assert.equal(result.animationTracks.length, 1);
    assert.equal(result.animationTracks[0].clipName, 'move-x');
    arena.update(0.5);
    assert.equal(animatedNode.position.x, 2);
    assert.equal(animatedNode.position.y, 0);

    arena._clearLoadedGlbScene();
    assert.equal(arena.glbAnimationElapsedSeconds, 0);
    assert.equal(arena._glbScene, null);
});

test('GLB mesh colliders follow triangle geometry instead of the enclosing box', async () => {
    const triangleLoader = {
        async loadAsync() {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute([
                0, 0, 0,
                2, 0, 0,
                0, 2, 0,
            ], 3));
            const scene = new THREE.Group();
            scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
            return { scene };
        },
    };
    const result = await loadGLBMap('/triangle.glb', {
        loader: triangleLoader,
        collectColliders: true,
    });
    const arena = {
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 },
        obstacles: result.colliders,
    };
    const collision = new ArenaCollision(arena);

    assert.equal(collision.checkCollisionFast(new THREE.Vector3(0.5, 0.5, 0.05), 0.1), true);
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(1.8, 1.8, 0.05), 0.1), false);
    const hit = collision.getCollisionInfo(new THREE.Vector3(0.5, 0.5, 0.05), 0.1);
    assert.equal(hit?.kind, 'hard');
    assert.ok(hit.normal.z > 0.9);

    disposeObject3DResources(result.scene);
});

test('closed GLB mesh colliders also reject positions fully inside the model', async () => {
    const cubeLoader = {
        async loadAsync() {
            const scene = new THREE.Group();
            scene.add(new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 2, 4, 4, 4),
                new THREE.MeshBasicMaterial(),
            ));
            return { scene };
        },
    };
    const result = await loadGLBMap('/cube.glb', {
        loader: cubeLoader,
        collectColliders: true,
    });
    const collision = new ArenaCollision({
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 },
        obstacles: result.colliders,
    });

    assert.ok(result.colliders[0]?.meshCollider?.bvh);

    assert.equal(collision.checkCollisionFast(new THREE.Vector3(0, 0, 0), 0.1), true);
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(1.5, 0, 0), 0.1), false);

    disposeObject3DResources(result.scene);
});

test('GLB scenes cap opaque shadow casters and skip transparent meshes', async () => {
    const loader = {
        async loadAsync() {
            const scene = new THREE.Group();
            for (let index = 0; index < 30; index++) {
                const material = new THREE.MeshBasicMaterial({ transparent: index === 29 });
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(1 + index / 10, 1, 1), material);
                mesh.position.x = index * 2;
                scene.add(mesh);
            }
            return { scene };
        },
    };

    const result = await loadGLBMap('/shadow-budget.glb', {
        loader,
        collectColliders: false,
    });
    let shadowCasters = 0;
    let transparentCaster = false;
    result.scene.traverse((child) => {
        if (!child?.isMesh) return;
        if (child.castShadow) shadowCasters += 1;
        if (child.material?.transparent) transparentCaster = child.castShadow;
    });

    assert.equal(shadowCasters, 24);
    assert.equal(transparentCaster, false);
    disposeObject3DResources(result.scene);
});
