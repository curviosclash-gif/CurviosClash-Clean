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

function desktopMap(name, extra = {}) {
    return { name, size: [80, 30, 80], obstacles: [], ...extra };
}

test('maps saved in the desktop user folder join the preset registry', () => {
    const saved = desktopMap('Gespeichert im Desktop');
    const presets = createGeneratedMapPresets({}, { editor_gespeichert: saved });
    assert.equal(presets.editor_gespeichert, saved);
});

test('the desktop user folder wins over a source-tree map with the same key', () => {
    const newer = desktopMap('Neuer Stand');
    const presets = createGeneratedMapPresets(
        { editor_arena: desktopMap('Alter Stand') },
        { editor_arena: newer },
    );
    assert.equal(presets.editor_arena, newer);
});

test('broken or foreign entries from the user folder are skipped', () => {
    const presets = createGeneratedMapPresets({}, {
        standard: desktopMap('Kapert die Standardkarte'),
        'editor_../escape': desktopMap('Pfad'),
        editor_no_size: { name: 'Ohne Groesse', obstacles: [] },
        editor_bad_size: desktopMap('Null', { size: [0, 30, 80] }),
        editor_bad_obstacles: desktopMap('Kein Array', { obstacles: 'x' }),
        editor_list: [],
        editor_ok: desktopMap('Gut'),
    });
    assert.deepEqual(Object.keys(presets), ['editor_ok']);
});

test('outside the desktop shell no user-folder maps are read', () => {
    const presets = createGeneratedMapPresets({});
    assert.deepEqual(Object.keys(presets), []);
});
