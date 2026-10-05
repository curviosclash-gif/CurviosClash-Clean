import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererShellBuildConfig } from '../dev/vite/rendererShellConfig.js';

test('desktop and game presets initialize their lighting defaults in the same chunk', () => {
    for (const env of [{ VITE_APP_MODE: 'app' }, { VITE_APP_MODE: 'app', VITE_APP_TARGET: 'game' }]) {
        const config = createRendererShellBuildConfig({ rootDir: '.', env });
        const chunk = config.rollupOptions.output.manualChunks;
        assert.equal(chunk('F:/repo/src/shared/contracts/MapLightingContract.js'), 'map-presets');
        assert.equal(chunk('F:/repo/src/core/config/maps/MapPresetCatalogBaseData.js'), 'map-presets');
        assert.equal(chunk('F:/repo/src/shared/contracts/RocketPickupDefinitionsContract.js'), 'game-runtime');
        assert.equal(chunk('F:/repo/src/entities/vehicle-registry.js'), 'game-runtime');
    }
});
