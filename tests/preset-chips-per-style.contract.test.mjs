import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';
import { findFixedMenuPresetSeedById } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { formatMenuPresetChangeSummary, resolveMenuPresetModePath } from '../src/ui/menu/MenuPresetChipSummary.js';
import { syncMenuPresetState } from '../src/ui/menu/MenuPresetStateSync.js';

function createDocument() {
    return {
        createElement: (tag) => ({ tag, className: '', textContent: '' }),
    };
}

function createChip(presetId, doc) {
    const classes = new Set();
    const attributes = {};
    return {
        dataset: { presetId },
        ownerDocument: doc,
        children: [],
        textContent: '',
        title: '',
        disabled: false,
        classList: {
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute: (name, value) => { attributes[name] = value; },
        getAttribute: (name) => attributes[name],
        replaceChildren(...nodes) {
            this.children = nodes;
            this.textContent = nodes.map((node) => node.textContent).join('');
        },
    };
}

const CHIP_IDS = ['arcade', 'competitive', 'chaos', 'fight-standard', 'normal-standard'];

function syncChipsFor(modePath) {
    const doc = createDocument();
    const chips = CHIP_IDS.map((id) => createChip(id, doc));
    syncMenuPresetState({
        ui: { quickstartPresetButtons: chips },
        settings: { localSettings: { modePath }, matchSettings: {} },
        settingsManager: null,
    });
    return Object.fromEntries(chips.map((chip) => [chip.dataset.presetId, chip]));
}

test('each built-in preset belongs to the play style its game mode starts', () => {
    const styles = Object.fromEntries(CHIP_IDS.map((id) => [id, resolveMenuPresetModePath(findFixedMenuPresetSeedById(id))]));
    assert.deepEqual(styles, {
        arcade: 'arcade',
        competitive: 'normal',
        chaos: 'fight',
        'fight-standard': 'fight',
        'normal-standard': 'normal',
    });
});

test('the start setup only offers presets of the current play style', () => {
    const visible = (chips) => Object.entries(chips).filter(([, chip]) => !chip.classList.contains('hidden')).map(([id]) => id);
    assert.deepEqual(visible(syncChipsFor('fight')), ['chaos', 'fight-standard']);
    assert.deepEqual(visible(syncChipsFor('arcade')), ['arcade']);
    assert.deepEqual(visible(syncChipsFor('normal')), ['competitive', 'normal-standard']);
});

test('switching the play style refreshes the preset chips', () => {
    assert.ok(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.MODE_PATH]).includes('syncPresetState'));
});

test('a chip tells what it changes before it is applied', () => {
    const chip = syncChipsFor('fight')['fight-standard'];
    const [name, summary] = chip.children;
    assert.equal(name.textContent, 'Kampf Standard');
    assert.equal(summary.className, 'preset-chip-summary');
    assert.match(summary.textContent, /3 Bots · 10 Abschüsse · Tempo 20$/);
    assert.equal(chip.title, findFixedMenuPresetSeedById('fight-standard').description);
});

test('the change summary names the settings a preset touches', () => {
    const mapName = (key) => `Karte ${key}`;
    assert.equal(
        formatMenuPresetChangeSummary(findFixedMenuPresetSeedById('competitive').values, mapName),
        'Karte maze · Geteilter Bildschirm · Ohne Bots · 7 Siege · Tempo 20'
    );
    // Round wins mean nothing in an arcade run, so the summary leaves them out.
    assert.equal(
        formatMenuPresetChangeSummary(findFixedMenuPresetSeedById('arcade').values, mapName),
        'Karte parcours_rift · 2 Bots · Tempo 18'
    );
});
