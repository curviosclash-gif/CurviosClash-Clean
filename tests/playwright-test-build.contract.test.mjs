import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { createRendererShellBuildConfig } from '../dev/vite/rendererShellConfig.js';
import { playwrightTestRuntimeBridgePlugin } from '../dev/vite/playwrightVitePlugins.js';
import { buildCurviosTestApi } from '../src/core/TestApiBridge.js';

test('Playwright renderer has a separate output directory and resolves its runtime bridge', () => {
    const rootDir = process.cwd();
    const buildOptions = { rootDir, chunkSizeWarningLimit: 1300 };
    assert.equal(createRendererShellBuildConfig({
        ...buildOptions,
        env: { VITE_APP_MODE: 'app' },
    }).outDir, 'dist-app');
    assert.equal(createRendererShellBuildConfig({
        ...buildOptions,
        env: { VITE_APP_MODE: 'app', CURVIOS_E2E_BUILD: '1' },
    }).outDir, 'dist-app-test');

    const importer = path.join(rootDir, 'src/core/AppInitializerLifecycle.js');
    const bridge = path.join(rootDir, 'tests/support/E2ETestRuntimeBridge.js');
    assert.equal(playwrightTestRuntimeBridgePlugin({ PW_RUN_TAG: 'contract' })
        .resolveId('./E2ETestRuntimeBridge.js', importer), bridge);
    assert.equal(playwrightTestRuntimeBridgePlugin({})
        .resolveId('./E2ETestRuntimeBridge.js', importer), null);
});

test('test API provides the imports and functions used by desktop validation specs', async () => {
    const api = buildCurviosTestApi();
    assert.equal(typeof api.applyTrailDamageFromProjectile, 'function');
    assert.equal(typeof api.updatePlayerHealthRegen, 'function');
    assert.equal(typeof api.ObservationSystem.createObservationContext, 'function');
    assert.equal(typeof api.importCurviosTestModule, 'function');
    const gameLoop = await api.importCurviosTestModule('/src/core/GameLoop.js');
    const validation = await api.importCurviosTestModule('/src/core/runtime/MatchStartValidationService.js');
    assert.equal(typeof gameLoop.GameLoop, 'function');
    assert.equal(typeof validation.resolveMatchStartValidationIssue, 'function');
});
