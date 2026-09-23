import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';

test('nested Vehicle Lab parts preserve their parent transform when mirrored', () => {
    const child = { name: 'Child', geo: 'box', mirrorAxis: 'x', pos: [2, 0, 0] };
    const sibling = { name: 'Sibling', geo: 'box' };
    const mesh = new ModularVehicleMesh({ parts: [{ name: 'Root', geo: 'box', pos: [10, 0, 0], children: [child, sibling] }] });

    const childObjects = [];
    mesh.traverse((node) => {
        if (node.userData.config === child) childObjects.push(node);
    });
    assert.equal(childObjects.length, 2);
    assert.equal(childObjects.filter((node) => node.userData.isMirror).length, 1);
    const mirrored = childObjects.find((node) => node.userData.isMirror);
    mesh.updateMatrixWorld(true);
    assert.equal(mirrored.parent, mesh.children[0]);
    assert.equal(mirrored.getWorldPosition(new THREE.Vector3()).x, 8);

    mesh.setSelectedSelection(0, [0]);
    const selected = childObjects.find((node) => !node.userData.isMirror);
    const selectedMaterial = selected.material;
    let siblingObject = null;
    mesh.traverse((node) => {
        if (node.userData.config === sibling) siblingObject = node;
    });
    assert.ok(selectedMaterial.emissiveIntensity > siblingObject.material.emissiveIntensity);
    assert.equal(selectedMaterial.emissive.getHex(), 0x2563eb);
    mesh.dispose();
});

test('pulse animation preserves non-uniform scale', () => {
    const mesh = new ModularVehicleMesh({
        parts: [{ name: 'Pulse', geo: 'box', scale: [2, 3, 4], anim: { type: 'pulse', speed: 1, amount: 1 } }],
    });
    mesh.tick(0.016, Math.PI / 2);
    assert.equal(Number(mesh.children[0].scale.x.toFixed(2)), 2.2);
    assert.equal(Number(mesh.children[0].scale.y.toFixed(2)), 3.3);
    assert.equal(Number(mesh.children[0].scale.z.toFixed(2)), 4.4);
    mesh.dispose();
});

test('animated transforms expose reversible offsets instead of accumulating authored values', () => {
    const config = {
        parts: [
            { name: 'Rotate', geo: 'box', rot: [0, 10, 0], anim: { type: 'rotate', axis: 'y', speed: 2 } },
            { name: 'Bob', geo: 'box', pos: [0, 3, 0], anim: { type: 'bob', speed: 1, amount: 1 } },
            { name: 'Pulse', geo: 'box', scale: [2, 3, 4], anim: { type: 'pulse', speed: 1, amount: 1 } },
        ],
    };
    const mesh = new ModularVehicleMesh(config);

    mesh.tick(0.5, 2);
    const firstRotation = mesh.children[0].rotation.y;
    mesh.tick(0.5, 2);

    assert.equal(mesh.children[0].rotation.y, firstRotation, 'same animation time must not accumulate rotation');
    assert.equal(mesh.children[0].userData.vehicleLabAnimationState.rotationOffset[1], 4);
    assert.equal(
        Number((mesh.children[1].position.y - mesh.children[1].userData.vehicleLabAnimationState.positionYOffset).toFixed(8)),
        3,
    );
    assert.deepEqual(
        mesh.children[2].scale.toArray().map((value) => Number((value / mesh.children[2].userData.vehicleLabAnimationState.scaleFactor).toFixed(8))),
        [2, 3, 4],
    );
    mesh.dispose();
});

test('zero-valued colors and animation settings remain effective', () => {
    const mesh = new ModularVehicleMesh({
        primaryColor: 0,
        parts: [
            { name: 'Primary Black', geo: 'box' },
            { name: 'Custom Black', geo: 'box', material: 'secondary', color: 0 },
            { name: 'Stopped Rotation', geo: 'box', anim: { type: 'rotate', axis: 'y', speed: 0 } },
            { name: 'Stopped Pulse', geo: 'box', anim: { type: 'pulse', speed: 1, amount: 0 } },
        ],
    });

    mesh.tick(1, Math.PI / 2);
    assert.equal(mesh.children[0].material.color.getHex(), 0);
    assert.equal(mesh.children[1].material.color.getHex(), 0);
    assert.equal(mesh.children[2].rotation.y, 0);
    assert.deepEqual(mesh.children[3].scale.toArray(), [1, 1, 1]);
    mesh.dispose();
});

test('rebuild prunes unused cached geometries and preserves wireframe compounds', () => {
    const config = { parts: [{ name: 'Body', geo: 'box', size: [1, 1, 1] }] };
    const mesh = new ModularVehicleMesh(config);
    config.parts[0].size = [2, 2, 2];
    mesh.build();
    assert.equal(mesh.geometries.size, 1);

    mesh.updateConfig({ parts: [{ name: 'Engine', geo: 'engine' }] });
    mesh.setWireframe(true);
    mesh.build();
    const materials = [];
    mesh.traverse((node) => {
        if (node.isMesh) materials.push(node.material);
    });
    assert.ok(materials.length > 0);
    assert.ok(materials.every((material) => material.wireframe === true));
    mesh.dispose();
});
