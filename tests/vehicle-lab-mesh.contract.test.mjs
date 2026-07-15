import assert from 'node:assert/strict';
import test from 'node:test';

import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';

test('nested Vehicle Lab parts can be mirrored and selected by exact path', () => {
    const child = { name: 'Child', geo: 'box', mirrorAxis: 'x', pos: [2, 0, 0] };
    const sibling = { name: 'Sibling', geo: 'box' };
    const mesh = new ModularVehicleMesh({ parts: [{ name: 'Root', geo: 'box', children: [child, sibling] }] });

    const childObjects = [];
    mesh.traverse((node) => {
        if (node.userData.config === child) childObjects.push(node);
    });
    assert.equal(childObjects.length, 2);
    assert.equal(childObjects.filter((node) => node.userData.isMirror).length, 1);

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
