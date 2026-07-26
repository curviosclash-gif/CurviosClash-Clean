import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { listMapPreviewEntries, resolveMapPreview } from '../src/ui/menu/MenuPreviewCatalog.js';
import { collectSpawnPoints } from '../src/ui/start-setup/StartSetupMapPicker3d.js';
import { syncStartSetupSelectionState } from '../src/ui/start-setup/StartSetupSelectionSync.js';

test('runtime parcours keep authored spawns and routes in one scaled world space', () => {
    const mapScale = CONFIG.ARENA.MAP_SCALE;
    const parcoursMaps = Object.entries(CONFIG.MAPS).filter(([, map]) => map?.parcours?.enabled === true);

    assert.equal(parcoursMaps.length, 19);
    for (const [mapKey, map] of parcoursMaps) {
        assert.equal(map.scaleAuthoredAnchors, true, `${mapKey} scales authored anchors`);
        const route = buildRouteFromParcours(map.parcours, { positionScale: mapScale });
        const spawn = map.playerSpawn;
        const firstCheckpoint = route.checkpoints[0];
        const startDistance = Math.hypot(
            (spawn.x * mapScale) - firstCheckpoint.pos[0],
            (spawn.y * mapScale) - firstCheckpoint.pos[1],
            (spawn.z * mapScale) - firstCheckpoint.pos[2]
        );
        assert.ok(startDistance <= 60, `${mapKey} starts close to its first checkpoint`);
    }
});

test('map preview metadata hides aliases without breaking direct runtime previews', () => {
    const entries = listMapPreviewEntries();
    const tutorial = entries.find((entry) => entry.key === 'tutorial_classic');
    const fortressAlias = entries.find((entry) => entry.key === 'die_festung');
    const expert = entries.find((entry) => entry.key === 'expert_gauntlet');

    assert.equal(tutorial.hiddenFromMapPicker, true);
    assert.equal(tutorial.hasParcours, true);
    assert.ok(tutorial.filterTags.includes('parcours'));
    assert.equal(fortressAlias.hiddenFromMapPicker, true);
    assert.equal(expert.hiddenFromMapPicker, false);
    assert.equal(resolveMapPreview('tutorial_classic').name, 'Classic Tutorial-Parcours');
});

test('map picker repairs hidden selections in both active and per-mode settings', () => {
    class FakeOption {
        constructor() {
            this.value = '';
            this.textContent = '';
            this.dataset = {};
        }
    }
    class FakeSelect {
        constructor() {
            this.options = [];
            this.value = '';
        }
        appendChild(option) {
            this.options.push(option);
            if (!this.value) this.value = option.value;
        }
        replaceChildren() {
            this.options = [];
            this.value = '';
        }
    }

    const originalDocument = globalThis.document;
    globalThis.document = { createElement: () => new FakeOption() };
    try {
        const startSetup = {
            mapSearch: '',
            mapFilter: 'all',
            vehicleSearch: '',
            vehicleFilter: 'all',
            favoriteMaps: [],
            recentMaps: [],
            favoriteVehicles: [],
            recentVehicles: [],
            modeSelections: {
                fight: { mapKey: 'hidden', vehicles: {} },
            },
        };
        const settings = {
            mapKey: 'hidden',
            vehicles: {},
            localSettings: { modePath: 'fight', startSetup },
        };
        const result = syncStartSetupSelectionState({
            ui: { mapSelect: new FakeSelect() },
            settings,
            startSetup,
            runtimeMaps: {
                hidden: { hiddenFromMapPicker: true },
                visible: {},
            },
            surfaceMenuState: { mapKey: 'hidden' },
            mapPreviewEntries: [
                { key: 'hidden', name: 'Hidden', hiddenFromMapPicker: true },
                { key: 'visible', name: 'Visible' },
            ],
            vehiclePreviewEntries: [],
            modePath: 'fight',
            hangarSelectionModePath: 'fight',
            surfacePolicyPort: { isMapAllowed: () => true },
            formatMapLabel: (entry) => entry.name,
            resolveSurfaceFallbackMapKey: () => 'visible',
            hasStoredCustomMap: () => false,
            ghostDuelState: {},
        });

        assert.equal(result.effectiveMapKey, 'visible');
        assert.equal(settings.mapKey, 'visible');
        assert.equal(startSetup.modeSelections.fight.mapKey, 'visible');
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('map preview accepts authored xyz spawn objects', () => {
    assert.deepEqual(collectSpawnPoints({
        playerSpawn: { x: 1, y: 2, z: 3 },
        botSpawns: [{ x: 4, y: 5, z: 6 }, { position: [7, 8, 9] }, {}],
    }), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
});

test('map picker exposes gameplay filters and omits hidden runtime maps', () => {
    class FakeOption {
        constructor(value = '', textContent = '') {
            this.value = value;
            this.textContent = textContent;
            this.dataset = {};
        }
    }
    class FakeSelect {
        constructor(options = []) {
            this.options = options;
            this.value = options[0]?.value || '';
        }
        appendChild(option) {
            this.options.push(option);
            if (!this.value) this.value = option.value;
        }
        replaceChildren() {
            this.options = [];
            this.value = '';
        }
    }

    const originalDocument = globalThis.document;
    globalThis.document = { createElement: () => new FakeOption() };
    try {
        const mapSelect = new FakeSelect();
        const mapFilterSelect = new FakeSelect([new FakeOption('all', 'Alle Groessen')]);
        const startSetup = {
            mapSearch: '',
            mapFilter: 'parcours',
            vehicleSearch: '',
            vehicleFilter: 'all',
            favoriteMaps: [],
            recentMaps: [],
            favoriteVehicles: [],
            recentVehicles: [],
            modeSelections: { normal: { mapKey: 'parcours_rift', vehicles: {} } },
        };
        const settings = {
            mapKey: 'parcours_rift',
            vehicles: {},
            localSettings: { modePath: 'normal', startSetup },
        };

        syncStartSetupSelectionState({
            ui: { mapSelect, mapFilterSelect },
            settings,
            startSetup,
            runtimeMaps: CONFIG.MAPS,
            surfaceMenuState: { mapKey: 'parcours_rift' },
            mapPreviewEntries: listMapPreviewEntries(),
            vehiclePreviewEntries: [],
            modePath: 'normal',
            hangarSelectionModePath: 'normal',
            surfacePolicyPort: { isMapAllowed: () => true },
            formatMapLabel: (entry) => entry.name,
            resolveSurfaceFallbackMapKey: () => 'standard',
            hasStoredCustomMap: () => false,
            ghostDuelState: {},
        });

        assert.equal(mapFilterSelect.options[0].textContent, 'Alle Karten');
        assert.deepEqual(mapFilterSelect.options.map((option) => option.value), ['all', 'parcours', 'glb']);
        assert.ok(mapSelect.options.length > 0);
        assert.equal(mapSelect.options.some((option) => option.value === 'tutorial_classic'), false);
        assert.equal(mapSelect.options.some((option) => option.value === 'die_festung'), false);
        assert.ok(mapSelect.options.every((option) => resolveMapPreview(option.value).hasParcours));
    } finally {
        globalThis.document = originalDocument;
    }
});
