import assert from 'node:assert/strict';
import test from 'node:test';

import { createVehicleMesh, getVehicleIds } from '../src/entities/vehicle-registry.js';

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
