import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/ui/SettingsChangeKeys.js';
import { bindArcadeRunSettings } from '../src/ui/menu/MenuArcadeRunSettingsBindings.js';
import {
    ARCADE_RUN_SETTINGS_RANGES,
    createDefaultArcadeRunSettings,
} from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { MATCH_SETTING_CHANGE_KEY_SET } from '../src/core/runtime/GameRuntimeSettingsKeySets.js';

function createControl(initialValue = '5') {
    const handlers = new Map();
    return {
        value: String(initialValue),
        disabled: false,
        title: '',
        min: '',
        max: '',
        dispatch(type) { (handlers.get(type) || []).forEach((handler) => handler()); },
        _handlers: handlers,
    };
}

function createHarness(settings = {}, sectorValue = '5') {
    const emitted = [];
    const sectorCountInput = createControl(sectorValue);
    const sectorCountLabel = { textContent: '' };
    const bind = (node, type, handler) => {
        if (!node?._handlers) return;
        if (!node._handlers.has(type)) node._handlers.set(type, []);
        node._handlers.get(type).push(handler);
    };
    bindArcadeRunSettings({
        ui: { arcadeSectorCountInput: sectorCountInput, arcadeSectorCountLabel: sectorCountLabel },
        settings,
        bind,
        emitSettingsChangedImmediate: (keys) => emitted.push(...keys),
        keys: SETTINGS_CHANGE_KEYS,
    });
    return { settings, sectorCountInput, sectorCountLabel, emitted };
}

test('the sector count has its own change key pointing at the persisted field', () => {
    assert.equal(typeof SETTINGS_CHANGE_KEYS.ARCADE_SECTOR_COUNT, 'string');
    assert.equal(
        SETTINGS_CHANGE_PATHS['arcade.sectorCount'],
        SETTINGS_CHANGE_KEYS.ARCADE_SECTOR_COUNT,
        'the change key resolves to the persisted settings path'
    );
});

test('the sector count counts as a match setting', () => {
    // Otherwise the runtime would not pick the new value up for the next match.
    assert.equal(MATCH_SETTING_CHANGE_KEY_SET.has(SETTINGS_CHANGE_KEYS.ARCADE_SECTOR_COUNT), true);
});

test('binding shows the stored sector count on the control', () => {
    const harness = createHarness({ arcade: { ...createDefaultArcadeRunSettings(), sectorCount: 7 } }, '5');
    assert.equal(harness.sectorCountInput.value, '7');
    assert.equal(harness.sectorCountLabel.textContent, '7');
});

test('binding falls back to the default when nothing is stored', () => {
    const harness = createHarness({});
    assert.equal(harness.sectorCountInput.value, String(createDefaultArcadeRunSettings().sectorCount));
    assert.equal(harness.settings.arcade.sectorCount, createDefaultArcadeRunSettings().sectorCount);
});

test('changing the control writes the value and reports the change key', () => {
    const harness = createHarness({});
    harness.sectorCountInput.value = '9';
    harness.sectorCountInput.dispatch('input');
    assert.equal(harness.settings.arcade.sectorCount, 9);
    assert.equal(harness.sectorCountLabel.textContent, '9');
    assert.deepEqual(harness.emitted, [SETTINGS_CHANGE_KEYS.ARCADE_SECTOR_COUNT]);
});

test('the control clamps to the contract range instead of writing nonsense', () => {
    const harness = createHarness({});
    harness.sectorCountInput.value = '99';
    harness.sectorCountInput.dispatch('input');
    assert.equal(harness.settings.arcade.sectorCount, ARCADE_RUN_SETTINGS_RANGES.sectorCount.max);
    assert.equal(harness.sectorCountInput.value, String(ARCADE_RUN_SETTINGS_RANGES.sectorCount.max));

    harness.sectorCountInput.value = 'abc';
    harness.sectorCountInput.dispatch('input');
    assert.equal(harness.settings.arcade.sectorCount, createDefaultArcadeRunSettings().sectorCount);
});

test('the control advertises the contract range to the browser', () => {
    const harness = createHarness({});
    assert.equal(harness.sectorCountInput.min, String(ARCADE_RUN_SETTINGS_RANGES.sectorCount.min));
    assert.equal(harness.sectorCountInput.max, String(ARCADE_RUN_SETTINGS_RANGES.sectorCount.max));
});

test('binding stays silent when the control is absent', () => {
    const emitted = [];
    assert.doesNotThrow(() => bindArcadeRunSettings({
        ui: {},
        settings: {},
        bind: () => {},
        emitSettingsChangedImmediate: (keys) => emitted.push(...keys),
        keys: SETTINGS_CHANGE_KEYS,
    }));
    assert.deepEqual(emitted, []);
});
