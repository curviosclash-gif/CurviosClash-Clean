import assert from 'node:assert/strict';
import test from 'node:test';

import { syncMenuPresetState, syncPresetDeleteButton } from '../src/ui/menu/MenuPresetStateSync.js';
import { resolvePresetFailureMessage } from '../src/core/runtime/MenuRuntimePresetConfigService.js';

function createSelect(initialValue = '') {
    const select = {
        options: [],
        _value: initialValue,
        replaceChildren() { this.options = []; },
        appendChild(option) { this.options.push(option); },
        get value() { return this._value; },
        set value(next) { this._value = this.options.some((option) => option.value === next) ? next : ''; },
    };
    return select;
}

const PRESETS = [
    { id: 'fight-standard', name: 'Kampf Standard', metadata: { kind: 'fixed' } },
    { id: 'chaos', name: 'Chaos', metadata: { kind: 'fixed' } },
    { id: 'my-open', name: 'Mein Setup', metadata: { kind: 'open' } },
];

function withDocument(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ value: '', textContent: '' }) };
    try { return run(); } finally { globalThis.document = previous; }
}

function sync(ui, activePresetId = 'fight-standard') {
    withDocument(() => syncMenuPresetState({
        ui,
        settings: { matchSettings: { activePresetId, activePresetKind: 'fixed' } },
        settingsManager: { listMenuPresets: () => PRESETS },
    }));
}

test('the preset list keeps the preset the player picked', () => {
    const ui = { presetSelect: createSelect() };
    sync(ui);
    ui.presetSelect.value = 'my-open';
    sync(ui);
    assert.equal(ui.presetSelect.value, 'my-open', 'a later sync must not jump back to the style preset');
});

test('the preset status names the preset instead of its id', () => {
    const ui = { presetStatus: { textContent: '' } };
    sync(ui, 'fight-standard');
    assert.match(ui.presetStatus.textContent, /Kampf Standard/);
    assert.doesNotMatch(ui.presetStatus.textContent, /fight-standard/);
});

test('built-in presets cannot be deleted and say why', () => {
    const button = { disabled: false, title: '' };
    syncPresetDeleteButton(button, 'fight-standard');
    assert.equal(button.disabled, true);
    assert.match(button.title, /eingebaut/i);
    syncPresetDeleteButton(button, 'my-open');
    assert.equal(button.disabled, false);
    syncPresetDeleteButton(button, '');
    assert.equal(button.disabled, true);
    assert.match(resolvePresetFailureMessage({ reason: 'catalog_fixed_locked' }, 'x'), /eingebaut/i);
});
