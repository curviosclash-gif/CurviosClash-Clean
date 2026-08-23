import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_MAP_BRIGHTNESS,
    MAP_BRIGHTNESS_LEVELS,
    MAP_BRIGHTNESS_ORDER,
    normalizeMapBrightness,
    resolveMapBrightnessFactors,
    resolveMapBrightnessLabel,
} from '../src/shared/contracts/MapBrightnessContract.js';

test('map brightness offers exactly three levels with mittel as default', () => {
    assert.deepEqual(MAP_BRIGHTNESS_ORDER, ['dunkel', 'mittel', 'hell']);
    assert.equal(DEFAULT_MAP_BRIGHTNESS, MAP_BRIGHTNESS_LEVELS.MEDIUM);
});

test('map brightness normalization accepts casing and whitespace, rejects the rest', () => {
    assert.equal(normalizeMapBrightness('hell'), 'hell');
    assert.equal(normalizeMapBrightness('  HELL  '), 'hell');
    assert.equal(normalizeMapBrightness('Dunkel'), 'dunkel');

    assert.equal(normalizeMapBrightness('sehr-hell'), DEFAULT_MAP_BRIGHTNESS);
    assert.equal(normalizeMapBrightness(''), DEFAULT_MAP_BRIGHTNESS);
    assert.equal(normalizeMapBrightness(null), DEFAULT_MAP_BRIGHTNESS);
    assert.equal(normalizeMapBrightness(undefined), DEFAULT_MAP_BRIGHTNESS);
    assert.equal(normalizeMapBrightness(3), DEFAULT_MAP_BRIGHTNESS);

    assert.equal(normalizeMapBrightness('kaputt', 'dunkel'), 'dunkel');
    assert.equal(normalizeMapBrightness('kaputt', 'auch-kaputt'), DEFAULT_MAP_BRIGHTNESS);
});

test('mittel stays perfectly neutral so the default look never shifts', () => {
    const medium = resolveMapBrightnessFactors('mittel');
    assert.equal(medium.exposure, 1);
    assert.equal(medium.ambient, 1);
    assert.equal(medium.fog, 1);
});

test('dunkel reads as night without changing the automatic view distance', () => {
    const dark = resolveMapBrightnessFactors('dunkel');

    // Ambient bricht deutlich staerker ein als die Belichtung - damit traegt fast nur noch
    // das gerichtete Key-Light und die Szene bekommt harte Nachtkontraste.
    assert.ok(dark.ambient < 0.4);
    assert.ok(dark.ambient < dark.exposure);

    assert.equal(dark.fog, 1);
});

test('all brightness levels leave the automatic view distance alone', () => {
    for (const brightness of MAP_BRIGHTNESS_ORDER) {
        assert.equal(resolveMapBrightnessFactors(brightness).fog, 1);
    }
});

test('map brightness factors rise strictly from dunkel over mittel zu hell', () => {
    const dark = resolveMapBrightnessFactors('dunkel');
    const medium = resolveMapBrightnessFactors('mittel');
    const bright = resolveMapBrightnessFactors('hell');

    assert.ok(dark.exposure < medium.exposure && medium.exposure < bright.exposure);
    assert.ok(dark.ambient < medium.ambient && medium.ambient < bright.ambient);

    // Ambient traegt bewusst weiter als die Belichtung: dunkle Bereiche sollen sich staerker
    // heben, damit helle Flaechen bei 'hell' nicht ausbrennen.
    assert.ok(bright.ambient - medium.ambient > bright.exposure - medium.exposure);
    assert.ok(medium.ambient - dark.ambient > medium.exposure - dark.exposure);
});

test('map brightness labels are resolved for the menu select', () => {
    assert.equal(resolveMapBrightnessLabel('dunkel'), 'Dunkel');
    assert.equal(resolveMapBrightnessLabel('mittel'), 'Mittel');
    assert.equal(resolveMapBrightnessLabel('hell'), 'Hell');
    assert.equal(resolveMapBrightnessLabel('unbekannt'), 'Mittel');
});
