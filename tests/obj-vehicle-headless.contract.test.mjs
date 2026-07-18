import assert from 'node:assert/strict';
import test from 'node:test';

import { OBJVehicleMesh } from '../src/entities/obj-vehicle-mesh.js';

test('OBJ vehicle meshes resolve immediately to their fallback in headless runtimes', async () => {
    assert.equal(typeof document, 'undefined');

    const first = new OBJVehicleMesh(0xffffff, 'ship5');
    const second = new OBJVehicleMesh(0xffffff, 'ship5');

    assert.equal(await first.whenReady(), false);
    assert.equal(await second.whenReady(), false);
    assert.equal(first._loaded, true);
    assert.equal(second._loaded, true);
    assert.ok(first.model);
    assert.ok(second.model);
});
