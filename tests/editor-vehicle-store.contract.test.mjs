import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createVehicleLabSlug } from '../src/shared/contracts/VehicleLabConfigContract.js';

const require = createRequire(import.meta.url);
const {
    createEditorVehicleStore,
    isValidVehicleId,
    toVehicleId,
} = require('../electron/editor-vehicle-store.cjs');

async function withStore(run) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'curvios-vehicles-'));
    try {
        await run(createEditorVehicleStore({ getVehiclesDirectory: () => directory }), directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

function jsonFor(label) {
    return JSON.stringify({ label, primaryColor: 0x60a5fa, parts: [{ name: 'Core', geo: 'box' }] });
}

test('the desktop store names files by the same rule as the renderer catalog', () => {
    // Zwei Sprachen, eine Regel: der Contract im Renderer und der CommonJS-Store
    // im Hauptprozess muessen dieselbe Kennung erzeugen, sonst findet das Spiel
    // gespeicherte Fahrzeuge nicht wieder.
    for (const label of ['Prüfschiff Ümläut', 'Müll', 'Mein Schiff!', 'Café Ångström', '']) {
        assert.equal(toVehicleId(label), `editor_vehicle_${createVehicleLabSlug(label)}`, label);
    }
});

test('saving writes one readable file per vehicle', async () => {
    await withStore(async (store, directory) => {
        const saved = store.saveVehicle({ jsonText: jsonFor('Prüfschiff Ümläut'), vehicleName: 'Prüfschiff Ümläut' });

        assert.equal(saved.ok, true);
        assert.equal(saved.vehicleId, 'editor_vehicle_prufschiff-umlaut');
        assert.deepEqual(await readdir(directory), ['editor_vehicle_prufschiff-umlaut.vehicle.json']);

        const loaded = store.getVehicle({ vehicleId: saved.vehicleId });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.config.label, 'Prüfschiff Ümläut');

        assert.deepEqual(store.listVehicles(), {
            ok: true,
            vehicles: [{ id: saved.vehicleId, label: 'Prüfschiff Ümläut' }],
        });
    });
});

test('saving rejects payloads that are not usable vehicle configs', async () => {
    await withStore(async (store) => {
        assert.equal(store.saveVehicle({ jsonText: '' }).error, 'empty_payload');
        assert.equal(store.saveVehicle({ jsonText: '{ kaputt' }).error, 'invalid_json');
        assert.equal(store.saveVehicle({ jsonText: `{"a":"${'x'.repeat(3 * 1024 * 1024)}"}` }).error, 'payload_too_large');
    });
});

test('a vehicle id can never point outside the vehicle directory', async () => {
    const hostile = ['../escape', '..', 'a/b', 'C:\Windows\evil', '', 'Groß'];
    for (const id of hostile) {
        assert.equal(isValidVehicleId(id), false, id);
    }
    await withStore(async (store, directory) => {
        for (const id of hostile) {
            assert.equal(store.getVehicle({ vehicleId: id }).ok, false, id);
            assert.equal(store.deleteVehicle({ vehicleId: id }).ok, false, id);
        }
        assert.deepEqual(await readdir(directory), []);
    });
});

test('renaming moves the file and refuses to clobber another vehicle', async () => {
    await withStore(async (store, directory) => {
        const first = store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        store.saveVehicle({ jsonText: jsonFor('Beta'), vehicleName: 'Beta' });

        assert.equal(store.renameVehicle({ vehicleId: first.vehicleId, vehicleName: 'Beta' }).error, 'name_taken');

        const renamed = store.renameVehicle({ vehicleId: first.vehicleId, vehicleName: 'Gamma' });
        assert.equal(renamed.ok, true);
        assert.equal(renamed.vehicleId, 'editor_vehicle_gamma');
        assert.equal(store.getVehicle({ vehicleId: renamed.vehicleId }).config.label, 'Gamma');
        assert.equal(store.getVehicle({ vehicleId: first.vehicleId }).ok, false);

        const files = (await readdir(directory)).sort();
        assert.deepEqual(files, ['editor_vehicle_beta.vehicle.json', 'editor_vehicle_gamma.vehicle.json']);
    });
});

test('deleting removes exactly one vehicle and reports unknown ids', async () => {
    await withStore(async (store, directory) => {
        const saved = store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        store.saveVehicle({ jsonText: jsonFor('Beta'), vehicleName: 'Beta' });

        assert.equal(store.deleteVehicle({ vehicleId: 'editor_vehicle_gibtsnicht' }).error, 'unknown_vehicle');
        assert.equal(store.deleteVehicle({ vehicleId: saved.vehicleId }).ok, true);
        assert.deepEqual(await readdir(directory), ['editor_vehicle_beta.vehicle.json']);
    });
});

test('unreadable files are skipped instead of breaking the listing', async () => {
    await withStore(async (store, directory) => {
        store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        await writeFile(path.join(directory, 'editor_vehicle_kaputt.vehicle.json'), '{ kaputt', 'utf8');
        await writeFile(path.join(directory, 'notizen.txt'), 'kein Fahrzeug', 'utf8');

        assert.deepEqual(store.listVehicles().vehicles, [{ id: 'editor_vehicle_alpha', label: 'Alpha' }]);
    });
});
