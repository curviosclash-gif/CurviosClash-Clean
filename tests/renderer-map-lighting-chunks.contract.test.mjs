import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRendererShellBuildConfig } from '../dev/vite/rendererShellConfig.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = path.join(ROOT_DIR, 'src', 'core', 'config', 'maps');
const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?\sfrom\s*['"](\.{1,2}\/[^'"]+\.js)['"]/gm;

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

function listJsFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return listJsFiles(fullPath);
        return entry.name.endsWith('.js') ? [fullPath] : [];
    });
}

/**
 * game-runtime reads MAP_PRESET_CATALOG while it initializes. If anything in the
 * map-presets chunk imports back into game-runtime, the two chunks form a ring, and
 * whichever page imports map-presets first (the map editor does) evaluates
 * game-runtime before the catalog exists: "Cannot access '<x>' before initialization".
 */
test('map presets never import a module that the build places in game-runtime', () => {
    for (const env of [{ VITE_APP_MODE: 'app' }, { VITE_APP_MODE: 'app', VITE_APP_TARGET: 'game' }]) {
        const chunk = createRendererShellBuildConfig({ rootDir: ROOT_DIR, env }).rollupOptions.output.manualChunks;
        const pending = listJsFiles(MAPS_DIR)
            .filter((file) => chunk(file) === 'map-presets')
            .map((file) => ({ file, via: [] }));
        const seen = new Set(pending.map(({ file }) => file));
        const intoRuntime = [];
        while (pending.length > 0) {
            const { file, via } = pending.pop();
            const chain = [...via, path.relative(ROOT_DIR, file).replace(/\\/g, '/')];
            if (chunk(file) === 'game-runtime') {
                intoRuntime.push(chain.join(' -> '));
                continue;
            }
            for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
                const target = path.resolve(path.dirname(file), specifier);
                if (seen.has(target)) continue;
                seen.add(target);
                pending.push({ file: target, via: chain });
            }
        }
        assert.deepEqual(intoRuntime, [], `map presets import game-runtime modules (${env.VITE_APP_TARGET || 'desktop'})`);
    }
});
