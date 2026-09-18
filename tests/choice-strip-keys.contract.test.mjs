import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { bindChoiceStripKeys } from '../src/ui/start-setup/ChoiceStripKeys.js';

function createStrip(keys, selectedKey) {
    const doc = { activeElement: null };
    const items = keys.map((key) => ({
        dataset: { mapKey: key },
        tabIndex: key === selectedKey ? 0 : -1,
        disabled: false,
        getAttribute: (name) => (name === 'aria-selected' ? String(key === selectedKey) : null),
        focus() { doc.activeElement = this; },
    }));
    let keydown = null;
    const strip = {
        ownerDocument: doc,
        querySelectorAll: () => items,
        addEventListener: (type, handler) => { if (type === 'keydown') keydown = handler; },
    };
    const press = (key, target = doc.activeElement) => {
        let prevented = false;
        keydown({ key, target, preventDefault: () => { prevented = true; } });
        return prevented;
    };
    return { doc, items, strip, press };
}

test('arrow keys, Home and End move focus and selection along the tile strip', () => {
    const { doc, items, strip, press } = createStrip(['standard', 'maze', 'arena'], 'standard');
    const chosen = [];
    bindChoiceStripKeys({ strip, datasetKey: 'mapKey', onChoose: (key) => chosen.push(key), bind: (el, type, fn) => el.addEventListener(type, fn) });
    items[0].focus();
    assert.equal(press('ArrowRight'), true);
    assert.equal(doc.activeElement, items[1]);
    press('End');
    press('ArrowRight');
    press('ArrowLeft');
    press('Home');
    assert.deepEqual(chosen, ['maze', 'arena', 'maze', 'standard'], 'the last tile stays put instead of jumping around');
    assert.equal(doc.activeElement, items[0]);
    assert.equal(press('a'), false, 'other keys are left alone');
});

test('the map and vehicle strips both use the keyboard helper', () => {
    for (const file of ['StartSetupMapPicker3d.js', 'StartSetupVehiclePicker3d.js']) {
        const source = readFileSync(new URL(`../src/ui/start-setup/${file}`, import.meta.url), 'utf8');
        assert.match(source, /bindChoiceStripKeys\(/, file);
    }
});
