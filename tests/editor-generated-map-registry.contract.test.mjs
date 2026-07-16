import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGeneratedMapPresets } from '../src/core/config/maps/MapPresetsGenerated.js';

test('editor disk maps enter the runtime preset registry without mutating their document', () => {
    const editorMap = {
        name: 'Seeded Editor Map',
        map: {
            arenaSize: { width: 120, height: 60, depth: 120 },
            obstacles: [{ id: 'seeded-block', pos: [0, 5, 0], size: [10, 10, 10] }],
        },
    };

    const presets = createGeneratedMapPresets({ editor_seeded_map: editorMap });

    assert.equal(presets.editor_seeded_map, editorMap);
    assert.equal(presets.editor_seeded_map.map.obstacles.length, 1);
    assert.equal(Object.isFrozen(presets), true);
});
