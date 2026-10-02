import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
    createVehicleLabSlug,
    upsertVehicleLabCatalogVehicle,
} from '../src/shared/contracts/VehicleLabConfigContract.js';

const require = createRequire(import.meta.url);
const {
    createEditorVehicleStore,
    isValidVehicleId,
    toVehicleId,
} = require('../electron/editor-vehicle-store.cjs');

async function withStore(run, options = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'curvios-vehicles-'));
    try {
        await run(createEditorVehicleStore({ getVehiclesDirectory: () => directory, ...options }), directory);
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

test('vehicle reads return promises and preserve the established result envelopes', async () => {
    await withStore(async (store) => {
        const listResult = store.listVehicles();
        const missingVehicleResult = store.getVehicle({ vehicleId: 'editor_vehicle_missing' });

        assert.equal(typeof listResult?.then, 'function');
        assert.equal(typeof missingVehicleResult?.then, 'function');
        assert.deepEqual(await listResult, { ok: true, vehicles: [] });
        assert.deepEqual(await missingVehicleResult, { ok: false, error: 'unknown_vehicle' });
    });
});

test('saving writes one readable file per vehicle', async () => {
    await withStore(async (store, directory) => {
        const saved = await store.saveVehicle({ jsonText: jsonFor('Prüfschiff Ümläut'), vehicleName: 'Prüfschiff Ümläut' });

        assert.equal(saved.ok, true);
        assert.equal(saved.vehicleId, 'editor_vehicle_prufschiff-umlaut');
        assert.deepEqual(await readdir(directory), ['editor_vehicle_prufschiff-umlaut.vehicle.json']);

        const loaded = await store.getVehicle({ vehicleId: saved.vehicleId });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.config.label, 'Prüfschiff Ümläut');

        assert.deepEqual(await store.listVehicles(), {
            ok: true,
            vehicles: [{ id: saved.vehicleId, label: 'Prüfschiff Ümläut' }],
        });
    });
});

test('explicit catalog ids keep slug-colliding vehicle names in separate files', async () => {
    await withStore(async (store, directory) => {
        let record = null;
        const savedVehicles = [];
        for (const label of ['Mein Schiff!', 'Mein Schiff?']) {
            const saved = upsertVehicleLabCatalogVehicle(record, JSON.parse(jsonFor(label)));
            record = saved.record;
            savedVehicles.push(saved.vehicle);
            assert.equal((await store.saveVehicle({
                vehicleId: saved.vehicle.id,
                vehicleName: saved.vehicle.label,
                jsonText: JSON.stringify(saved.vehicle.config),
            })).ok, true);
        }

        assert.deepEqual(savedVehicles.map((vehicle) => vehicle.id), [
            'editor_vehicle_mein-schiff',
            'editor_vehicle_mein-schiff-2',
        ]);
        assert.deepEqual((await readdir(directory)).sort(), [
            'editor_vehicle_mein-schiff-2.vehicle.json',
            'editor_vehicle_mein-schiff.vehicle.json',
        ]);
        assert.equal((await store.getVehicle({ vehicleId: savedVehicles[0].id })).config.label, 'Mein Schiff!');
        assert.equal((await store.getVehicle({ vehicleId: savedVehicles[1].id })).config.label, 'Mein Schiff?');
    });
});

test('desktop store accepts every long collision id the 24-entry catalog can generate', async () => {
    await withStore(async (store, directory) => {
        const slug = 'a'.repeat(48);
        let record = null;
        const savedVehicles = [];
        for (let index = 1; index <= 24; index += 1) {
            const label = `${slug}${'!'.repeat(index)}`;
            const saved = upsertVehicleLabCatalogVehicle(record, JSON.parse(jsonFor(label)));
            record = saved.record;
            savedVehicles.push(saved.vehicle);
            assert.equal((await store.saveVehicle({
                vehicleId: saved.vehicle.id,
                vehicleName: saved.vehicle.label,
                jsonText: JSON.stringify(saved.vehicle.config),
            })).ok, true);
        }

        assert.equal(savedVehicles[0].id.length, 63);
        assert.equal(savedVehicles[1].id.length, 65);
        assert.equal(savedVehicles[23].id.length, 66);
        assert.equal(savedVehicles[23].id.endsWith('-24'), true);
        assert.equal((await readdir(directory)).length, 24);
        assert.equal((await store.getVehicle({ vehicleId: savedVehicles[23].id })).config.label, `${slug}${'!'.repeat(24)}`);
    });
});

test('an invalid explicit vehicle id is rejected without overwriting its label fallback', async () => {
    await withStore(async (store, directory) => {
        const first = await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        const rejected = await store.saveVehicle({
            vehicleId: '../alpha',
            vehicleName: 'Alpha',
            jsonText: jsonFor('Replacement'),
        });

        assert.deepEqual(rejected, { ok: false, error: 'invalid_vehicle_id' });
        assert.equal((await store.getVehicle({ vehicleId: first.vehicleId })).config.label, 'Alpha');
        assert.deepEqual(await readdir(directory), ['editor_vehicle_alpha.vehicle.json']);
    });
});

test('saving rejects payloads that are not usable vehicle configs', async () => {
    await withStore(async (store) => {
        assert.equal((await store.saveVehicle({ jsonText: '' })).error, 'empty_payload');
        assert.equal((await store.saveVehicle({ jsonText: '{ kaputt' })).error, 'invalid_json');
        assert.equal((await store.saveVehicle({ jsonText: `{"a":"${'x'.repeat(3 * 1024 * 1024)}"}` })).error, 'payload_too_large');
    });
});

test('a failed atomic overwrite preserves the last readable vehicle file', async () => {
    await withStore(async (store, directory) => {
        assert.equal((await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' })).ok, true);
        const failingStore = createEditorVehicleStore({
            getVehiclesDirectory: () => directory,
            renameFile(source, target) {
                if (source.endsWith('.tmp')) throw new Error('simulated publish failure');
                return require('node:fs').renameSync(source, target);
            },
        });

        const failed = await failingStore.saveVehicle({
            vehicleId: 'editor_vehicle_alpha',
            vehicleName: 'Alpha',
            jsonText: jsonFor('Replacement'),
        });

        assert.equal(failed.ok, false);
        assert.equal((await failingStore.getVehicle({ vehicleId: 'editor_vehicle_alpha' })).config.label, 'Alpha');
        assert.deepEqual(await readdir(directory), ['editor_vehicle_alpha.vehicle.json']);
    });
});

test('a vehicle id can never point outside the vehicle directory', async () => {
    const hostile = ['../escape', '..', 'a/b', 'C:\Windows\evil', '', 'Groß'];
    for (const id of hostile) {
        assert.equal(isValidVehicleId(id), false, id);
    }
    await withStore(async (store, directory) => {
        for (const id of hostile) {
            assert.equal((await store.getVehicle({ vehicleId: id })).ok, false, id);
            assert.equal((await store.deleteVehicle({ vehicleId: id })).ok, false, id);
        }
        assert.deepEqual(await readdir(directory), []);
    });
});

test('Windows device ids are rejected before they reach the filesystem', async () => {
    const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9'];
    for (const id of reserved) assert.equal(isValidVehicleId(id), false, id);

    await withStore(async (store, directory) => {
        for (const vehicleId of reserved) {
            assert.equal((await store.getVehicle({ vehicleId })).error, 'invalid_vehicle_id', vehicleId);
            assert.equal((await store.deleteVehicle({ vehicleId })).error, 'invalid_vehicle_id', vehicleId);
            assert.equal((await store.saveVehicle({ vehicleId, jsonText: jsonFor('Replacement') })).error, 'invalid_vehicle_id', vehicleId);
            assert.equal((await store.renameVehicle({ vehicleId, vehicleName: 'Replacement' })).error, 'invalid_vehicle_id', vehicleId);
        }
        assert.deepEqual(await readdir(directory), []);
    });
});

test('renaming moves the file and refuses to clobber another vehicle', async () => {
    await withStore(async (store, directory) => {
        const first = await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        await store.saveVehicle({ jsonText: jsonFor('Beta'), vehicleName: 'Beta' });

        assert.equal((await store.renameVehicle({ vehicleId: first.vehicleId, vehicleName: 'Beta' })).error, 'name_taken');

        const renamed = await store.renameVehicle({ vehicleId: first.vehicleId, vehicleName: 'Gamma' });
        assert.equal(renamed.ok, true);
        assert.equal(renamed.vehicleId, 'editor_vehicle_gamma');
        assert.equal((await store.getVehicle({ vehicleId: renamed.vehicleId })).config.label, 'Gamma');
        assert.equal((await store.getVehicle({ vehicleId: first.vehicleId })).ok, false);

        const files = (await readdir(directory)).sort();
        assert.deepEqual(files, ['editor_vehicle_beta.vehicle.json', 'editor_vehicle_gamma.vehicle.json']);
    });
});

test('concurrent renames to the same id serialize and preserve both vehicle records', async () => {
    await withStore(async (store, directory) => {
        const alpha = await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        const beta = await store.saveVehicle({ jsonText: jsonFor('Beta'), vehicleName: 'Beta' });

        const results = await Promise.all([
            store.renameVehicle({ vehicleId: alpha.vehicleId, vehicleName: 'Shared' }),
            store.renameVehicle({ vehicleId: beta.vehicleId, vehicleName: 'Shared' }),
        ]);

        assert.deepEqual(results.map(({ ok, error }) => ({ ok, error })), [
            { ok: true, error: undefined },
            { ok: false, error: 'name_taken' },
        ]);
        assert.equal((await store.getVehicle({ vehicleId: 'editor_vehicle_shared' })).config.label, 'Shared');
        assert.equal((await store.getVehicle({ vehicleId: beta.vehicleId })).config.label, 'Beta');
        assert.deepEqual((await readdir(directory)).sort(), [
            'editor_vehicle_beta.vehicle.json',
            'editor_vehicle_shared.vehicle.json',
        ]);
    });
});

test('queued delete and save mutations keep their submission order', async () => {
    await withStore(async (store) => {
        const saved = await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        const deletion = store.deleteVehicle({ vehicleId: saved.vehicleId });
        const replacement = store.saveVehicle({
            vehicleId: saved.vehicleId,
            vehicleName: 'Alpha',
            jsonText: jsonFor('Replacement'),
        });

        assert.equal((await deletion).ok, true);
        assert.equal((await replacement).ok, true);
        assert.equal((await store.getVehicle({ vehicleId: saved.vehicleId })).config.label, 'Replacement');

        const secondReplacement = store.saveVehicle({
            vehicleId: saved.vehicleId,
            vehicleName: 'Alpha',
            jsonText: jsonFor('Final'),
        });
        const secondDeletion = store.deleteVehicle({ vehicleId: saved.vehicleId });
        assert.equal((await secondReplacement).ok, true);
        assert.equal((await secondDeletion).ok, true);
        assert.deepEqual(await store.getVehicle({ vehicleId: saved.vehicleId }), { ok: false, error: 'unknown_vehicle' });
    });
});

test('a rejected mutation does not block later submissions in the store queue', async () => {
    await withStore(async (_store, directory) => {
        let directoryCalls = 0;
        const store = createEditorVehicleStore({
            getVehiclesDirectory() {
                directoryCalls += 1;
                if (directoryCalls === 1) throw new Error('temporary directory failure');
                return directory;
            },
        });
        const failed = store.saveVehicle({ jsonText: jsonFor('Failure'), vehicleName: 'Failure' });
        const next = store.saveVehicle({ jsonText: jsonFor('Success'), vehicleName: 'Success' });

        await assert.rejects(failed, /temporary directory failure/);
        assert.equal((await next).ok, true);
        assert.equal((await store.getVehicle({ vehicleId: 'editor_vehicle_success' })).config.label, 'Success');
    });
});

test('deleting removes exactly one vehicle and reports unknown ids', async () => {
    await withStore(async (store, directory) => {
        const saved = await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        await store.saveVehicle({ jsonText: jsonFor('Beta'), vehicleName: 'Beta' });

        assert.equal((await store.deleteVehicle({ vehicleId: 'editor_vehicle_gibtsnicht' })).error, 'unknown_vehicle');
        assert.equal((await store.deleteVehicle({ vehicleId: saved.vehicleId })).ok, true);
        assert.deepEqual(await readdir(directory), ['editor_vehicle_beta.vehicle.json']);
    });
});

test('unreadable files are skipped instead of breaking the listing', async () => {
    await withStore(async (store, directory) => {
        await store.saveVehicle({ jsonText: jsonFor('Alpha'), vehicleName: 'Alpha' });
        await writeFile(path.join(directory, 'editor_vehicle_kaputt.vehicle.json'), '{ kaputt', 'utf8');
        await writeFile(path.join(directory, 'notizen.txt'), 'kein Fahrzeug', 'utf8');

        assert.deepEqual((await store.listVehicles()).vehicles, [{ id: 'editor_vehicle_alpha', label: 'Alpha' }]);
    });
});

test('oversized vehicle files are skipped before they are parsed', async () => {
    await withStore(async (store, directory) => {
        await store.saveVehicle({ jsonText: jsonFor('Readable'), vehicleName: 'Readable' });
        await writeFile(
            path.join(directory, 'editor_vehicle_oversized.vehicle.json'),
            JSON.stringify({ label: 'Oversized', filler: 'x'.repeat(3 * 1024 * 1024) }),
            'utf8',
        );

        assert.deepEqual((await store.listVehicles()).vehicles, [
            { id: 'editor_vehicle_readable', label: 'Readable' },
        ]);
        assert.deepEqual(await store.getVehicle({ vehicleId: 'editor_vehicle_oversized' }), {
            ok: false,
            error: 'unreadable_vehicle',
        });
    });
});

test('a junction at a vehicle file path is refused without changing its target', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-vehicle-junction-'));
    const directory = path.join(root, 'vehicles');
    const targetDirectory = path.join(root, 'outside-target');
    await Promise.all([mkdir(directory), mkdir(targetDirectory)]);
    const sentinelPath = path.join(targetDirectory, 'sentinel.txt');
    await writeFile(sentinelPath, 'preserve this target', 'utf8');
    const linkPath = path.join(directory, 'editor_vehicle_external.vehicle.json');
    try {
        await symlink(targetDirectory, linkPath, 'junction');
    } catch {
        await rm(root, { recursive: true, force: true });
        return t.skip('directory junctions are unavailable on this machine');
    }

    try {
        const store = createEditorVehicleStore({ getVehiclesDirectory: () => directory });
        const vehicleId = 'editor_vehicle_external';
        assert.equal((await store.listVehicles()).vehicles.length, 0);
        assert.deepEqual(await store.getVehicle({ vehicleId }), { ok: false, error: 'unsafe_target' });
        assert.equal((await store.saveVehicle({ vehicleId, jsonText: jsonFor('Replacement') })).error, 'unsafe_target');
        assert.equal((await store.renameVehicle({ vehicleId, vehicleName: 'Replacement' })).error, 'unsafe_target');
        assert.equal((await store.deleteVehicle({ vehicleId })).error, 'unsafe_target');

        assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve this target');
        assert.deepEqual(await readdir(targetDirectory), ['sentinel.txt']);
        assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
