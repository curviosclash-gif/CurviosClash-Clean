import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getPlayerVehicleIds,
    getVehicleIds,
    isPlayerSelectableVehicleId,
} from '../src/entities/vehicle-registry.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
} from '../src/ui/arcade/VehicleManagerCatalog.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

// Only these built-in vehicles are offered to the player. The others stay in the
// registry because bots fly them and map presets place them as decoration jets.
const PLAYER_VEHICLE_IDS = [
    'ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor',
];
const BOT_AND_DECORATION_ONLY_IDS = [
    'aircraft', 'orb', 'ship2', 'ship3', 'ship4', 'ship6', 'ship7', 'ship8',
    'lab_eclipse_phantom', 'lab_valkyrie_gunship', 'lab_atlas_salvager',
    'lab_aegis_carrier', 'lab_leviathan_dreadnought',
];

test('player vehicle list holds exactly the kept built-in vehicles', () => {
    assert.deepEqual([...getPlayerVehicleIds()].sort(), [...PLAYER_VEHICLE_IDS].sort());
    for (const id of PLAYER_VEHICLE_IDS) assert.equal(isPlayerSelectableVehicleId(id), true, id);
    for (const id of BOT_AND_DECORATION_ONLY_IDS) assert.equal(isPlayerSelectableVehicleId(id), false, id);
    assert.equal(isPlayerSelectableVehicleId('does_not_exist'), false);
});

test('hidden vehicles stay registered for bots and map decoration', () => {
    const allIds = new Set(getVehicleIds());
    for (const id of BOT_AND_DECORATION_ONLY_IDS) assert.equal(allIds.has(id), true, id);
});

test('star cruiser is the default vehicle', () => {
    assert.equal(DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER.DEFAULT_VEHICLE_ID, 'ship5');
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    assert.equal(defaults.vehicles.PLAYER_1, 'ship5');
    assert.equal(isPlayerSelectableVehicleId(defaults.vehicles.PLAYER_2), true);
});

test('a saved hidden vehicle falls back to the star cruiser on load', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const saved = manager.createDefaultSettings();
    saved.vehicles = { PLAYER_1: 'aircraft', PLAYER_2: 'arrow' };
    saved.localSettings.fourPlayerPlanar = { ...saved.localSettings.fourPlayerPlanar, vehicleId: 'ship8' };
    // An old save still carries the third pilot's plane in the former three-player block.
    saved.localSettings.threePlayerSplit = { ...saved.localSettings.threePlayerSplit, vehicleId: 'orb' };
    const loaded = manager.sanitizeSettings(saved);
    assert.equal(loaded.vehicles.PLAYER_1, 'ship5');
    assert.equal(loaded.vehicles.PLAYER_2, 'arrow');
    assert.equal(loaded.vehicles.PLAYER_3, 'ship5');
    assert.equal(loaded.localSettings.fourPlayerPlanar.vehicleId, 'ship5');
    assert.equal(loaded.localSettings.threePlayerSplit.vehicleId, undefined);
});

test('a match never starts a human player in a hidden vehicle', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.vehicles = { PLAYER_1: 'ship2', PLAYER_2: 'drone' };
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.player.vehicles.PLAYER_1, 'ship5');
    assert.equal(runtimeConfig.player.vehicles.PLAYER_2, 'drone');
});

test('hangar catalog lists only player vehicles but still resolves hidden ones', () => {
    const listed = listVehicleManagerCatalogEntries().map((entry) => entry.vehicleId);
    assert.deepEqual([...listed].sort(), [...PLAYER_VEHICLE_IDS].sort());
    assert.equal(resolveVehicleManagerCatalogEntry('ship2').label, 'Heavy Fighter (Ship 2)');
});
