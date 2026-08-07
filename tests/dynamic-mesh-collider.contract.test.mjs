import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    createDynamicMeshCollider,
    createStaticMeshCollider,
    refreshDynamicMeshCollider,
    sphereIntersectsStaticMeshCollider,
} from '../src/entities/arena/StaticMeshCollider.js';

const point = (x, y, z) => new THREE.Vector3(x, y, z);

function riggedBox(size = 2) {
    const rig = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
    rig.add(mesh);
    rig.updateMatrixWorld(true);
    return { rig, mesh };
}

test('a dynamic collider follows the transform its animation drives', () => {
    const { rig, mesh } = riggedBox();
    const collider = createDynamicMeshCollider(mesh);
    assert.ok(collider?.dynamic, 'dynamic collider is built');

    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 0, 0), 0.1), true);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(20, 0, 0), 0.1), false);

    rig.position.set(20, 0, 0);
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3();
    assert.equal(refreshDynamicMeshCollider(collider, box), true);

    assert.equal(
        sphereIntersectsStaticMeshCollider(collider, point(0, 0, 0), 0.1),
        false,
        'the hitbox no longer sits at the pose it was authored in',
    );
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(20, 0, 0), 0.1), true);
    assert.ok(Math.abs(box.min.x - 19) < 1e-5 && Math.abs(box.max.x - 21) < 1e-5, 'broadphase box tracks too');
});

test('a dynamic collider rotates and scales with its node', () => {
    const { rig, mesh } = riggedBox();
    const collider = createDynamicMeshCollider(mesh);
    const box = new THREE.Box3();

    // A 45 degree turn pushes the hull out to sqrt(2) along x, past the axis-aligned edge.
    rig.rotation.set(0, Math.PI / 4, 0);
    rig.updateMatrixWorld(true);
    refreshDynamicMeshCollider(collider, box);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(1.3, 0, 0), 0.01), true);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(1.5, 0, 0), 0.01), false);

    rig.rotation.set(0, 0, 0);
    rig.scale.setScalar(3);
    rig.updateMatrixWorld(true);
    refreshDynamicMeshCollider(collider, box);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(2.9, 0, 0), 0.01), true);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(3.2, 0, 0), 0.01), false);
    assert.ok(Math.abs(box.max.x - 3) < 1e-5, 'scaled broadphase box');
});

test('collision normals come back in world space', () => {
    const { rig, mesh } = riggedBox();
    const collider = createDynamicMeshCollider(mesh);
    const normal = new THREE.Vector3();

    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(1.05, 0, 0), 0.2, normal), true);
    assert.ok(normal.x > 0.9, `expected +x normal, got ${normal.toArray().join(',')}`);

    // Turning the body a quarter turn must turn its surface normals with it.
    rig.rotation.set(0, Math.PI / 2, 0);
    rig.updateMatrixWorld(true);
    refreshDynamicMeshCollider(collider);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 0, 1.05), 0.2, normal), true);
    assert.ok(normal.z > 0.9, `expected +z normal, got ${normal.toArray().join(',')}`);
});

test('dense dynamic meshes take the BVH path and still track their node', () => {
    const rig = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16));
    rig.add(mesh);
    rig.updateMatrixWorld(true);

    const collider = createDynamicMeshCollider(mesh);
    assert.ok(collider.bvh, 'a dense mesh builds a BVH');
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 0, 0), 0.1), true);

    rig.position.set(0, 30, 0);
    rig.updateMatrixWorld(true);
    refreshDynamicMeshCollider(collider);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 0, 0), 0.1), false);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 30, 0), 0.1), true);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 31.9, 0), 0.05), true);
});

test('skinned meshes are refused rather than given a lying rigid hull', () => {
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(2, 2, 2));
    assert.equal(createDynamicMeshCollider(skinned), null);
    assert.equal(createStaticMeshCollider(skinned), null);
});

test('static colliders keep their baked world pose', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.position.set(5, 0, 0);
    mesh.updateMatrixWorld(true);

    const collider = createStaticMeshCollider(mesh);
    assert.ok(collider && !collider.dynamic);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(5, 0, 0), 0.1), true);
    assert.equal(sphereIntersectsStaticMeshCollider(collider, point(0, 0, 0), 0.1), false);

    mesh.position.set(50, 0, 0);
    mesh.updateMatrixWorld(true);
    assert.equal(
        sphereIntersectsStaticMeshCollider(collider, point(5, 0, 0), 0.1),
        true,
        'static colliders intentionally ignore later transform changes',
    );
});
