import assert from 'node:assert/strict';
import test from 'node:test';

import { createRendererShellBuildConfig } from '../dev/vite/rendererShellConfig.js';

import {
    VEHICLE_LAB_CONFIG_LIMITS,
    normalizeVehicleLabConfig,
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
