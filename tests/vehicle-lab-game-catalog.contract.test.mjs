import test from 'node:test';
import assert from 'node:assert/strict';

import { listVehicleLabGameReferences } from '../prototypes/vehicle-lab/src/VehicleLabGameVehicleCatalog.js';

test('Vehicle Lab exposes every OBJ ship from the game registry as a reference', () => {
    const references = listVehicleLabGameReferences();

    assert.deepEqual(references.map((vehicle) => vehicle.id), [
        'ship5', 'ship1', 'ship2', 'ship3', 'ship4', 'ship6', 'ship7', 'ship8', 'ship9',
    ]);
    assert.ok(references.every((vehicle) => vehicle.readOnly === true));
    assert.ok(references.every((vehicle) => vehicle.source === 'game-reference'));
});
