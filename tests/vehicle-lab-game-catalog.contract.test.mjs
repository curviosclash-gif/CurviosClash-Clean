import test from 'node:test';
import assert from 'node:assert/strict';

import { AircraftMesh } from '../src/entities/aircraft-mesh.js';
import { GameVehicleReferenceMesh } from '../prototypes/vehicle-lab/src/GameVehicleReferenceMesh.js';
import { listVehicleLabGameReferences } from '../prototypes/vehicle-lab/src/VehicleLabGameVehicleCatalog.js';
import { VEHICLE_PRESETS } from '../prototypes/vehicle-lab/src/VehiclePresets.js';

test('Vehicle Lab exposes every built-in game vehicle as a reference', () => {
    const references = listVehicleLabGameReferences();

    assert.deepEqual(references.map((vehicle) => vehicle.id), [
        'ship5', 'aircraft', 'spaceship', 'arrow', 'manta', 'drone', 'orb',
        'ship1', 'ship2', 'ship3', 'ship4', 'ship6', 'ship7', 'ship8', 'ship9',
    ]);
    assert.ok(references.every((vehicle) => vehicle.readOnly === true));
    assert.ok(references.every((vehicle) => vehicle.source === 'game-reference'));
});

test('Vehicle Lab game references use the same mesh factory as gameplay', async () => {
    const reference = new GameVehicleReferenceMesh({ id: 'aircraft', label: 'Jet-Fighter' });

    assert.ok(reference.referenceMesh instanceof AircraftMesh);
    assert.equal(await reference.ready, true);
    reference.dispose();
});

test('editable Lab presets do not collide with game vehicle ids', () => {
    const gameIds = new Set(listVehicleLabGameReferences().map((vehicle) => vehicle.id));

    assert.ok(VEHICLE_PRESETS.every((preset) => !gameIds.has(preset.id)));
    assert.ok(VEHICLE_PRESETS.every((preset) => preset.label.startsWith('Lab-Vorlage:')));
});
