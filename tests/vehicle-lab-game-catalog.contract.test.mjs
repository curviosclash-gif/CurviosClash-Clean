import test from 'node:test';
import assert from 'node:assert/strict';

import { AircraftMesh } from '../src/entities/aircraft-mesh.js';
import { GameVehicleReferenceMesh } from '../prototypes/vehicle-lab/src/GameVehicleReferenceMesh.js';
import { listVehicleLabGameReferences } from '../prototypes/vehicle-lab/src/VehicleLabGameVehicleCatalog.js';
import { VEHICLE_PRESETS } from '../prototypes/vehicle-lab/src/VehiclePresets.js';
import { buildValidatedArcadeBlueprint, describeArcadeBlueprintStatus } from '../prototypes/vehicle-lab/src/ArcadeBlueprintValidation.js';

test('Vehicle Lab exposes every built-in game vehicle as a reference', () => {
    const references = listVehicleLabGameReferences();

    assert.deepEqual(references.map((vehicle) => vehicle.id), [
        'ship5', 'aircraft', 'spaceship', 'arrow', 'manta', 'drone', 'orb',
        'ship1', 'ship2', 'ship3', 'ship4', 'ship6', 'ship7', 'ship8', 'ship9',
    ]);
    assert.ok(references.every((vehicle) => vehicle.editableProduct === true));
    assert.ok(references.every((vehicle) => vehicle.source === 'game-vehicle'));
});

test('Vehicle Lab game references use the same mesh factory as gameplay', async () => {
    const reference = new GameVehicleReferenceMesh({ id: 'aircraft', label: 'Jet-Fighter' });

    assert.ok(reference.baseMesh instanceof AircraftMesh);
    assert.equal(await reference.ready, true);
    assert.equal(reference.config.baseVehicleId, 'aircraft');
    reference.dispose();
});

test('editable Lab presets do not collide with game vehicle ids', () => {
    const gameIds = new Set(listVehicleLabGameReferences().map((vehicle) => vehicle.id));

    assert.ok(VEHICLE_PRESETS.every((preset) => !gameIds.has(preset.id)));
    assert.ok(VEHICLE_PRESETS.every((preset) => preset.label.startsWith('Lab-Vorlage:')));
});

test('every shipped lab preset passes the blueprint check it is shown against', () => {
    // Fuenf der sechs Vorlagen luden frueher mit "Blueprint ungueltig", weil die
    // Pflichtrollen aus englischen Namensfragmenten geraten wurden und
    // Bauteile wie "Saucer" oder "Arm-BL" dabei durchfielen.
    for (const preset of VEHICLE_PRESETS) {
        const result = buildValidatedArcadeBlueprint(preset);
        assert.equal(
            result.validation.ok,
            true,
            `${preset.id}: ${(result.validation.errors || []).join('; ')}`,
        );
    }
});

test('lab presets state their gameplay roles instead of relying on part names', () => {
    const required = ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right'];
    for (const preset of VEHICLE_PRESETS) {
        const roles = new Set(preset.parts.map((part) => part.role).filter(Boolean));
        for (const role of required) {
            assert.ok(roles.has(role), `${preset.id} nennt keine Rolle ${role}`);
        }
    }
});

test('jet workshop part names and blueprint status use German display text', () => {
    const jet = VEHICLE_PRESETS.find((preset) => preset.id === 'lab_jet_fighter');
    assert.deepEqual(jet.parts.map((part) => part.name), [
        'Rumpf', 'Nasenkegel', 'Cockpitkanzel', 'Linker Flügel', 'Rechter Flügel',
        'Heckflosse', 'Linker Antrieb', 'Rechter Antrieb',
    ]);
    assert.match(describeArcadeBlueprintStatus(buildValidatedArcadeBlueprint(jet)), /^Bauplan gültig \|/);
});
