// ============================================
// arcade-vehicle-roles.contract.test.mjs - Paket 1 (Korrektur): feste Rollen der
// Werksschiffe, Arcade nur mit Werksschiffen, Rollen- und Levelbereich-Filter im
// Arcade-Hangar. Classic und der Fight-Hangar behalten ihre Einteilung.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    saveVehicleLabCatalog,
    upsertVehicleLabCatalogVehicle,
} from '../src/shared/contracts/VehicleLabConfigContract.js';

// A Vehicle Lab build lives in localStorage; the registry reads it on import.
const storedValues = new Map();
globalThis.localStorage = {
    getItem: (key) => (storedValues.has(key) ? storedValues.get(key) : null),
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
};
const labBuild = upsertVehicleLabCatalogVehicle(null, { label: 'Mein Flieger', parts: [{ name: 'Rumpf', geo: 'box', role: 'core' }] });
saveVehicleLabCatalog(labBuild.record);
const LAB_ID = labBuild.vehicle.id;

const {
    ARCADE_FACTORY_VEHICLE_IDS,
    isArcadeSelectableVehicleId,
    resolveArcadeVehicleBaseStats,
} = await import('../src/shared/contracts/ArcadeVehicleBalanceContract.js');
const { isPlayerSelectableVehicleId } = await import('../src/entities/vehicle-registry.js');
const {
    getVehicleManagerInteractionRules,
    listArcadeVehicleManagerCatalogEntries,
    listVehicleManagerCatalogEntries,
} = await import('../src/ui/arcade/VehicleManagerCatalog.js');
const { createVehicleManagerSelectionState } = await import('../src/ui/arcade/vehicle-manager/VehicleManagerSelectionState.js');
const { resolveVehicleClassLabel, resolveVehicleLevelLabel } = await import('../src/ui/arcade/vehicle-manager/VehicleManagerUiPrimitives.js');
const { resolveHangarVehicleFilterChipValues } = await import('../src/ui/hangar/HangarVehicleFilterChips.js');
const { mapHangarHitboxClass } = await import('../src/ui/hangar/HangarWorkshopProfileSupport.js');
const { validateHangarBuild } = await import('../src/ui/hangar/HangarBuildValidation.js');
const { createDefaultHangarBuild } = await import('../src/ui/hangar/HangarBuildDraftState.js');
const { createRuntimeConfigSnapshot } = await import('../src/core/RuntimeConfig.js');
const { SettingsManager } = await import('../src/core/SettingsManager.js');
const { createMemoryStoragePlatform } = await import('./helpers/settings-manager-contract-test-utils.mjs');

const FACTORY_ROLES = Object.freeze({
    ship5: 'allrounder',
    spaceship: 'tank',
    arrow: 'fighter',
    manta: 'tank',
    drone: 'fighter',
    ship1: 'fighter',
    ship9: 'fighter',
    lab_helix_interceptor: 'fighter',
});

test('Werksschiffe: feste, eingefrorene Liste in Tabellenreihenfolge', () => {
    assert.deepEqual([...ARCADE_FACTORY_VEHICLE_IDS], Object.keys(FACTORY_ROLES));
    assert.equal(Object.isFrozen(ARCADE_FACTORY_VEHICLE_IDS), true);
});

test('Rollen: jedes der acht Werksschiffe hat seine Rolle aus der Balance-Tabelle', () => {
    for (const [vehicleId, role] of Object.entries(FACTORY_ROLES)) {
        assert.equal(resolveArcadeVehicleBaseStats(vehicleId).role, role, vehicleId);
    }
});

test('isArcadeSelectableVehicleId gilt genau für die acht Werksschiffe', () => {
    for (const vehicleId of ARCADE_FACTORY_VEHICLE_IDS) assert.equal(isArcadeSelectableVehicleId(vehicleId), true, vehicleId);
    for (const vehicleId of [LAB_ID, 'aircraft', 'ship2', 'orb', '', null, undefined, 'MANTA ']) {
        assert.equal(isArcadeSelectableVehicleId(vehicleId), false, String(vehicleId));
    }
    assert.equal(isPlayerSelectableVehicleId(LAB_ID), true, 'Classic behält den Lab-Bau als wählbar');
});

test('Arcade-Katalog listet genau die Werksschiffe mit Rolle, Classic-Liste enthält weiter Lab-Bauten', () => {
    const arcade = listArcadeVehicleManagerCatalogEntries();
    assert.deepEqual(arcade.map((entry) => entry.vehicleId).sort(), [...ARCADE_FACTORY_VEHICLE_IDS].sort());
    for (const entry of arcade) {
        assert.equal(entry.rolle, FACTORY_ROLES[entry.vehicleId], entry.vehicleId);
        assert.equal('hitboxKlasse' in entry, false, `${entry.vehicleId}: keine alte Hitbox-Einteilung im Arcade-Katalog`);
    }
    const classic = listVehicleManagerCatalogEntries().map((entry) => entry.vehicleId);
    assert.ok(classic.includes(LAB_ID), 'Classic-Liste enthält den Lab-Bau');
    assert.ok(listVehicleManagerCatalogEntries().every((entry) => ['kompakt', 'standard', 'schwer'].includes(entry.hitboxKlasse)));
});

test('Arcade-Regeln: Rollen-Chips statt Hitbox-Chips; Standardregeln (Fight) unverändert', () => {
    const arcade = getVehicleManagerInteractionRules('arcade');
    assert.deepEqual(arcade.filterChips.rolle, ['fighter', 'allrounder', 'tank']);
    assert.equal('hitboxKlasse' in arcade.filterChips, false);
    assert.equal('levelBand' in arcade.filterChips, false);
    const fight = getVehicleManagerInteractionRules('fight');
    assert.deepEqual(fight.filterChips.hitboxKlasse, ['kompakt', 'standard', 'schwer']);
    assert.deepEqual(fight.filterChips.levelBand, ['rookie', 'mid', 'elite']);
    assert.deepEqual(getVehicleManagerInteractionRules(), fight);
});

test('Arcade-Suche findet die Rolle unter ihrem angezeigten Namen („Jäger“) und in Umschrift', () => {
    const selection = createVehicleManagerSelectionState({ settings: { vehicles: {}, localSettings: {} }, catalogEntries: listArcadeVehicleManagerCatalogEntries(), mode: 'arcade' });
    const fighters = ['arrow', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor'].sort();
    for (const term of ['Jäger', 'jäger', 'jaeger']) {
        selection.setSearchTerm(term);
        assert.deepEqual(selection.getVisibleEntries().map((entry) => entry.vehicleId).sort(), fighters, term);
    }
    selection.setSearchTerm('Tank');
    assert.deepEqual(selection.getVisibleEntries().map((entry) => entry.vehicleId).sort(), ['manta', 'spaceship']);
});

test('Arcade-Auswahl filtert nach Rolle und Levelbereich; gespeicherte Lab-ID fällt auf ship5 zurück', () => {
    const settings = { vehicles: { PLAYER_1: LAB_ID }, localSettings: {} };
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries: listArcadeVehicleManagerCatalogEntries(), mode: 'arcade' });
    assert.equal(selection.getSelectedVehicleId(), 'ship5');
    const profiles = { manta: { level: 7 }, spaceship: { level: 1 } };

    selection.setHitboxFilter('tank');
    assert.deepEqual(selection.getVisibleEntries(profiles).map((entry) => entry.vehicleId), ['spaceship', 'manta']);
    selection.setLevelFilter('6–10');
    assert.equal(selection.getLevelFilter(), '6–10');
    assert.deepEqual(selection.getVisibleEntries(profiles).map((entry) => entry.vehicleId), ['manta']);

    selection.setHitboxFilter('schwer');
    assert.equal(selection.getHitboxFilter(), 'all', 'alte Hitbox-Werte gelten in Arcade nicht');
    selection.setLevelFilter('elite');
    assert.equal(selection.getLevelFilter(), 'all', 'alte Levelnamen gelten in Arcade nicht');
    selection.setLevelFilter('6–9');
    assert.equal(selection.getLevelFilter(), 'all', 'nur echte Fünferbereiche');
});

test('Fight-Auswahl behält Hitbox- und Levelband-Filter samt eigener Speicherfelder', () => {
    const settings = { vehicles: { PLAYER_1: 'manta' }, localSettings: { startSetup: { vehicleFilterHitbox: 'schwer', vehicleFilterLevelBand: 'elite' } } };
    const selection = createVehicleManagerSelectionState({ settings, catalogEntries: listVehicleManagerCatalogEntries(), mode: 'fight' });
    assert.equal(selection.getHitboxFilter(), 'schwer');
    assert.equal(selection.getLevelFilter(), 'elite');
    const arcade = createVehicleManagerSelectionState({ settings, catalogEntries: listArcadeVehicleManagerCatalogEntries(), mode: 'arcade' });
    arcade.setHitboxFilter('tank');
    assert.equal(settings.localSettings.startSetup.vehicleFilterHitbox, 'schwer', 'Arcade überschreibt den Fight-Filter nicht');
    assert.equal(settings.localSettings.startSetup.vehicleFilterLevelBand, 'elite');
});

test('Anzeige: Rolle und Levelbereich in Arcade, alte Namen nur außerhalb', () => {
    const [manta] = listArcadeVehicleManagerCatalogEntries().filter((entry) => entry.vehicleId === 'manta');
    assert.equal(resolveVehicleClassLabel(manta), 'Tank');
    assert.equal(resolveVehicleClassLabel({ hitboxKlasse: 'schwer' }), 'Schwer');
    assert.equal(resolveVehicleLevelLabel(12, 'arcade'), 'Level 11–15');
    assert.equal(resolveVehicleLevelLabel(12, 'fight'), 'Mid');
});

test('Filter-Chips: Rollen und die belegten Levelbereiche in Arcade, alte Chips im Fight-Hangar', () => {
    const levels = { manta: 7, drone: 23 };
    const arcade = resolveHangarVehicleFilterChipValues({
        rules: getVehicleManagerInteractionRules('arcade'),
        mode: 'arcade',
        catalogEntries: listArcadeVehicleManagerCatalogEntries(),
        levelOf: (vehicleId) => levels[vehicleId] || 1,
    });
    assert.deepEqual(arcade.classChips, [
        { value: 'all', label: 'Alle Rollen' },
        { value: 'fighter', label: 'Jäger' },
        { value: 'allrounder', label: 'Allrounder' },
        { value: 'tank', label: 'Tank' },
    ]);
    assert.deepEqual(arcade.levelChips.map((chip) => chip.value), ['all', '1–5', '6–10', '21–25']);
    assert.equal(arcade.levelChips[1].label, 'Level 1–5');

    const fight = resolveHangarVehicleFilterChipValues({
        rules: getVehicleManagerInteractionRules('fight'),
        mode: 'fight',
        catalogEntries: listVehicleManagerCatalogEntries(),
        levelOf: () => 30,
    });
    assert.deepEqual(fight.classChips.map((chip) => chip.label), ['Alle Hitboxen', 'Kompakt', 'Standard', 'Schwer']);
    assert.deepEqual(fight.levelChips.map((chip) => chip.label), ['Alle Level', 'Rookie', 'Mid', 'Elite']);
});

test('Arcade-Werksschiffe bauen auf dem neutralen Standard-Chassis; Classic-Einträge behalten die alte Zuordnung', () => {
    for (const entry of listArcadeVehicleManagerCatalogEntries()) {
        assert.equal(mapHangarHitboxClass(entry), 'standard', entry.vehicleId);
        const validation = validateHangarBuild(createDefaultHangarBuild(entry.vehicleId, { hitboxClass: mapHangarHitboxClass(entry) }), 1);
        assert.equal(validation.ok, true, `${entry.vehicleId} ist ab Level 1 startbar`);
    }
    assert.equal(mapHangarHitboxClass({ hitboxKlasse: 'schwer' }), 'heavy');
    assert.equal(mapHangarHitboxClass({ hitboxKlasse: 'kompakt' }), 'compact');
});

test('Run-Start: Lab-ID fällt in Arcade auf ship5 zurück, Classic behält den Lab-Bau', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const arcade = manager.createDefaultSettings();
    arcade.vehicles = { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID };
    arcade.localSettings.modePath = 'arcade';
    const arcadeConfig = createRuntimeConfigSnapshot(arcade);
    assert.equal(arcadeConfig.player.vehicles.PLAYER_1, 'ship5');
    assert.equal(arcadeConfig.player.vehicles.PLAYER_2, 'ship5');

    arcade.vehicles = { PLAYER_1: 'manta', PLAYER_2: 'drone' };
    const factory = createRuntimeConfigSnapshot(arcade);
    assert.equal(factory.player.vehicles.PLAYER_1, 'manta');
    assert.equal(factory.player.vehicles.PLAYER_2, 'drone');

    const classic = manager.createDefaultSettings();
    classic.vehicles = { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID };
    classic.localSettings.modePath = 'normal';
    assert.equal(createRuntimeConfigSnapshot(classic).player.vehicles.PLAYER_1, LAB_ID);
    classic.localSettings.modePath = 'fight';
    assert.equal(createRuntimeConfigSnapshot(classic).player.vehicles.PLAYER_1, LAB_ID);
});
