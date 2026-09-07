import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
    shouldDiscardAuthoredObstacleVisuals,
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

test('required collections dispose successful siblings before falling back and can retry cleanly', async () => {
    let fail = true;
    let disposed = 0;
    const loader = { async loadAsync(url) {
        await Promise.resolve();
        if (fail && url.includes('broken')) throw new Error('missing architecture');
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
        for (const resource of [geometry, material, material.map]) {
            resource.addEventListener('dispose', () => { disposed++; });
        }
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(geometry, material));
        return { scene, animations: [new THREE.AnimationClip('move', 1, [
            new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
        ])] };
    } };
    const models = [{ url: '/good.glb' }, { url: '/broken.glb' }];
    await assert.rejects(loadGLBMapCollection(models, { loader, requireComplete: true }), /Incomplete GLB collection/);
    assert.equal(disposed, 3, 'geometry, material and texture of the surviving sibling are released');
    fail = false;
    const retry = await loadGLBMapCollection(models, { loader, requireComplete: true });
    assert.equal(retry.loadedCount, 2);
    assert.deepEqual(retry.warnings, []);
    for (const mixer of retry.animationMixers) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
    }
    disposeObject3DResources(retry.scene);
    assert.equal(disposed, 9);
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

test('collision-only authored GLB obstacles stay visible when model loading fails', async () => {
    const sceneObjects = new Set();
    const arena = new Arena({
        addToScene(object) { sceneObjects.add(object); },
        removeFromScene(object) { sceneObjects.delete(object); },
        setMapLighting() {},
        setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; },
        getMaxAnisotropy() { return 1; },
    });
    arena.runtimeMapKey = 'broken-collision-only-glb';
    arena.runtimeMapDefinition = {
        name: 'Broken collision-only GLB',
        size: [40, 24, 40],
        glbModel: 'assets/maps/does-not-exist.glb',
        glbColliderMode: 'fallbackOnly',
        glbAuthoredObstaclesCollisionOnly: true,
        obstacles: [{ pos: [0, 4, 0], size: [8, 8, 8] }],
        portals: [],
        gates: [],
    };

    const result = await arena.build(arena.runtimeMapKey);

    assert.equal(result.usedGlbModel, false);
    assert.match(result.glbLoadError, /fetch|load|url|parse/i);
    assert.ok(arena._mergedObstacleMesh);
    assert.ok(arena._mergedObstacleEdges);
    assert.ok(sceneObjects.has(arena._mergedObstacleMesh));
    const authoredObstacle = arena.obstacles.find((entry) => !entry.isWall);
    const obstacleCenter = authoredObstacle.box.getCenter(new THREE.Vector3());
    assert.equal(arena.checkCollisionFast(obstacleCenter, 0.1), true);
    arena.dispose();
});

test('partial GLB collection warnings keep collision-only authored visuals as fallback', () => {
    const map = { glbAuthoredObstaclesCollisionOnly: true };
    assert.equal(shouldDiscardAuthoredObstacleVisuals({
        usedGlbModel: true,
        loadWarnings: [],
        map,
    }), true);
    assert.equal(shouldDiscardAuthoredObstacleVisuals({
        usedGlbModel: true,
        loadWarnings: ['one collection model failed'],
        map,
    }), false);
    assert.equal(shouldDiscardAuthoredObstacleVisuals({
        usedGlbModel: false,
        loadWarnings: ['all models failed'],
        map,
    }), false);
});

test('a partially missing gameplay collection uses visible fallback and retries on restart', async (t) => {
    let broken = true;
    let disposed = 0;
    t.mock.method(GLTFLoader.prototype, 'loadAsync', async (url) => {
        if (broken && url.includes('missing')) throw new Error('missing wall');
        const scene = new THREE.Group();
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.addEventListener('dispose', () => { disposed++; });
        scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        return { scene };
    });
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {}, setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    arena.runtimeMapKey = 'partial-map';
    arena.runtimeMapDefinition = {
        size: [40, 24, 40], glbColliderMode: 'mesh', glbAuthoredObstaclesCollisionOnly: true,
        glbModels: [{ url: '/wall.glb' }, { url: '/missing.glb' }],
        obstacles: [{ pos: [0, 4, 0], size: [8, 8, 8] }], portals: [], gates: [],
    };
    try {
        const first = await arena.build(arena.runtimeMapKey);
        assert.equal(first.usedGlbModel, false);
        assert.match(first.glbLoadError, /Incomplete/);
        assert.ok(arena._mergedObstacleMesh);
        assert.equal(arena._glbScene, null);
        assert.equal(disposed, 1);
        assert.equal(arena.checkCollisionFast(new THREE.Vector3(0, 4, 0), 0.1), true);
        broken = false;
        const retry = await arena.build(arena.runtimeMapKey);
        assert.equal(retry.rebuildPolicy, 'rebuild');
        assert.equal(retry.usedGlbModel, true);
        assert.equal(retry.glbLoadError, null);
        assert.equal(arena._glbScene.children.length, 2);
        assert.equal(arena._mergedObstacleMesh, null);
    } finally { arena.dispose(); }
    assert.equal(disposed, 3);
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
