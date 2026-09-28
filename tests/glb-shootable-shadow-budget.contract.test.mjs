import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

// A landmark flower carries hundreds of shootable parts. They are drawn by an instanced batch,
// so a shadow slot spent on one of them is lost to the leaves and stem that shape the silhouette.
function createFlowerLoader(role) {
    return {
        async loadAsync() {
            const scene = new THREE.Group();
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
            leaf.name = 'Leaf';
            scene.add(leaf);
            for (let index = 1; index <= 30; index += 1) {
                const part = new THREE.Group();
                part.name = `Part_${index}`;
                part.userData = { role };
                part.position.set(index * 12, 0, 0);
                part.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial()));
                scene.add(part);
            }
            return { scene, animations: [] };
        },
    };
}

test('shootable parts never become static colliders, even when their meshes lack _nocol', async () => {
    // The sunflower's kernels share one mesh named without the marker. A baked collider would
    // stay in the air after the kernel it belonged to had been shot away.
    const result = await loadGLBMapCollection([
        { id: 'flower', url: 'assets/models/test/flower.glb', collision: true },
    ], { loader: createFlowerLoader('shootable_kernel'), colliderMode: 'scene' });
    assert.equal(result.colliders.length, 1, 'only the leaf collides');
    disposeObject3DResources(result.scene);
});

for (const role of ['shootable_seed', 'shootable_kernel']) {
    test(`${role} parts never take a shadow slot from the landmark`, async () => {
        const result = await loadGLBMapCollection([
            { id: 'flower', url: 'assets/models/test/flower.glb', collision: false },
        ], { loader: createFlowerLoader(role) });

        let partCasters = 0;
        let leaf = null;
        result.scene.traverse((child) => {
            if (!child?.isMesh) return;
            if (child.geometry?.parameters?.width === 2) leaf = child;
            if (child.castShadow && child.parent?.userData?.role === role) partCasters += 1;
        });
        assert.equal(partCasters, 0);
        assert.equal(leaf?.castShadow, true, 'the freed budget goes to the landmark surface');

        disposeObject3DResources(result.scene);
    });
}
