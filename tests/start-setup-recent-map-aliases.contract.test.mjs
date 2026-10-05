// ============================================
// start-setup-recent-map-aliases.contract.test.mjs - "Zuletzt benutzt" zeigte zweimal
// "Notre-Dame Arena" (Menüprüfung 28.09.2026, F4). Seit der Notre-Dame-Evolution sind
// notre_dame_fire und notre_dame_fire_arena nur noch versteckte Doppel der Karten notre_dame und
// notre_dame_arena (gleicher Name, gleiche Karte); gespeicherte Verläufe aus der Zeit davor
// behielten die alten Schlüssel. Beim Laden werden sie auf die heutige Karte umgeschrieben und
// zusammengelegt, statt verworfen zu werden.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureHangarSelectionWritebackState } from '../src/ui/hangar/HangarSelectionWritebackContract.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

/** Settings as a player stored them before the evolution: the fire arena was its own map. */
function createStoredSettings(startSetup) {
    return { vehicles: {}, localSettings: { startSetup } };
}

test('stored recents that name the old fire maps show each Notre-Dame map once', () => {
    const startSetup = ensureHangarSelectionWritebackState(createStoredSettings({
        recentMaps: ['notre_dame_fire_arena', 'standard', 'notre_dame_arena', 'notre_dame_fire'],
        favoriteMaps: ['notre_dame_fire_arena', 'notre_dame_arena', 'trench'],
    }));
    assert.deepEqual(startSetup.recentMaps, ['notre_dame_arena', 'standard', 'notre_dame'],
        'the old fire arena becomes the arena it is now part of, kept at its place, without a second entry');
    assert.deepEqual(startSetup.favoriteMaps, ['notre_dame_arena', 'trench'], 'favourites follow the same rule');
});

test('the rewrite keeps every other stored entry and is stable on reload', () => {
    const settings = createStoredSettings({ recentMaps: ['custom', 'notre_dame_fire', 'trench'] });
    const first = [...ensureHangarSelectionWritebackState(settings).recentMaps];
    assert.deepEqual(first, ['custom', 'notre_dame', 'trench']);
    assert.deepEqual(ensureHangarSelectionWritebackState(settings).recentMaps, first, 'a second load changes nothing');
});

test('every hidden map that only duplicates a visible map by name is rewritten', () => {
    const visibleByName = new Map(Object.entries(MAP_PRESET_CATALOG)
        .filter(([, preset]) => preset?.hiddenFromMapPicker !== true)
        .map(([key, preset]) => [preset?.name, key]));
    for (const [key, preset] of Object.entries(MAP_PRESET_CATALOG)) {
        if (preset?.hiddenFromMapPicker !== true || !visibleByName.has(preset.name)) continue;
        const { recentMaps } = ensureHangarSelectionWritebackState(createStoredSettings({ recentMaps: [key] }));
        assert.deepEqual(recentMaps, [visibleByName.get(preset.name)],
            `${key} looks like "${preset.name}" in the recents and must resolve to the visible map`);
    }
});
