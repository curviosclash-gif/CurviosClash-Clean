import assert from 'node:assert/strict';
import test from 'node:test';

import { findStaticChunkRings } from '../dev/vite/rendererChunkRingGuard.js';

const chunk = (fileName, ...imports) => ({ fileName, imports });

test('two chunks that import each other form a ring', () => {
    assert.deepEqual(findStaticChunkRings([
        chunk('app.js', 'game-runtime.js'),
        chunk('game-runtime.js', 'developer-ui.js', 'three-core.js'),
        chunk('developer-ui.js', 'game-runtime.js'),
        chunk('three-core.js'),
    ]), [['developer-ui.js', 'game-runtime.js']]);
});

test('a ring through a third chunk is reported as one group', () => {
    // map-presets -> developer-ui -> game-runtime -> map-presets: no pair imports each other directly.
    assert.deepEqual(findStaticChunkRings([
        chunk('map-presets.js', 'developer-ui.js'),
        chunk('developer-ui.js', 'game-runtime.js'),
        chunk('game-runtime.js', 'map-presets.js'),
    ]), [['developer-ui.js', 'game-runtime.js', 'map-presets.js']]);
});

test('a one-way chunk graph and imports of unknown files pass', () => {
    assert.deepEqual(findStaticChunkRings([
        chunk('editorMap3d.js', 'map-presets.js', 'game-runtime.js', 'outside.js'),
        chunk('game-runtime.js', 'map-presets.js', 'three-core.js'),
        chunk('map-presets.js', 'three-core.js'),
        chunk('three-core.js', 'three-core.js'),
    ]), []);
});

test('every renderer build runs the chunk ring guard', async () => {
    const { default: createConfig } = await import('../vite.config.js');
    for (const mode of ['app', 'web', 'game']) {
        const names = createConfig({ mode, command: 'build' }).plugins.map((plugin) => plugin.name);
        assert.ok(names.includes('curvios-renderer-chunk-ring-guard'), `${mode} build has no chunk ring guard`);
    }
});
