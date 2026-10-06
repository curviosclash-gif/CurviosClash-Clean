import assert from 'node:assert/strict';
import test from 'node:test';

import { createBaseVehicleMesh, createVehicleMesh, getVehicleIds } from '../src/entities/vehicle-registry.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';

// The match teardown (PlayerView.dispose) detaches the vehicle from the player group and
// hands it to the vehicle's own dispose(); the group sweep after that no longer reaches it.
// Every three.js Object3D has a dispose() since r186 that frees nothing, so a vehicle class
// without its own override kept all its geometries on the GPU: 12 more per match with the
// Jet-Fighter that the default bot rotation flies.
function collectGeometries(root) {
    const geometries = new Set();
    root.traverse((child) => {
        if (child.geometry?.isBufferGeometry && child.geometry.userData?.__sharedNoDispose !== true) {
            geometries.add(child.geometry);
        }
    });
    return geometries;
}

test('every registered vehicle frees its own geometries when the match disposes it', () => {
    const leaks = [];
    for (const vehicleId of getVehicleIds()) {
        const mesh = createVehicleMesh(vehicleId, 0x44aaff);
        const geometries = collectGeometries(mesh);
        const disposed = new Set();
        for (const geometry of geometries) {
            geometry.addEventListener('dispose', () => disposed.add(geometry));
        }

        mesh.removeFromParent();
        mesh.dispose();

        if (disposed.size !== geometries.size) {
            leaks.push(`${vehicleId} kept ${geometries.size - disposed.size} of ${geometries.size} geometries`);
        }
    }
    assert.deepEqual(leaks, [], 'no vehicle keeps geometries after dispose()');
});

// createVehicleMesh builds a fresh game model for a Vehicle Lab ship whose base mesh is part of
// the vehicle (baseMeshMode other than 'reference'); the modular mesh owns that model alone. No
// registered ship uses this today, but Vehicle Lab builds and the lab preview do.
test('a modular vehicle frees the geometries of the game model it was built on', () => {
    const leaks = [];
    for (const baseVehicleId of ['aircraft', 'spaceship', 'drone', 'orb']) {
        const mesh = new RuntimeModularVehicleMesh(0x44aaff, {
            baseVehicleId,
            parts: [{ name: 'Fin', geo: 'box', size: [0.2, 0.4, 0.6] }],
        }, { baseMesh: createBaseVehicleMesh(baseVehicleId, 0x44aaff) });
        const baseGeometries = collectGeometries(mesh.baseMesh);
        const disposed = new Set();
        for (const geometry of baseGeometries) {
            geometry.addEventListener('dispose', () => disposed.add(geometry));
        }

        mesh.removeFromParent();
        mesh.dispose();

        if (disposed.size !== baseGeometries.size) {
            leaks.push(`${baseVehicleId} base kept ${baseGeometries.size - disposed.size} of ${baseGeometries.size} geometries`);
        }
    }
    assert.deepEqual(leaks, [], 'no base model keeps geometries after its modular vehicle is disposed');
});
