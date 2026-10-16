import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Trail } from '../src/entities/Trail.js';
import { GRAPHICS_STYLES } from '../src/shared/contracts/GraphicsStyleContract.js';

function createTrail(maxSegments = 4) {
    const renderer = {
        getGraphicsStyle: () => GRAPHICS_STYLES.MODERN,
        addToScene() {},
        removeFromScene() {},
    };
    const entityManager = {
        getTrailSpatialIndex: () => null,
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: maxSegments, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
    };
    return new Trail(renderer, 0x33aaff, 0, entityManager);
}

function addSegment(trail, from, to) {
    trail._addSegment(from.x, from.y, from.z, to.x, to.y, to.z);
    trail._flushDirtyMatrices();
}

function getInstanceSphere(mesh, index) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    matrix.premultiply(mesh.matrixWorld);
    return new THREE.Sphere().copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
}

function assertBoundsDoNotHideVisibleInstances(mesh, frustum) {
    const visibleInstances = [];
    for (let index = 0; index < mesh.count; index += 1) {
        const instanceSphere = getInstanceSphere(mesh, index);
        if (instanceSphere.radius > 0 && frustum.intersectsSphere(instanceSphere)) {
            visibleInstances.push(index);
        }
    }

    if (visibleInstances.length > 0) {
        assert.ok(mesh.boundingSphere, 'the changed instance matrices have a current aggregate bound');
        assert.ok(
            frustum.intersectsSphere(mesh.boundingSphere),
            `aggregate bound must not cull visible instances ${visibleInstances.join(', ')}`
        );
    }
}

function createFrustum() {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
}

test('trail frustum bounds stay current and conservative through append, ring recycle, and segment destruction', () => {
    const trail = createTrail(2);
    try {
        assert.equal(trail.mesh.frustumCulled, true);
        assert.equal(trail.glowMesh.frustumCulled, true);
        assert.equal(trail.headMesh.frustumCulled, false);
        assert.equal(trail.glowHeadMesh.frustumCulled, false);

        const frustum = createFrustum();
        addSegment(trail, { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
        assertBoundsDoNotHideVisibleInstances(trail.mesh, frustum);
        assertBoundsDoNotHideVisibleInstances(trail.glowMesh, frustum);

        addSegment(trail, { x: 80, y: 4, z: -30 }, { x: 84, y: 4, z: -30 });
        addSegment(trail, { x: -3, y: 1, z: 0 }, { x: 3, y: 1, z: 0 });
        assertBoundsDoNotHideVisibleInstances(trail.mesh, frustum);
        assertBoundsDoNotHideVisibleInstances(trail.glowMesh, frustum);

        const entry = { segmentIdx: 1 };
        trail.segmentRefs[1] = { entry, key: null };
        assert.equal(trail.destroySegmentByEntry(entry), true);
        trail._flushDirtyMatrices();
        assertBoundsDoNotHideVisibleInstances(trail.mesh, frustum);
        assertBoundsDoNotHideVisibleInstances(trail.glowMesh, frustum);
    } finally {
        trail.dispose();
    }
});
