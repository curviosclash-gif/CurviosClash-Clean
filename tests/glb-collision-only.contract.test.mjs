import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { loadGLBMapCollection, normalizeGLBModelCollection } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

// A forest places two files per tree: the drawn crown and a coarse collision body of the same
// trunk and branches. The collision body must never be seen and must always be solid, which is
// the one combination the descriptor could not express before `collisionOnly`.
function createCountingLoader() {
    const loadsByUrl = new Map();
    return {
        loadsByUrl,
        async loadAsync(url) {
            loadsByUrl.set(url, (loadsByUrl.get(url) || 0) + 1);
            const scene = new THREE.Group();
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(4, 20, 4),
                new THREE.MeshBasicMaterial(),
            );
            mesh.name = url.includes('collision') ? 'COLLIDER_Trunk' : 'crown';
            scene.add(mesh);
            return { scene, animations: [] };
        },
    };
}

const CROWN_URL = 'assets/models/ancient_tree/variants/variant_01/ancient_tree_01_lod2.glb';
const COLLIDER_URL = 'assets/models/ancient_tree/variants/variant_01/ancient_tree_01_collision.glb';

test('a collision-only model is normalized as hidden and solid', () => {
    const [model] = normalizeGLBModelCollection([
        { id: 'tree-body', url: COLLIDER_URL, collisionOnly: true },
    ]);
    assert.equal(model.collisionOnly, true);
    // Hiding it must not be confused with a break scene: a break scene is also intangible
    // until its event arrives, while this one collides from the first frame.
    assert.equal(model.hiddenUntilTriggered, false);
    assert.equal(model.collision, true);
});

test('collisionOnly stays off unless the map asks for it', () => {
    const [model] = normalizeGLBModelCollection([{ id: 'crown', url: CROWN_URL }]);
    assert.equal(model.collisionOnly, false);
});

test('a collision-only model is invisible, solid and casts no shadow', async () => {
    const loader = createCountingLoader();
    const result = await loadGLBMapCollection([
        { id: 'crown', url: CROWN_URL, position: [10, 0, 0], collision: false },
        { id: 'body', url: COLLIDER_URL, position: [10, 0, 0], collisionOnly: true },
    ], { loader });

    const bodySlot = result.scene.getObjectByName('glb-slot-body');
    assert.ok(bodySlot, 'the collision body keeps its own slot');
    assert.equal(bodySlot.visible, false, 'the collision body is never drawn');

    const bodyColliders = result.colliders.filter((collider) => collider.modelId === 'body');
    assert.equal(bodyColliders.length, 1, 'the hidden body still collides');
    assert.equal(bodyColliders[0].kind, 'hard');

    const crownColliders = result.colliders.filter((collider) => collider.modelId === 'crown');
    assert.equal(crownColliders.length, 0, 'the drawn crown stays flyable');

    // A hidden mesh that wins a shadow slot spends the budget on a shadow nobody can see.
    let shadowCasters = 0;
    bodySlot.traverse((child) => { if (child?.isMesh && child.castShadow) shadowCasters += 1; });
    assert.equal(shadowCasters, 0);

    disposeObject3DResources(result.scene);
});

test('repeated collision bodies decode once and still collide at their own positions', async () => {
    const loader = createCountingLoader();
    const result = await loadGLBMapCollection([
        { id: 'body-a', url: COLLIDER_URL, position: [-40, 0, 0], collisionOnly: true },
        { id: 'body-b', url: COLLIDER_URL, position: [40, 0, 0], collisionOnly: true },
    ], { loader });

    assert.equal(loader.loadsByUrl.get(COLLIDER_URL), 1, 'the shared file is decoded once');

    const centreX = (modelId) => {
        const collider = result.colliders.find((entry) => entry.modelId === modelId);
        assert.ok(collider, `model ${modelId} has a collider`);
        return (collider.box.min.x + collider.box.max.x) / 2;
    };
    assert.ok(centreX('body-a') < -20, 'the first body collides where it was placed');
    assert.ok(centreX('body-b') > 20, 'the cloned body collides where it was placed');

    disposeObject3DResources(result.scene);
});
