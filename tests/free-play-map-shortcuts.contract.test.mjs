// ============================================
// free-play-map-shortcuts.contract.test.mjs - Anbindung der Kartenwahl im freien Spiel (Menü-Umbau
// Etappe 2): Gedächtnis je Variante beim Wechsel (V7), Zufallskarte und Controller-Kurzwege (K7, K5).
// Läuft ohne Browser mit Ersatz-Elementen.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { GAMEPAD_MENU_BUTTONS, createGamepadMenuPoller } from '../src/ui/menu/GamepadMenuPoller.js';
import {
    renderFreePlayMapCount,
    rememberFreePlayVariantMap,
} from '../src/ui/start-setup/StartSetupFreePlayMaps.js';
import {
    createMapPickerShortcuts,
    cycleMapFilterValue,
    resolveMapPickerShortcut,
} from '../src/ui/start-setup/StartSetupMapShortcuts.js';

const MAPS = Object.freeze({
    open: {},
    duel: { excludedModes: ['ESCORT'] },
    race: { excludedModes: ['HUNT'] },
});

function createSettings(localSettings = {}) {
    return { mapKey: 'open', localSettings: { modePath: 'fight', ...localSettings } };
}

test('the memory field survives the save normalizer and drops unknown variants', () => {
    const settings = { localSettings: { freePlayMapByVariant: { flags: 'duel', arcade: 'x', ffa: '' } } };
    ensureMenuContractState(settings);
    assert.deepEqual(settings.localSettings.freePlayMapByVariant, { flags: 'duel' });
    const fresh = { localSettings: {} };
    ensureMenuContractState(fresh);
    assert.deepEqual(fresh.localSettings.freePlayMapByVariant, {});
    assert.equal(Object.isFrozen(fresh.localSettings.freePlayMapByVariant), false, 'a plain object, so the menu can edit it');
});

test('the map on screen is remembered for its variant, but only if the variant can host it', () => {
    const settings = createSettings();
    assert.equal(rememberFreePlayVariantMap({ settings, variant: 'flags', maps: MAPS, mapKey: 'duel' }), true);
    assert.deepEqual(settings.localSettings.freePlayMapByVariant, { flags: 'duel' });
    assert.equal(rememberFreePlayVariantMap({ settings, variant: 'flags', maps: MAPS, mapKey: 'duel' }), false, 'unchanged');
    assert.equal(rememberFreePlayVariantMap({ settings, variant: 'flags', maps: MAPS, mapKey: 'race' }), false, 'no HUNT');
    assert.equal(rememberFreePlayVariantMap({ settings, variant: 'flags', maps: MAPS, mapKey: 'custom' }), false);
    assert.equal(rememberFreePlayVariantMap({ settings, variant: 'flags', maps: MAPS, mapKey: 'open', isOffered: () => false }), false);
    assert.equal(rememberFreePlayVariantMap({ settings, variant: null, maps: MAPS, mapKey: 'open' }), false);
    assert.deepEqual(settings.localSettings.freePlayMapByVariant, { flags: 'duel' });
});

test('the counter line shows the text and hides itself outside free play', () => {
    const classes = new Set(['hidden']);
    const attributes = {};
    const node = {
        textContent: '',
        classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
        setAttribute: (name, value) => { attributes[name] = value; },
    };
    renderFreePlayMapCount(node, 'flags', 24);
    assert.equal(node.textContent, '24 Karten passen zu Flaggen');
    assert.equal(classes.has('hidden'), false);
    renderFreePlayMapCount(node, null, 24);
    assert.equal(node.textContent, '');
    assert.equal(classes.has('hidden'), true);
    assert.equal(attributes['aria-hidden'], 'true');
});

test('the pad buttons map to the map choice shortcuts and nothing else', () => {
    assert.equal(resolveMapPickerShortcut('LB'), 'previous-filter');
    assert.equal(resolveMapPickerShortcut('RB'), 'next-filter');
    assert.equal(resolveMapPickerShortcut('Y'), 'favorite');
    assert.equal(resolveMapPickerShortcut('X'), 'random');
    for (const button of ['A', 'B', 'START', 'constructor', '']) assert.equal(resolveMapPickerShortcut(button), '', button);
});

test('filters cycle both ways and wrap around', () => {
    const values = ['all', 'arena', 'favorites'];
    assert.equal(cycleMapFilterValue(values, 'all', 1), 'arena');
    assert.equal(cycleMapFilterValue(values, 'favorites', 1), 'all');
    assert.equal(cycleMapFilterValue(values, 'all', -1), 'favorites');
    assert.equal(cycleMapFilterValue(values, 'unknown', 1), 'all');
    assert.equal(cycleMapFilterValue(values, 'unknown', -1), 'favorites');
    assert.equal(cycleMapFilterValue([], 'all', 1), '');
});

function createPickerHarness({ visible = true, recentMaps = [], filter = 'all', rolls = [0] } = {}) {
    const events = [];
    const settings = createSettings({ startSetup: { recentMaps, favoriteMaps: [], mapFilter: filter } });
    const option = (value, text = value) => ({ value, textContent: text, dataset: {}, hidden: false });
    const ui = {
        mapChoiceStatus: { textContent: '' },
        mapSelect: {
            value: 'a',
            options: [option('a', 'Alpha'), option('b', 'Beta'), option('c', 'Gamma'), option('d', 'Delta'), option('e', 'Eps')],
            dispatchEvent: (event) => events.push(event.type),
        },
        mapFilterSelect: { options: [option('all', 'Alle Karten'), option('arena', 'Arenen'), option('favorites', 'Nur Favoriten')] },
    };
    ui.mapSelect.options[4].dataset.filterRetained = 'true';
    let syncs = 0;
    let roll = 0;
    const shortcuts = createMapPickerShortcuts({
        ui, getSettings: () => settings, sync: () => { syncs += 1; }, isVisible: () => visible,
        rng: () => rolls[Math.min(roll++, rolls.length - 1)],
    });
    return { ui, settings, shortcuts, events, syncs: () => syncs };
}

test('X draws a random map from the list, skips the last three and says which one it chose', () => {
    const h = createPickerHarness({ recentMaps: ['a', 'b', 'c'], rolls: [0.99] });
    assert.equal(h.shortcuts.handleButton('X'), true);
    // Candidates: a-d (e is only retained). a, b, c were played lately, so only d is left.
    assert.equal(h.ui.mapSelect.value, 'd');
    assert.deepEqual(h.events, ['change']);
    assert.equal(h.ui.mapChoiceStatus.textContent, 'Zufällige Karte: Delta');
});

test('with a single map in the list the pick may repeat the recent maps', () => {
    const h = createPickerHarness({ recentMaps: ['a', 'b', 'c'] });
    h.ui.mapSelect.options.splice(1);
    h.shortcuts.pickRandom();
    assert.equal(h.ui.mapSelect.value, 'a');
});

test('an empty list gives a spoken hint instead of a change', () => {
    const h = createPickerHarness();
    h.ui.mapSelect.options.length = 0;
    assert.equal(h.shortcuts.pickRandom(), false);
    assert.deepEqual(h.events, []);
    assert.match(h.ui.mapChoiceStatus.textContent, /Keine Karte/);
});

test('LB and RB step the filter and announce it; Y toggles the favourite of the chosen map', () => {
    const h = createPickerHarness();
    assert.equal(h.shortcuts.handleButton('RB'), true);
    assert.equal(h.settings.localSettings.startSetup.mapFilter, 'arena');
    assert.equal(h.ui.mapChoiceStatus.textContent, 'Filter: Arenen');
    h.shortcuts.handleButton('LB');
    h.shortcuts.handleButton('LB');
    assert.equal(h.settings.localSettings.startSetup.mapFilter, 'favorites');
    h.shortcuts.handleButton('Y');
    assert.deepEqual(h.settings.localSettings.startSetup.favoriteMaps, ['a']);
    assert.equal(h.ui.mapChoiceStatus.textContent, 'Favorit: Alpha');
    h.shortcuts.handleButton('Y');
    assert.deepEqual(h.settings.localSettings.startSetup.favoriteMaps, []);
    assert.equal(h.ui.mapChoiceStatus.textContent, 'Kein Favorit mehr: Alpha');
    assert.equal(h.syncs(), 5);
});

test('while the map choice is not visible no press is taken, so the menu keeps LB/RB for focus', () => {
    const h = createPickerHarness({ visible: false });
    for (const button of ['LB', 'RB', 'X', 'Y']) assert.equal(h.shortcuts.handleButton(button), false, button);
    assert.equal(h.settings.localSettings.startSetup.mapFilter, 'all');
    assert.deepEqual(h.events, []);
    assert.equal(h.shortcuts.handleButton('A'), false);
});

test('the menu poller reports X and Y presses once each and leaves the old buttons alone', () => {
    const pad = {
        buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
    };
    const calls = [];
    const poller = createGamepadMenuPoller({
        getGamepads: () => [pad],
        onX: () => calls.push('X'),
        onY: () => calls.push('Y'),
        onConfirm: () => calls.push('A'),
    });
    pad.buttons[GAMEPAD_MENU_BUTTONS.X].pressed = true;
    pad.buttons[GAMEPAD_MENU_BUTTONS.Y].pressed = true;
    poller.poll(0);
    poller.poll(16);
    assert.deepEqual(calls, ['X', 'Y']);
    assert.equal(GAMEPAD_MENU_BUTTONS.X, 2);
    assert.equal(GAMEPAD_MENU_BUTTONS.Y, 3);
});
