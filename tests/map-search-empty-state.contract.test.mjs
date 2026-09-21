import assert from 'node:assert/strict';
import test from 'node:test';

import { syncStartSetupSelectionState } from '../src/ui/start-setup/StartSetupSelectionSync.js';

function createElement() {
    const classes = new Set(['hidden']);
    return {
        value: '', textContent: '', dataset: {}, options: [], children: [],
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); },
        },
        setAttribute() {},
        closest() { return null; },
        replaceChildren() { this.children = []; this.options = []; this.value = ''; },
        appendChild(child) {
            this.children.push(child);
            if (child.tagName === 'OPTION') {
                this.options.push(child);
                if (!this.value) this.value = child.value;
            }
        },
    };
}

test('map and vehicle searches hide unrelated recent entries and show empty feedback', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement(tagName) { return { ...createElement(), tagName: tagName.toUpperCase() }; } };
    try {
        const startSetup = {
            mapSearch: 'xyzq', mapFilter: 'all', vehicleSearch: 'xyzq', vehicleFilter: 'all',
            favoriteMaps: [], recentMaps: ['standard'], favoriteVehicles: [], recentVehicles: ['ship5'],
        };
        const settings = {
            mapKey: 'standard', vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' },
            localSettings: { modePath: 'normal', startSetup },
        };
        const ui = {
            mapSelect: createElement(), vehicleSelectP1: createElement(),
            mapRecentList: createElement(), vehicleRecentList: createElement(),
            mapSearchEmpty: createElement(), vehicleSearchEmpty: createElement(),
        };
        const sync = () => syncStartSetupSelectionState({
            ui, settings, startSetup,
            runtimeMaps: { standard: { name: 'Standard', size: [80, 30, 80] } },
            surfaceMenuState: { mapKey: 'standard' },
            mapPreviewEntries: [{ key: 'standard', name: 'Standard', category: 'medium' }],
            vehiclePreviewEntries: [{ id: 'ship5', label: 'Falke', category: 'light' }],
            modePath: 'normal', hangarSelectionModePath: 'normal',
            surfacePolicyPort: { isMapAllowed: () => true },
            formatMapLabel: (entry) => entry.name,
            resolveSurfaceFallbackMapKey: () => 'standard',
            hasStoredCustomMap: () => false,
            ghostDuelState: {},
        });

        sync();
        assert.equal(ui.mapRecentList.children.length, 0);
        assert.equal(ui.vehicleRecentList.children.length, 0);
        assert.equal(ui.mapSearchEmpty.classList.contains('hidden'), false);
        assert.equal(ui.vehicleSearchEmpty.classList.contains('hidden'), false);
        assert.equal(ui.mapSearchEmpty.textContent, 'Keine Karte gefunden — Suche oder Filter ändern');
        assert.equal(ui.vehicleSearchEmpty.textContent, 'Kein Flugzeug gefunden — Suche oder Filter ändern');
        assert.equal(settings.mapKey, 'standard', 'a failed search must not overwrite the chosen map');

        startSetup.mapSearch = '';
        startSetup.vehicleSearch = '';
        sync();
        assert.equal(ui.mapRecentList.children.length, 1);
        assert.equal(ui.vehicleRecentList.children.length, 1);
        assert.equal(ui.mapSearchEmpty.classList.contains('hidden'), true);
        assert.equal(ui.vehicleSearchEmpty.classList.contains('hidden'), true);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
