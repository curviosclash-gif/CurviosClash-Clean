import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    HangarBuildHistory,
    createDefaultHangarBuild,
    installHangarPart,
    removeHangarPart,
} from '../src/ui/hangar/HangarBuildDraftState.js';
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
} from '../src/ui/hangar/HangarBuildPersistence.js';
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
import { HANGAR_STARTER_BUILDS, createHangarStarterBuild } from '../src/ui/hangar/HangarStarterBuildCatalog.js';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';
import {
    createVehicleLabHangarPublication,
    upsertVehicleLabHangarPublication,
} from '../src/shared/contracts/VehicleLabHangarPublishContract.js';

const PART_FAMILIES = ['core', 'nose', 'wing', 'engine', 'utility'];
const EXPECTED_OPTIONS_BY_TIER = { T1: 2, T2: 3, T3: 4 };

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

test('hangar drops accept compatible parts and reject incompatible, locked and over-budget drafts', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 1 });
    const valid = validateHangarDrop(base, 'wing_t2', 'wing_left', 30, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(valid.ok, true);
    assert.equal(valid.build.slots.wing_left, 'wing_t2');

    const incompatible = validateHangarDrop(base, 'core_t2', 'wing_left', 30, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(incompatible.ok, false);
    assert.equal(incompatible.code, 'incompatible_slot');
    assert.deepEqual(incompatible.build.slots, base.slots);

    const lockedUtility = validateHangarDrop(base, 'utility_t1', 'utility', 1, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(lockedUtility.ok, false);
    assert.ok(lockedUtility.errors.some((error) => ['level_locked', 'slot_locked', 'part_family_locked'].includes(error.code)));

    let expensive = base;
    for (const [partId, slotId] of [
        ['core_t3', 'core'], ['nose_t3', 'nose'], ['wing_t3', 'wing_left'],
        ['wing_t3', 'wing_right'], ['engine_t3', 'engine_left'], ['engine_t3', 'engine_right'],
    ]) expensive = install(expensive, partId, slotId).build;
    const budgetValidation = validateHangarBuild(expensive, 1);
    assert.ok(budgetValidation.errors.some((error) => error.code === 'editor_budget'));
    assert.ok(budgetValidation.errors.some((error) => ['level_locked', 'tier_locked'].includes(error.code)));
});

test('each part family offers two T1, three T2 and four T3 choices with distinct properties', () => {
    for (const family of PART_FAMILIES) {
        for (const [tier, expectedCount] of Object.entries(EXPECTED_OPTIONS_BY_TIER)) {
            const parts = listHangarParts({ family, tier });
            assert.equal(parts.length, expectedCount, `${family} ${tier}`);
            assert.equal(new Set(parts.map((part) => JSON.stringify({
                costs: part.costs,
                stats: part.stats,
                bonuses: part.bonuses,
            }))).size, expectedCount, `${family} ${tier} properties`);
        }
    }
});

test('every selectable option and tier has a distinct 3D shape', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    for (const family of PART_FAMILIES) {
        for (const [tier, expectedCount] of Object.entries(EXPECTED_OPTIONS_BY_TIER)) {
            const signatures = listHangarParts({ family, tier })
                .map((part) => partShapeSignature(assembly._createPartNode(part)));
            assert.equal(new Set(signatures).size, expectedCount, `${family} ${tier} shapes`);
        }
    }
    for (const family of PART_FAMILIES) {
        const legacyParts = ['T1', 'T2', 'T3'].map((tier) => listHangarParts({ family, tier })[0]);
        assert.equal(new Set(legacyParts.map((part) => partShapeSignature(assembly._createPartNode(part)))).size, 3, `${family} tier shapes`);
    }
    assembly.dispose();
});

test('role filters, silhouettes and unlock levels stay explicit', () => {
    const speedParts = listHangarParts({ trait: 'speed' });
    assert.ok(speedParts.length > 0);
    assert.ok(speedParts.every((part) => part.trait === 'speed'));
    assert.equal(resolveHangarPart('core_t1').appearance.style, 'standard');
    assert.equal(resolveHangarPart('core_swift_t1').appearance.style, 'light');
    assert.equal(resolveHangarPart('core_reactor_t2').appearance.style, 'experimental');
    assert.equal(resolveHangarPart('core_bastion_t3').appearance.style, 'reinforced');
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('wing_t2')), 10);
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('engine_t2')), 15);
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('core_t2')), 20);
    assert.equal(resolveHangarPartUnlockLevel(resolveHangarPart('utility_t1')), 5);
    assert.equal(resolvePartLockReason(resolveHangarPart('core_t2'), 1).unlockLevel, 20);
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
    assert.ok(partsBounds.max.x > vehicleBounds.max.x + 0.1);

    const defaultCoreColors = new Set();
    assembly.partNodes.get('core').traverse((node) => {
        if (node.material?.color) defaultCoreColors.add(node.material.color.getHex());
    });
    const swiftBuild = createDefaultHangarBuild('ship5', { nowMs: 3 });
    swiftBuild.slots.core = 'core_swift_t1';
    assembly.setBuild(swiftBuild);
    const swiftCoreColors = new Set();
    assembly.partNodes.get('core').traverse((node) => {
        if (node.material?.color) swiftCoreColors.add(node.material.color.getHex());
    });
    assert.notDeepEqual([...swiftCoreColors], [...defaultCoreColors]);
    assembly.dispose();
});

test('starter builds provide four valid one-click loadouts', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 4 });
    const builds = HANGAR_STARTER_BUILDS.map((preset) => createHangarStarterBuild(base, preset.id, 1));
    assert.equal(builds.length, 4);
    assert.equal(new Set(builds.map((build) => JSON.stringify(build.slots))).size, 4);
    builds.forEach((build) => assert.equal(validateHangarBuild(build, 1).ok, true, build.name));
    const levelFiveTank = createHangarStarterBuild(base, 'tank', 5);
    assert.equal(levelFiveTank.slots.utility, 'utility_t1');
    assert.equal(validateHangarBuild(levelFiveTank, 5).ok, true);
});

test('level-one alternatives visibly change the build and reach runtime bonuses', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 5 });
    const swiftCore = validateHangarDrop(base, 'core_swift_t1', 'core', 1, (build, partId, slotId) => install(build, partId, slotId));
    assert.equal(swiftCore.ok, true);
    assert.equal(swiftCore.build.slots.core, 'core_swift_t1');

    let variant = install(swiftCore.build, 'wing_kestrel_t1', 'wing_left', true).build;
    variant = install(variant, 'engine_eco_t1', 'engine_left', true).build;
    const bonuses = hangarBuildToProfileBonuses(variant);
    assert.deepEqual(bonuses, { speedBonusPct: 3, turningBonusPct: 4, maxHpBonus: 0 });
    assert.deepEqual(getSlotStatBonuses({}, bonuses), bonuses);

    const strategy = new ArcadeModeStrategy();
    strategy.applyVehicleUpgrades(bonuses);
    assert.equal(strategy.getTurnRateMultiplier(), 1.04);
    assert.equal(strategy.getSpeedMultiplier(), 1.03);
});

test('hangar draft supports replacement, optional removal, required slots, symmetry and undo/redo', () => {
    const base = createDefaultHangarBuild('ship5', { nowMs: 10 });
    const paired = install(base, 'engine_t2', 'engine_left', true);
    assert.equal(paired.ok, true);
    assert.equal(paired.build.slots.engine_left, 'engine_t2');
    assert.equal(paired.build.slots.engine_right, 'engine_t2');

    const utility = install(paired.build, 'utility_t1', 'utility');
    const removedUtility = removeHangarPart(utility.build, 'utility');
    assert.equal(removedUtility.ok, true);
    assert.equal(removedUtility.build.slots.utility, null);
    assert.equal(removeHangarPart(base, 'core').code, 'required_slot');

    const missingCore = removeHangarPart(base, 'core', { allowRequired: true }).build;
    assert.ok(validateHangarBuild(missingCore, 30).errors.some((error) => error.code === 'required_slot'));

    const history = new HangarBuildHistory(base);
    history.push(paired.build);
    assert.equal(history.undo().slots.engine_left, 'engine_t1');
    assert.equal(history.redo().slots.engine_left, 'engine_t2');
});

test('hangar persistence saves, loads, activates, renames, duplicates, deletes and migrates legacy presets', async () => {
    const store = createStore();
    const adapter = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    const build = install(createDefaultHangarBuild('ship5', { nowMs: 20 }), 'wing_t2', 'wing_left', true).build;
    const saved = await adapter.saveBuild(build, { asNew: true, activate: true, name: 'Interceptor' });
    assert.equal(saved.ok, true);
    assert.equal(adapter.getActiveBuild('ship5').name, 'Interceptor');
    assert.equal(adapter.getBuild(saved.build.buildId).slots.wing_right, 'wing_t2');

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
    assert.equal(migrated.getBuild('legacy-one').slots.wing_left, 'wing_t2');
    assert.equal(legacyStore.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade).schemaVersion, 'hangar-build-store.v2');
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
    for (const [partId, slotId] of [['core_t2', 'core'], ['wing_t2', 'wing_left'], ['engine_t2', 'engine_left']]) {
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
    const changed = install(createDefaultHangarBuild('ship5', { nowMs: 80 }), 'nose_t2', 'nose').build;
    drafts.save(changed);
    assert.equal(drafts.load('ship5').slots.nose, 'nose_t2');
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
        primaryColor: 0x55aaff,
        parts: [
            { name: 'Main Engine', geo: 'cylinder', size: [1, 1, 2] },
            { name: 'Left Wing', geo: 'box', size: [2, 0.2, 1] },
        ],
    }, { vehicleId: 'test_ship', publishedAtMs: 100 });
    const record = upsertVehicleLabHangarPublication(null, publication);
    assert.equal(registerPublishedHangarParts(record), 2);
    const published = listHangarParts({ search: 'lab' });
    assert.equal(published.length, 2);
    assert.equal(resolveHangarPart(publication.parts[0].id).family, 'engine');
    registerPublishedHangarParts(null);
});
