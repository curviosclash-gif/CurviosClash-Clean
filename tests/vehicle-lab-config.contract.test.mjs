import assert from 'node:assert/strict';
import test from 'node:test';

import { createRendererShellBuildConfig } from '../dev/vite/rendererShellConfig.js';

import {
    VEHICLE_LAB_CATALOG_STORAGE_KEY,
    VEHICLE_LAB_CONFIG_LIMITS,
    deleteVehicleLabCatalogVehicle,
    loadVehicleLabCatalog,
    normalizeVehicleLabConfig,
    renameVehicleLabCatalogVehicle,
    saveVehicleLabCatalog,
    upsertVehicleLabCatalogVehicle,
} from '../src/shared/contracts/VehicleLabConfigContract.js';

test('Vehicle Lab config normalizes unsafe numeric and enum values', () => {
    const result = normalizeVehicleLabConfig({
        label: '  Test   Vehicle  ',
        primaryColor: 0xffffffff,
        parts: [{
            name: 'Wing',
            geo: 'unknown',
            size: [Infinity, -5, 200],
            pos: [Infinity, -500, 12],
            scale: [0, 50, 1],
            material: 'unknown',
        }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.config.label, 'Test Vehicle');
    assert.equal(result.config.primaryColor, 0xffffff);
    assert.equal(result.config.parts[0].geo, 'box');
    assert.deepEqual(result.config.parts[0].size, [1, 0.01, 50]);
    assert.deepEqual(result.config.parts[0].pos, [0, -100, 12]);
    assert.deepEqual(result.config.parts[0].scale, [0.01, 20, 1]);
    assert.equal(result.config.parts[0].material, 'primary');
    assert.equal(result.config.parts[0].role, undefined);
});

test('Vehicle Lab config preserves explicit gameplay roles', () => {
    const result = normalizeVehicleLabConfig({
        label: 'Rollenfahrzeug',
        parts: [
            { name: 'Deutscher Rumpf', geo: 'box', role: 'core' },
            { name: 'Ungültig', geo: 'box', role: 'pilot' },
        ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.config.parts[0].role, 'core');
    assert.equal(result.config.parts[1].role, undefined);
});

test('Vehicle Lab catalog persists, renames and deletes full runtime configs', () => {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
    };
    const config = {
        label: 'Mein Flieger',
        parts: [{ name: 'Rumpf', geo: 'box', role: 'core' }],
    };
    const saved = upsertVehicleLabCatalogVehicle(null, config);
    saveVehicleLabCatalog(saved.record, storage);

    const loaded = loadVehicleLabCatalog(storage);
    assert.equal(loaded.vehicles[0].id, 'editor_vehicle_mein-flieger');
    assert.equal(loaded.vehicles[0].config.parts[0].role, 'core');
    assert.ok(values.has(VEHICLE_LAB_CATALOG_STORAGE_KEY));

    const renamed = renameVehicleLabCatalogVehicle(loaded, saved.vehicle.id, 'Neuer Name');
    assert.equal(renamed.vehicle.id, 'editor_vehicle_neuer-name');
    assert.equal(renamed.vehicle.label, 'Neuer Name');

    const deleted = deleteVehicleLabCatalogVehicle(renamed.record, renamed.vehicle.id);
    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.record.vehicles, []);
});

test('runtime vehicle registry reads packaged-desktop catalog storage', async () => {
    const previousStorage = globalThis.localStorage;
    const saved = upsertVehicleLabCatalogVehicle(null, {
        label: 'Desktop Flieger',
        parts: [{ name: 'Rumpf', geo: 'box', role: 'core' }],
    });
    const storageValue = JSON.stringify(saved.record);
    globalThis.localStorage = {
        getItem: (key) => key === VEHICLE_LAB_CATALOG_STORAGE_KEY ? storageValue : null,
    };
    try {
        const registry = await import(`../src/entities/vehicle-registry.js?vehicle-lab=${Date.now()}`);
        assert.equal(registry.isValidVehicleId(saved.vehicle.id), true);
        assert.ok(registry.listVehicleDescriptors().some((entry) => (
            entry.id === saved.vehicle.id && entry.isGeneratedModular === true
        )));
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});

test('Vehicle Lab config rejects empty vehicles and caps total parts', () => {
    assert.equal(normalizeVehicleLabConfig({ parts: [] }).ok, false);

    const result = normalizeVehicleLabConfig({
        parts: Array.from({ length: VEHICLE_LAB_CONFIG_LIMITS.maxParts + 10 }, (_, index) => ({
            name: `Part ${index}`,
            geo: 'box',
        })),
    });
    assert.equal(result.ok, true);
    assert.equal(result.config.parts.length, VEHICLE_LAB_CONFIG_LIMITS.maxParts);
    assert.ok(result.warnings.length > 0);
});

test('Vehicle Lab config caps nested depth', () => {
    const root = { name: 'Root', geo: 'box' };
    let cursor = root;
    for (let depth = 0; depth < 12; depth++) {
        cursor.children = [{ name: `Child ${depth}`, geo: 'box' }];
        cursor = cursor.children[0];
    }
    const result = normalizeVehicleLabConfig({ parts: [root] });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((warning) => warning.includes('Verschachtelung')));
});

test('desktop build ships Vehicle Lab while the mobile target remains game-only', () => {
    const desktop = createRendererShellBuildConfig({
        rootDir: process.cwd(),
        chunkSizeWarningLimit: 1300,
        env: { VITE_APP_MODE: 'app' },
    });
    assert.match(desktop.rollupOptions.input.vehicleLab, /prototypes[\\/]vehicle-lab[\\/]index\.html$/);

    const mobile = createRendererShellBuildConfig({
        rootDir: process.cwd(),
        chunkSizeWarningLimit: 1300,
        env: { VITE_APP_MODE: 'app', VITE_APP_TARGET: 'mobile-classic' },
    });
    assert.deepEqual(Object.keys(mobile.rollupOptions.input), ['app']);
});
