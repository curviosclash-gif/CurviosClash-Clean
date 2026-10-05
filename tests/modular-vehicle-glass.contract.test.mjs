import assert from 'node:assert/strict';
import test from 'node:test';

import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';
import { createVehicleMesh, getVehicleIds } from '../src/entities/vehicle-registry.js';

// three.js (WebGLRenderer.renderTransmissionPass) keeps one offscreen render target per camera
// id for every scene that holds a material with transmission > 0, and frees it only in
// renderer.dispose(). The match builds new player cameras each round, so a single transmissive
// vehicle part left one texture behind per match on top of a second render of the opaque scene.
function collectTransmissiveParts(root) {
    const parts = [];
    root.traverse((child) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (material && Number(material.transmission) > 0) parts.push(child.name || child.type);
        }
    });
    return parts;
}

test('a lab glass part is drawn as alpha glass and asks for no transmission pass', () => {
    const mesh = new ModularVehicleMesh({ parts: [{ name: 'Canopy', geo: 'sphere', size: [0.5], material: 'glass' }] });
    const [canopy] = mesh.children;

    assert.deepEqual(collectTransmissiveParts(mesh), [], 'the glass canopy needs no transmission render target');
    assert.equal(canopy.material.transparent, true, 'the glass canopy stays see-through');
    assert.ok(canopy.material.opacity < 1, 'the glass canopy keeps a glass opacity');
    mesh.dispose();
});

test('no registered vehicle carries a transmissive material into a match', () => {
    const offenders = [];
    for (const vehicleId of getVehicleIds()) {
        const mesh = createVehicleMesh(vehicleId, 0x44aaff);
        const parts = collectTransmissiveParts(mesh);
        if (parts.length > 0) offenders.push(`${vehicleId}: ${parts.join(', ')}`);
        mesh.dispose();
    }
    assert.deepEqual(offenders, [], 'every vehicle draws its glass without a transmission pass');
});
