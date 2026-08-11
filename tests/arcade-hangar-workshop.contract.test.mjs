import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    HangarBuildHistory,
    createDefaultHangarBuild,
    installHangarPart,
    normalizeHangarBuild,
    removeHangarPart,
} from '../src/ui/hangar/HangarBuildDraftState.js';
import {
    validateFightHangarBuild,
    validateFightHangarDrop,
} from '../src/ui/hangar/FightHangarValidation.js';
import {
    hangarBuildToProfileBonuses,
    hangarBuildToProfileUpgrades,
    validateHangarBuild,
    validateHangarDrop,
} from '../src/ui/hangar/HangarBuildValidation.js';
import {
    HANGAR_BUILD_STORAGE_KEYS,
    LEGACY_ARCADE_LOADOUT_STORAGE_KEY,
    createHangarBuildPersistenceAdapter,
    createSettingsRecordHangarCapability,
    readActiveHangarBuildFromStore,
} from '../src/ui/hangar/HangarBuildPersistence.js';
import { persistArcadeHangarVehicleSelection } from '../src/ui/hangar/HangarWindowSettingsSync.js';
import {
    HANGAR_CAPABILITY_IDS,
    HANGAR_USER_FLOW_DESCRIPTORS,
} from '../src/shared/contracts/HangarModeContract.js';
import {
    HANGAR_SELECTION_PLAYER_SLOTS,
    readHangarVehicleSelection,
    writeHangarVehicleSelection,
} from '../src/ui/hangar/HangarSelectionWritebackContract.js';
import { getSlotStatBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createHangarDraftPersistence } from '../src/ui/hangar/HangarDraftPersistence.js';
import {
    listHangarParts,
    registerPublishedHangarParts,
    resolveHangarPart,
    resolveHangarPartUnlockLevel,
    resolvePartLockReason,
} from '../src/ui/hangar/HangarPartCatalog.js';
import {
    normalizeHangarStoneInventory,
    purchaseHangarStone,
    resolveHangarStoneAvailability,
} from '../src/ui/hangar/HangarStoneInventory.js';
import { HANGAR_STARTER_BUILDS, createHangarStarterBuild } from '../src/ui/hangar/HangarStarterBuildCatalog.js';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';
import {
    createVehicleLabHangarPublication,
    upsertVehicleLabHangarPublication,
} from '../src/shared/contracts/VehicleLabHangarPublishContract.js';

const STONE_COLORS = ['blue', 'green', 'gold', 'cyan', 'violet'];

function install(build, partId, slotId, pair = false) {
    return installHangarPart(build, partId, slotId, { pair });
}

function createStore(seed = {}) {
    const records = new Map(Object.entries(seed));
    return {
        records,
        loadJsonRecord(key, fallback) { return records.has(key) ? structuredClone(records.get(key)) : fallback; },
        saveJsonRecord(key, value) { records.set(key, structuredClone(value)); return { success: true }; },
    };
}

function partShapeSignature(node) {
    return JSON.stringify(node.children.map((child) => ({
        geometry: child.geometry?.type,
        parameters: child.geometry?.parameters,
        position: child.position.toArray().map((value) => Number(value.toFixed(3))),
        rotation: child.rotation.toArray().slice(0, 3).map((value) => Number(value.toFixed(3))),
        scale: child.scale.toArray().map((value) => Number(value.toFixed(3))),
    })));
}

test('hangar mode descriptors expose the storage keys used by persistence', () => {
    assert.equal(HANGAR_USER_FLOW_DESCRIPTORS.arcade.persistenceKey, HANGAR_BUILD_STORAGE_KEYS.arcade);
    assert.equal(HANGAR_USER_FLOW_DESCRIPTORS.fight.persistenceKey, HANGAR_BUILD_STORAGE_KEYS.fight);
});

test('hangar stones fit every socket and reject locked or over-budget drafts', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 1 });
    const valid = validateHangarDrop(base, 'stone_violet_t1', 'wing_left', 30, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(valid.ok, true);
    assert.equal(valid.build.slots.wing_left, 'stone_violet_t1');

    for (const slotId of ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right']) {
        assert.equal(install(base, 'stone_violet_t1', slotId).ok, true, slotId);
    }
    const locked = validateHangarDrop(base, 'stone_blue_t2', 'core', 1, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(locked.ok, false);
    assert.ok(locked.errors.some((error) => ['level_locked', 'tier_locked'].includes(error.code)));

    let expensive = base;
    for (const [partId, slotId] of [
        ['stone_violet_t3', 'core'], ['stone_violet_t3', 'nose'], ['stone_violet_t3', 'wing_left'],
        ['stone_violet_t3', 'wing_right'], ['stone_violet_t3', 'engine_left'], ['stone_violet_t3', 'engine_right'],
    ]) expensive = install(expensive, partId, slotId).build;
    const budgetValidation = validateHangarBuild(expensive, 1);
    assert.ok(budgetValidation.errors.some((error) => error.code === 'editor_budget'));
    assert.ok(budgetValidation.errors.some((error) => ['level_locked', 'tier_locked'].includes(error.code)));
});

test('five stone colors have distinct properties across three levels', () => {
    assert.equal(listHangarParts().length, 15);
    for (const tier of ['T1', 'T2', 'T3']) {
        const stones = listHangarParts({ tier });
        assert.equal(stones.length, 5);
        assert.deepEqual(stones.map((stone) => stone.colorId), STONE_COLORS);
        assert.equal(new Set(stones.map((stone) => JSON.stringify({ stats: stone.stats, bonuses: stone.bonuses }))).size, 5);
    }
});

test('all stones share one form while their level is visible through size', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    const t1Nodes = STONE_COLORS.map((color) => assembly.createPreviewPartNode(resolveHangarPart(`stone_${color}_t1`)));
    assert.equal(new Set(t1Nodes.map(partShapeSignature)).size, 1);
    assert.ok(t1Nodes.every((node) => node.children.length === 1));
    assert.ok(t1Nodes.every((node) => node.children[0].geometry.type === 'OctahedronGeometry'));
    const sizes = ['T1', 'T2', 'T3'].map((tier) => {
        const node = assembly.createPreviewPartNode(resolveHangarPart(`stone_blue_${tier.toLowerCase()}`));
        return new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3()).length();
    });
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], sizes.join(' < '));
    assert.equal(new Set(STONE_COLORS.map((color) => resolveHangarPart(`stone_${color}_t1`).appearance.color)).size, 5);
    assembly.dispose();
});

test('color filters, properties and unlock levels stay explicit', () => {
    const speedParts = listHangarParts({ trait: 'speed' });
    assert.equal(speedParts.length, 3);
    assert.ok(speedParts.every((part) => part.trait === 'speed'));
    assert.equal(listHangarParts({ color: 'green' }).length, 3);
    assert.equal(resolveHangarPart('stone_blue_t1').appearance.variant, 'universal-stone');
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('stone_blue_t1')), 1);
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('stone_blue_t2')), 10);
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('stone_blue_t3')), 20);
    assert.equal(resolvePartLockReason(resolveHangarPart('stone_blue_t2'), 1).unlockLevel, 10);
});

test('level one starts with two stones per color and purchases use XRP', () => {
    const profile = { level: 1, xpBank: 0 };
    const inventory = normalizeHangarStoneInventory(profile);
    for (const color of STONE_COLORS) {
        assert.equal(inventory.counts[`stone_${color}_t1`], 2);
        assert.equal(inventory.counts[`stone_${color}_t2`], 0);
        assert.equal(inventory.counts[`stone_${color}_t3`], 0);
    }
    assert.equal(purchaseHangarStone(profile, 'stone_blue_t1').code, 'level_locked');
    const funded = { level: 5, xpBank: 150 };
    const purchase = purchaseHangarStone(funded, 'stone_blue_t1', 100);
    assert.equal(purchase.ok, true);
    assert.equal(purchase.profile.xpBank, 50);
    assert.equal(purchase.profile.hangarStoneInventory.counts.stone_blue_t1, 3);
    assert.equal(resolveHangarStoneAvailability(resolveHangarPart('stone_blue_t1'), purchase.profile, null).owned, 3);
    assert.equal(purchaseHangarStone({ level: 9, xpBank: 999 }, 'stone_blue_t2').code, 'level_locked');

    let overEquipped = createDefaultHangarBuild('ship5', { nowMs: 101 });
    overEquipped = install(overEquipped, 'stone_blue_t1', 'core').build;
    overEquipped = install(overEquipped, 'stone_blue_t1', 'wing_left').build;
    assert.ok(validateHangarBuild(overEquipped, 1, profile).errors.some((error) => error.code === 'stone_inventory'));
});

test('loaded vehicle models are normalized and mounted parts change the visible silhouette', async () => {
    const scene = new THREE.Group();
    const assembly = new HangarVehicleAssembly(scene);
    assembly.setVehicle('ship5');
    await assembly.vehicleNode._loadingPromise;
    assembly.setBuild({ slots: createDefaultHangarBuild('ship5', { nowMs: 2 }).slots });

    const vehicleBounds = new THREE.Box3().setFromObject(assembly.baseVehicleRoot);
    const vehicleSize = vehicleBounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(Math.max(vehicleSize.x, vehicleSize.y, vehicleSize.z) - 4.1) < 0.01);

    const partsBounds = new THREE.Box3().setFromObject(assembly.partsRoot);
    assert.ok(partsBounds.getSize(new THREE.Vector3()).length() > 1);

    const defaultCoreColors = new Set();
    assembly.partNodes.get('core').traverse((node) => {
        if (node.material?.color) defaultCoreColors.add(node.material.color.getHex());
    });
    const blueBuild = createDefaultHangarBuild('ship5', { nowMs: 3 });
    blueBuild.slots.core = 'stone_blue_t1';
    assembly.setBuild(blueBuild);
    const blueCoreColors = new Set();
    assembly.partNodes.get('core').traverse((node) => {
        if (node.material?.color) blueCoreColors.add(node.material.color.getHex());
    });
    assert.notDeepEqual([...blueCoreColors], [...defaultCoreColors]);
    const blueCoreMaterials = [];
    assembly.partNodes.get('core').traverse((node) => {
        if (node.material?.emissive) blueCoreMaterials.push(node.material);
    });
    assembly.setSelectedSlot('core');
    assert.ok(blueCoreMaterials.every((material) => material.emissiveIntensity === 0.85));
    assembly.setSelectedSlot('');
    assert.ok(blueCoreMaterials.every((material) => material.emissiveIntensity === material.userData.hangarBaseEmissiveIntensity));
    assembly.dispose();
});

test('starter builds provide four valid one-click loadouts', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 4 });
    const builds = HANGAR_STARTER_BUILDS.map((preset) => createHangarStarterBuild(base, preset.id, 1));
    assert.equal(builds.length, 4);
    assert.equal(new Set(builds.map((build) => JSON.stringify(build.slots))).size, 4);
    builds.forEach((build) => assert.equal(validateHangarBuild(build, 1).ok, true, build.name));
    const levelFiveTank = createHangarStarterBuild(base, 'tank', 5);
    assert.equal(levelFiveTank.slots.utility, 'stone_violet_t1');
    assert.equal(validateHangarBuild(levelFiveTank, 5, { level: 5 }).ok, true);
});

test('level-one alternatives visibly change the build and reach runtime bonuses', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 5 });
    const violetCore = validateHangarDrop(base, 'stone_violet_t1', 'core', 1, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(violetCore.ok, true);
    assert.equal(violetCore.build.slots.core, 'stone_violet_t1');

    let variant = install(violetCore.build, 'stone_blue_t1', 'wing_left', true).build;
    variant = install(variant, 'stone_cyan_t1', 'engine_left', true).build;
    const bonuses = hangarBuildToProfileBonuses(variant);
    assert.deepEqual(bonuses, { speedBonusPct: 7, turningBonusPct: 3, maxHpBonus: 0 });
    assert.deepEqual(getSlotStatBonuses({}, bonuses), bonuses);

    const strategy = new ArcadeModeStrategy();
    strategy.applyVehicleUpgrades(bonuses);
    assert.equal(strategy.getTurnRateMultiplier(), 1.03);
    assert.equal(strategy.getSpeedMultiplier(), 1.07);
});

test('hangar draft supports replacement, optional removal, required slots, symmetry and undo/redo', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 10 });
    const paired = install(base, 'stone_blue_t2', 'engine_left', true);
    assert.equal(paired.ok, true);
    assert.equal(paired.build.slots.engine_left, 'stone_blue_t2');
    assert.equal(paired.build.slots.engine_right, 'stone_blue_t2');

    const utility = install(paired.build, 'stone_violet_t1', 'utility');
    const removedUtility = removeHangarPart(utility.build, 'utility');
    assert.equal(removedUtility.ok, true);
    assert.equal(removedUtility.build.slots.utility, null);
    assert.equal(removeHangarPart(base, 'core').code, 'required_slot');

    const missingCore = removeHangarPart(base, 'core', { allowRequired: true }).build;
    assert.ok(validateHangarBuild(missingCore, 30).errors.some((error) => error.code === 'required_slot'));

    const history = new HangarBuildHistory(base);
    history.push(paired.build);
    assert.equal(history.undo().slots.engine_left, 'stone_cyan_t1');
    assert.equal(history.redo().slots.engine_left, 'stone_blue_t2');
});

test('hangar persistence saves, loads, activates, renames, duplicates, deletes and migrates legacy presets', async () => {
    const store = createStore();
    const adapter = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    const build = install(createDefaultHangarBuild('ship5', { nowMs: 20 }), 'stone_green_t2', 'wing_left', true).build;
    const saved = await adapter.saveBuild(build, { asNew: true, activate: true, name: 'Interceptor' });
    assert.equal(saved.ok, true);
    assert.equal(adapter.getActiveBuild('ship5').name, 'Interceptor');
    assert.equal(adapter.getBuild(saved.build.buildId).slots.wing_right, 'stone_green_t2');

    const renamed = await adapter.renameBuild(saved.build.buildId, 'Interceptor Mk II');
    assert.equal(renamed.build.name, 'Interceptor Mk II');
    const duplicate = await adapter.duplicateBuild(renamed.build, 'Interceptor Copy');
    assert.equal(duplicate.ok, true);
    assert.equal(adapter.listBuilds('ship5').length, 2);
    assert.equal((await adapter.deleteBuild(saved.build.buildId)).ok, true);
    assert.equal(adapter.getBuild(saved.build.buildId), null);

    const legacyStore = createStore({
        [LEGACY_ARCADE_LOADOUT_STORAGE_KEY]: {
            schemaVersion: 'arcade-vehicle-loadouts.v1',
            presets: [{ presetId: 'legacy-one', vehicleId: 'aircraft', name: 'Legacy', upgrades: { wing_left: 'T2' }, updatedAtMs: 50 }],
        },
    });
    const migrated = createHangarBuildPersistenceAdapter({ store: legacyStore, mode: 'arcade' });
    await migrated.hydrate();
    assert.equal(migrated.getBuild('legacy-one').slots.wing_left, 'stone_green_t1');
    assert.equal(legacyStore.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade).schemaVersion, 'hangar-build-store.v2');
});

test('failed hangar writes leave the local build snapshot unchanged', async () => {
    const store = createStore();
    const capability = createSettingsRecordHangarCapability({ store, mode: 'arcade' });
    let rejectWrites = false;
    const adapter = createHangarBuildPersistenceAdapter({
        mode: 'arcade',
        invokeCapability(capabilityId, payload) {
            if (rejectWrites && capabilityId !== HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT) {
                return { ok: false, code: 'persistence_rejected' };
            }
            return capability(capabilityId, payload);
        },
    });
    const saved = await adapter.saveBuild(createDefaultHangarBuild('ship5', { buildId: 'stable-build', nowMs: 40 }), { activate: true });
    assert.equal(saved.ok, true);
    const stableSnapshot = adapter.getSnapshot();
    assert.equal(readActiveHangarBuildFromStore({ store, mode: 'arcade', vehicleId: 'ship5' }).buildId, 'stable-build');

    rejectWrites = true;
    assert.equal((await adapter.saveBuild(createDefaultHangarBuild('ship5', { buildId: 'rejected-build', nowMs: 41 }), { asNew: true })).ok, false);
    assert.deepEqual(adapter.getSnapshot(), stableSnapshot);
    assert.equal((await adapter.renameBuild('stable-build', 'Rejected rename')).ok, false);
    assert.deepEqual(adapter.getSnapshot(), stableSnapshot);
    assert.equal((await adapter.deleteBuild('stable-build')).ok, false);
    assert.deepEqual(adapter.getSnapshot(), stableSnapshot);
});

test('hangar selection merges into the newest settings record before saving', () => {
    const localSettings = {
        audioVolume: 0.1,
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' },
        localSettings: { modePath: 'arcade', staleWindowValue: true },
    };
    const newestSettings = {
        audioVolume: 0.9,
        networkRegion: 'eu-central',
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'aircraft' },
        localSettings: { modePath: 'arcade', changedInMainWindow: true },
    };
    let persisted = null;
    const vehicleId = persistArcadeHangarVehicleSelection({
        settings: localSettings,
        vehicleId: 'drone',
        runtimeAccess: {
            loadSettings: () => structuredClone(newestSettings),
            saveSettings: (settings) => { persisted = structuredClone(settings); return { success: true }; },
        },
    });

    assert.equal(vehicleId, 'drone');
    assert.equal(persisted.vehicles.PLAYER_1, 'drone');
    assert.equal(persisted.audioVolume, 0.9);
    assert.equal(persisted.networkRegion, 'eu-central');
    assert.equal(persisted.localSettings.changedInMainWindow, true);
    assert.equal(localSettings.audioVolume, 0.9);
});

test('arcade and fight builds stay isolated while selection and bonuses reach the run contracts', async () => {
    const store = createStore();
    const arcade = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    const fight = createHangarBuildPersistenceAdapter({ store, mode: 'fight' });
    await arcade.saveBuild(createDefaultHangarBuild('ship5', { buildId: 'arcade-build', nowMs: 60 }), { activate: true });
    await fight.saveBuild({ ...createDefaultHangarBuild('ship5', { buildId: 'fight-build', nowMs: 61 }), mode: 'fight' }, { activate: true });
    assert.deepEqual(arcade.listBuilds().map((build) => build.buildId), ['arcade-build']);
    assert.deepEqual(fight.listBuilds().map((build) => build.buildId), ['fight-build']);
    assert.notDeepEqual(store.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade), store.records.get(HANGAR_BUILD_STORAGE_KEYS.fight));

    const settings = { localSettings: { modePath: 'arcade' }, vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' } };
    writeHangarVehicleSelection(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1, 'aircraft', 'ship5', { modePath: 'arcade' });
    assert.equal(readHangarVehicleSelection(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1, 'ship5', { modePath: 'arcade' }).value, 'aircraft');

    let runBuild = createDefaultHangarBuild('aircraft', { nowMs: 70 });
    for (const [partId, slotId] of [['stone_gold_t2', 'core'], ['stone_green_t2', 'wing_left'], ['stone_blue_t2', 'engine_left']]) {
        runBuild = install(runBuild, partId, slotId).build;
    }
    const bonuses = getSlotStatBonuses(hangarBuildToProfileUpgrades(runBuild));
    assert.deepEqual(bonuses, { turningBonusPct: 10, speedBonusPct: 8, maxHpBonus: 15 });
    const strategy = new ArcadeModeStrategy();
    strategy.applyVehicleUpgrades(bonuses);
    assert.equal(strategy.getTurnRateMultiplier(), 1.1);
    assert.equal(strategy.getSpeedMultiplier(), 1.08);
});

test('unsaved hangar drafts recover through the settings record port', () => {
    const store = createStore();
    const drafts = createHangarDraftPersistence({ store, mode: 'arcade' });
    const changed = install(createDefaultHangarBuild('ship5', { nowMs: 80 }), 'stone_blue_t2', 'nose').build;
    drafts.save(changed);
    assert.equal(drafts.load('ship5').slots.nose, 'stone_blue_t2');
    assert.equal(drafts.load('aircraft'), null);
    drafts.clear('ship5');
    assert.equal(drafts.load('ship5'), null);
});

test('preset metadata, sorting and capability-backed import/export stay versioned', async () => {
    const store = createStore();
    const adapter = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    const first = await adapter.saveBuild(createDefaultHangarBuild('ship5', { nowMs: 90, name: 'Zulu' }), { asNew: true, name: 'Zulu' });
    await adapter.updateMetadata(first.build.buildId, { favorite: true, tags: ['boss', 'fast', 'boss'] });
    const exported = adapter.exportBuilds('ship5');
    assert.equal(exported.builds[0].favorite, true);
    assert.deepEqual(exported.builds[0].tags, ['boss', 'fast']);
    assert.equal(adapter.listBuildsSorted('ship5', 'favorite')[0].buildId, first.build.buildId);

    const target = createHangarBuildPersistenceAdapter({ store: createStore(), mode: 'arcade' });
    const imported = await target.importBuilds(exported);
    assert.equal(imported.ok, true);
    assert.equal(imported.builds[0].tags[0], 'boss');
});

test('Vehicle Lab publications become validated Hangar catalog parts', () => {
    const publication = createVehicleLabHangarPublication({
        label: 'Test Ship',
        primaryColor: 0,
        parts: [
            { name: 'Hauptantrieb', role: 'engine_left', geo: 'cylinder', size: [1, 1, 2] },
            { name: 'Linker Flügel', role: 'wing_left', geo: 'box', size: [2, 0.2, 1] },
        ],
    }, { vehicleId: 'test_ship', publishedAtMs: 100 });
    assert.equal(publication.vehicleId, 'test_ship');
    assert.equal(publication.parts[0].family, 'engine');
    assert.equal(publication.parts[1].family, 'wing');
    assert.equal(publication.parts[0].appearance.color, 0);
    const record = upsertVehicleLabHangarPublication(null, publication);
    assert.equal(registerPublishedHangarParts(record), 2);
    const published = listHangarParts({ search: 'lab' });
    assert.equal(published.length, 2);
    const labStone = resolveHangarPart(publication.parts[0].id);
    assert.equal(labStone.kind, 'stone');
    assert.equal(labStone.family, 'stone');
    assert.equal(labStone.compatibleSlots.length, 7);
    assert.equal(labStone.appearance.variant, 'universal-stone');
    registerPublishedHangarParts(null);
});

test('normalizing a build without a slots map keeps optional slots empty', () => {
    // A partial record (legacy persistence, preset import) must not invent stones
    // for slots it never mentioned — utility is gated to level 5 and an invented
    // stone made every fresh level 1-4 build fail its own validation.
    const bare = normalizeHangarBuild({ vehicleId: 'ship5' });
    assert.equal(bare.slots.utility, null);
    assert.equal(bare.slots.core, 'stone_gold_t1');
    assert.equal(bare.slots.wing_left, 'stone_green_t1');
    assert.deepEqual(validateHangarBuild(bare, 1).errors, []);
    assert.equal(validateHangarBuild(bare, 1).ok, true);
});

test('legacy upgrade records still migrate into stone slots', () => {
    const migrated = normalizeHangarBuild({ vehicleId: 'ship5', upgrades: { core: 'T2', utility: 'T2' } });
    assert.equal(migrated.slots.core, 'stone_gold_t1');
    assert.equal(migrated.slots.utility, 'stone_violet_t1');
    const explicit = normalizeHangarBuild({ vehicleId: 'ship5', slots: { utility: 'stone_violet_t1' } });
    assert.equal(explicit.slots.utility, 'stone_violet_t1');
    assert.equal(explicit.slots.core, 'stone_gold_t1');
    const cleared = normalizeHangarBuild({ vehicleId: 'ship5', slots: { utility: null } });
    assert.equal(cleared.slots.utility, null);
});

test('fight validation reports the stats and limits the shared workshop surface renders', () => {
    // The workshop renderer draws budget bars from validation.stats/limits for both
    // modes; fight used to omit them and took the whole hangar window down on sync.
    const build = createDefaultHangarBuild('ship5', { mode: 'fight' });
    const validation = validateFightHangarBuild(build);
    assert.equal(validation.ok, true);
    for (const key of ['budgetUsed', 'massUsed', 'powerUsed', 'heatUsed', 'partCount']) {
        assert.equal(typeof validation.stats[key], 'number', `stats.${key} must be numeric`);
    }
    for (const key of ['editorBudget', 'massBudget', 'powerBudget', 'heatBudget']) {
        assert.ok(Number(validation.limits[key]) > 0, `limits.${key} must be a positive reference`);
    }
    assert.equal(validation.stats.partCount, 6);
    assert.ok(validation.stats.budgetUsed <= validation.limits.editorBudget);
    const dropped = validateFightHangarDrop(build, 'stone_blue_t2', 'nose', install);
    assert.equal(dropped.ok, true);
    assert.equal(typeof dropped.stats.budgetUsed, 'number');
    assert.equal(typeof dropped.limits.editorBudget, 'number');
});
