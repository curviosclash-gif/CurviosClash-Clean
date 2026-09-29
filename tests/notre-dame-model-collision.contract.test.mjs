import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { computeCollectionPlacement } from '../src/entities/GLBCollectionPlacement.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { createSolidProbe } from './helpers/notre-dame-collision-utils.mjs';

const map = NOTRE_DAME_MAPS.notre_dame;
const isSolid = createSolidProbe(map.obstacles.filter((obstacle) => obstacle.compileWithGlb));
const FABRIC = new Set([
    'notre-dame-parvis', 'notre-dame-west-facade', 'notre-dame-nave',
    'notre-dame-transept', 'notre-dame-choir-apse', 'notre-dame-buttresses',
    'notre-dame-roof-fleche',
]);

async function loadChurchMeshes() {
    const visible = [];
    const colliding = [];
    for (const descriptor of map.glbModels.filter((model) => FABRIC.has(model.id))) {
        const gltf = await geometryOnlyGlbLoader.loadAsync(path.resolve(descriptor.url));
        const scene = gltf.scene;
        scene.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const placement = computeCollectionPlacement(bounds, descriptor, 1);
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
        slot.updateWorldMatrix(true, true);
        scene.traverse((node) => {
            if (!node.isMesh) return;
            node.material.side = THREE.DoubleSide;
            node.userData.mapModelId = descriptor.id;
            if (!/_colonly/i.test(node.name)) visible.push(node);
            if (!/_nocol/i.test(node.name)) colliding.push(node);
        });
    }
    return { visible, colliding };
}

function firstHit(meshes, from, direction, distance) {
    const ray = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...direction), 0.001, distance);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit && { distance: hit.distance, mesh: hit.object.name };
}

function leaksThroughVisible(meshes, from, direction, distance) {
    const visible = firstHit(meshes.visible, from, direction, distance);
    if (!visible) return false;
    const collision = firstHit(meshes.colliding, from, direction, visible.distance + 0.8);
    const point = from.map((value, axis) => value + direction[axis] * visible.distance);
    return !collision && !isSolid(point);
}

function foamContains(point) {
    return map.obstacles.some((box) => box.kind === 'foam' && box.compileWithGlb
        && box.pos.every((center, axis) => Math.abs(point[axis] - center) < box.size[axis] / 2));
}

// A finding may only disappear. Each ray reaches the actual placed GLB triangles, while the
// supplementary boxes are limited to compileWithGlb, the only ones active with loaded models.
// J2 removes K1-K7 as the collision and island geometry are repaired; J3 moves the two route
// points. Remove a key here only when its corresponding probe is green.
const KNOWN_FINDINGS = [
    'K1-roof-ridge',
    'K2-transept-gable',
    'K3-aisle-roof-seam',
    'K4-clerestory-crown',
    'K5-apse-crack',
    'K6-tower-finials',
    'K7-island-over-water',
    'S1-apse-sling-enclosed',
    'S2-CP12-intersects-vault',
];

test('Notre-Dame model collision findings only shrink', async () => {
    const meshes = await loadChurchMeshes();
    assert.ok(meshes.visible.length > 0 && meshes.colliding.length > 0);
    const withoutRoof = {
        visible: meshes.visible.filter((mesh) => mesh.userData.mapModelId !== 'notre-dame-roof-fleche'),
        colliding: meshes.colliding.filter((mesh) => mesh.userData.mapModelId !== 'notre-dame-roof-fleche'),
    };
    const findings = [];
    const record = (id, broken) => { if (broken) findings.push(id); };

    record('K1-roof-ridge', leaksThroughVisible(meshes, [-30, 60, 0], [0, 1, 0], 24));
    record('K2-transept-gable', leaksThroughVisible(meshes, [17, 56, -20], [0, 0, -1], 22));
    record('K3-aisle-roof-seam', leaksThroughVisible(meshes, [-30, 35.5, 13], [0, 0, 1], 20));
    record('K4-clerestory-crown', leaksThroughVisible(withoutRoof, [-30, 54, 4], [0, 0, 1], 20));
    record('K5-apse-crack', !firstHit(meshes.visible, [68, 40, 15], [1, 0, 0], 16)
        && !firstHit(meshes.colliding, [68, 40, 15], [1, 0, 0], 16));
    record('K6-tower-finials', leaksThroughVisible(meshes, [-85, 105.2, -20], [0, 1, 0], 14));
    record('K7-island-over-water', foamContains([0, 4, 80])
        && !firstHit(meshes.colliding, [0, 15, 80], [0, -1, 0], 20));

    const sling = map.gates.find((gate) => gate.id === 'nd_apse_sling');
    assert.ok(sling);
    const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    record('S1-apse-sling-enclosed', directions.every((direction) =>
        firstHit(meshes.colliding, sling.pos, direction, 20)));
    const cp12 = map.parcours.checkpoints.find((checkpoint) => checkpoint.id === 'CP12');
    assert.ok(cp12);
    record('S2-CP12-intersects-vault', Boolean(firstHit(meshes.colliding, cp12.pos, [0, 1, 0], cp12.radius)));

    assert.deepEqual(findings.sort(), [...KNOWN_FINDINGS].sort());
});
