import test from 'node:test';
import assert from 'node:assert/strict';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Headless HUNT runs with four bots lost 15-21 bots per minute right after spawning on the
// old 50x25x50 box; with the room of the standard arena that dropped to the standard rate.
test('the empty arena gives four bots at least the room of the standard arena', () => {
    const empty = MAP_PRESET_CATALOG.empty;
    const standard = MAP_PRESET_CATALOG.standard;
    const [width, height, depth] = empty.size;
    const [standardWidth, standardHeight, standardDepth] = standard.size;
    assert.ok(width >= standardWidth && depth >= standardDepth,
        `empty floor ${width}x${depth} is smaller than the standard floor ${standardWidth}x${standardDepth}`);
    assert.ok(height >= standardHeight, `empty height ${height} is lower than the standard height ${standardHeight}`);
});

test('the empty arena stays an empty box without obstacles or portals', () => {
    const empty = MAP_PRESET_CATALOG.empty;
    assert.deepEqual(empty.obstacles, []);
    assert.deepEqual(empty.portals, []);
});
