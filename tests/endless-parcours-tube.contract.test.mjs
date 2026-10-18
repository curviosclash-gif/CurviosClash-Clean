import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { buildEndlessTube, ENDLESS_TUBE, resolveEndlessTubeRadius } from '../src/entities/endless/EndlessParcoursTube.js';
import { createEndlessPathSample } from '../src/entities/endless/EndlessParcoursPathMetric.js';
import { sphereIntersectsStaticMeshCollider, raycastStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { updateEndlessParcoursRecords, normalizeEndlessParcoursRecords } from '../src/shared/contracts/EndlessParcoursRecordsContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from '../src/shared/contracts/EndlessParcoursWaveContract.js';
import { buildEndlessModuleInstance, syncEndlessCycleColliders, resolveEndlessActiveColliders } from '../src/entities/endless/EndlessParcoursModuleBuilder.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
function createTube(path, index, seed = 4242) {
    const module = path.getModule(index, 4);
    return buildEndlessTube({ module, metric: path.getMetric(), baseSeed: seed,
        material: new THREE.MeshStandardMaterial(), ownerId: `tube:${index}` });
}
function cleanup(tube) {
    tube.geometries.forEach(g => g.dispose()); tube.mesh.material.dispose();
}

test('tube wall collider uses the exact rendered triangles; cabin and exterior remain hollow', () => {
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    path.getModule(10, 4);
    const frame = createEndlessPathSample();
    for (let index = 0; index < 10; index++) {
        const tube = createTube(path, index);
        const geometry = tube.mesh.geometry, positions = geometry.getAttribute('position'), indices = geometry.getIndex();
        const triangles = tube.collider.meshCollider.worldTriangles;
        for (let vertex = 0; vertex < indices.count; vertex++) {
            const id = indices.getX(vertex);
            near(triangles[vertex * 3], positions.getX(id), 1e-4);
            near(triangles[vertex * 3 + 1], positions.getY(id), 1e-4);
            near(triangles[vertex * 3 + 2], positions.getZ(id) + index * 120, 1e-4);
        }
        for (const t of [0.125, 0.5, 0.875]) {
            path.getMetric().sampleAtProgress(index, t, frame);
            const p = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
            const right = new THREE.Vector3(frame.right.x, frame.right.y, frame.right.z)
                .multiplyScalar(tube.port?.side === 'right' ? -1 : 1);
            const radius = resolveEndlessTubeRadius(4242, index, t);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.collider.meshCollider, p, 2), false);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.volumeCollider, p, 0), true);
            const wall = p.clone().addScaledVector(right, radius + ENDLESS_TUBE.thickness * 0.5);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.collider.meshCollider, wall, 0.1), true);
            const far = p.clone().addScaledVector(right, radius + 5);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.collider.meshCollider, far, 0.1), false);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.volumeCollider, far, 0), false);
            const normal = new THREE.Vector3(), close = p.clone().addScaledVector(right, radius - 0.5);
            assert.equal(sphereIntersectsStaticMeshCollider(tube.collider.meshCollider, close, 1, normal), true);
            assert.ok(normal.dot(right) < -0.8, 'interior wall normal points back into the cabin');
            const hit = {};
            assert.equal(raycastStaticMeshCollider(tube.collider.meshCollider, p, right, 100, hit), true);
            near(hit.distance, radius, 1e-4);
        }
        assert.ok(indices.count / 3 <= 4000, 'bounded tube triangle count');
        cleanup(tube);
    }
});

test('adjacent tube meshes have identical open seam rings and variable deterministic diameter', () => {
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    path.getModule(12, 4);
    const radial = ENDLESS_TUBE.radialSegments, axial = ENDLESS_TUBE.axialSegments;
    let previous = createTube(path, 0);
    for (let index = 1; index <= 12; index++) {
        const next = createTube(path, index), frame = path.getMetric().sampleAtProgress(index, 0, createEndlessPathSample());
        const previousPositions = previous.mesh.geometry.getAttribute('position');
        const positions = next.mesh.geometry.getAttribute('position');
        for (let side = 0; side < radial; side++) {
            const end = axial * radial + side;
            near(previousPositions.getX(end), positions.getX(side));
            near(previousPositions.getY(end), positions.getY(side));
            near(previousPositions.getZ(end) + (index - 1) * 120, positions.getZ(side) + index * 120);
        }
        const center = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
        assert.equal(sphereIntersectsStaticMeshCollider(previous.collider.meshCollider, center, 3), false);
        assert.equal(sphereIntersectsStaticMeshCollider(next.collider.meshCollider, center, 3), false);
        near(resolveEndlessTubeRadius(4242, index, 0), ENDLESS_TUBE.minRadius);
        near(resolveEndlessTubeRadius(4242, index, 1), ENDLESS_TUBE.minRadius);
        assert.ok(resolveEndlessTubeRadius(4242, index, 0.5) >= ENDLESS_TUBE.minRadius + 2);
        cleanup(previous); previous = next;
    }
    cleanup(previous);
});

test('station progress conversion and bounded projection preserve true curve distance', () => {
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    path.getModule(1000, 4);
    const metric = path.getMetric(), sample = createEndlessPathSample(), projected = createEndlessPathSample();
    for (let index = 20; index < 30; index++) {
        for (const t of [0.01, 0.1, 0.5, 0.99]) {
            metric.sampleAtProgress(index, t, sample);
            near(sample.progress, t, 1e-10);
            metric.projectPoint(sample.position, projected, { minModuleIndex: index - 1, maxModuleIndex: index + 1 });
            near(projected.s, metric.getStationAtProgress(index, t), 1e-6);
            assert.equal(projected.moduleIndex, index);
        }
    }
    assert.equal(metric.projectPoint({ x: 0, y: 0, z: 0 }, projected, { minModuleIndex: 9, maxModuleIndex: 8 }), null);
    assert.equal(metric.sampleAtProgress(-1, 0), null);
});

test('a version distance record survives score-top eviction and preserves historical all-time data', () => {
    let records = updateEndlessParcoursRecords(null, { runId: 'old', score: 100000, distanceMeters: 50000,
        ruleVersion: 'endless-parcours-rules.v2' }).records;
    records = updateEndlessParcoursRecords(records, { runId: 'long-low-score', score: 1, distanceMeters: 2000,
        ruleVersion: ENDLESS_PARCOURS_RULE_VERSION }).records;
    for (let i = 0; i < 8; i++) {
        records = updateEndlessParcoursRecords(records, { runId: `short-${i}`, score: 100 + i, distanceMeters: 100 + i,
            ruleVersion: ENDLESS_PARCOURS_RULE_VERSION }).records;
    }
    assert.equal(records.bestDistance.distanceMeters, 50000);
    assert.equal(records.topByRuleVersion[ENDLESS_PARCOURS_RULE_VERSION].some(run => run.runId === 'long-low-score'), false);
    const loaded = normalizeEndlessParcoursRecords(JSON.parse(JSON.stringify(records)));
    assert.equal(loaded.bestDistanceByRuleVersion[ENDLESS_PARCOURS_RULE_VERSION].runId, 'long-low-score');
    assert.equal(loaded.bestDistanceByRuleVersion[ENDLESS_PARCOURS_RULE_VERSION].distanceMeters, 2000);
    assert.equal(loaded.bestDistanceByRuleVersion['endless-parcours-rules.v2'].distanceMeters, 50000);
    assert.equal(loaded.best.runId, 'old');
});

test('curved gate, marker and cycling barrier share the local frame and exact collider pose', () => {
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    const module = { ...path.getModule(8, 4), colliders: [{ x: 4, y: 10, z: 60, sx: 3, sy: 10, sz: 2,
        cycle: { periodSeconds: 4, openSeconds: 2, phase: 0 } }] };
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
    const instance = buildEndlessModuleInstance({ module, geometry,
        materials: { wall: material, hazard: material, gate: material, record: material },
        metric: path.getMetric(), baseSeed: 4242,
        recordDistanceMeters: path.getMetric().getStationAtProgress(8, 0.5) });
    const frame = path.getMetric().sampleAtProgress(8, 0.5, createEndlessPathSample());
    const center = new THREE.Vector3().copy(frame.position), up = new THREE.Vector3().copy(frame.up);
    assert.ok(instance.recordMarker.position.distanceTo(center.clone().addScaledVector(up, 2)) < 1e-6);
    const gate = path.getMetric().sampleAtProgress(8, 116 / 120);
    assert.ok(new THREE.Vector3().copy(instance.gateCenter).distanceTo(gate.position) < 1e-6);
    const entry = instance.cycleColliders[0];
    assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(entry.mesh.quaternion)
        .distanceTo(frame.tangent) < 1e-6);
    for (const [time, closed] of [[3, true], [1, false], [3, true]]) {
        syncEndlessCycleColliders(instance, time);
        assert.equal(resolveEndlessActiveColliders(instance).includes(entry.collider), closed);
        const expectedBox = new THREE.Box3().setFromObject(entry.mesh);
        assert.ok(entry.collider.box.min.distanceTo(expectedBox.min) < 1e-6);
        assert.ok(entry.collider.box.max.distanceTo(expectedBox.max) < 1e-6);
        const triangles = entry.collider.meshCollider.worldTriangles;
        const colliderMatrix = new THREE.Matrix4().fromArray(entry.collider.meshCollider.matrixElements);
        const positions = entry.mesh.geometry.getAttribute('position'), indices = entry.mesh.geometry.getIndex();
        for (let i = 0; i < indices.count; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)).applyMatrix4(entry.mesh.matrixWorld);
            assert.ok(vertex.distanceTo(new THREE.Vector3().fromArray(triangles, i * 3).applyMatrix4(colliderMatrix)) < 1e-4);
        }
    }
    instance.ownedGeometries.forEach(g => g.dispose()); geometry.dispose(); material.dispose();
});
