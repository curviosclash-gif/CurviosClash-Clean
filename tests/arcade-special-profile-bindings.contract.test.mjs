import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ARCADE_COLORS_STORAGE_KEY, ARCADE_COLORS_SCHEMA_VERSION } from '../src/shared/contracts/ArcadeColorProgressContract.js';

import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { setEndlessRunProfile } from '../src/entities/endless/EndlessParcoursProgressionOps.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY, createArcadeVehicleProfileRecord } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { ARCADE_STONE_WORKSHOP_SCHEMA_VERSION, ARCADE_STONE_WORKSHOP_STORAGE_KEY } from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { saveVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { bindValidatedArcadeStartCapture, validateLocalArcadeProfileStart } from '../src/ui/arcade/ArcadeDemolitionProfileSelection.js';
import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';

const PROFILE_IDS = ['profile-one', 'profile-two', 'profile-three'];
const STONE_SLOTS = ['core', 'nose', 'wing_left'];

function createStore(index) {
    const records = new Map();
    const store = {
        records,
        loadJsonRecord(key, fallback = null) {
            return records.has(key) ? JSON.parse(records.get(key)) : fallback;
        },
        readJsonRecordResult(key) {
            return records.has(key)
                ? { ok: true, status: 'found', value: JSON.parse(records.get(key)), reason: 'ok' }
                : { ok: true, status: 'missing', value: null, reason: 'missing' };
        },
        saveJsonRecord(key, value) {
            records.set(key, JSON.stringify(value));
            return { success: true, reason: 'ok' };
        },
    };
    const profile = {
        ...createArcadeVehicleProfileRecord('ship5', 0),
        xpBank: 1_000_000,
        level: 30,
        level: 30,
        trailStyleId: ['ion', 'ember', 'violet'][index],
        stoneSlotPackages: index === 2 ? ['wings'] : [],
        upgrades: index === 0 ? { core: 'T2' } : index === 1 ? { nose: 'T2' } : { wing_left: 'T2' },
    };
    saveVehicleProfiles(store, { ship5: profile });
    store.saveJsonRecord(ARCADE_COLORS_STORAGE_KEY, { schemaVersion: ARCADE_COLORS_SCHEMA_VERSION, unlockedColorIds: ['standard', ['ion', 'ember', 'violet'][index]] });
    store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, {
        schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
        nextSerial: 2,
        stones: [{ stoneId: 'stone-0001', level: 1, placement: { vehicleId: 'ship5', slotId: STONE_SLOTS[index] } }],
        updatedAt: '2026-10-03T00:00:00.000Z',
    });
    return store;
}

function makeArcadeHarness(runType) {
    const stores = PROFILE_IDS.map((_, index) => createStore(index));
    const profileManager = {
        getProfiles: () => PROFILE_IDS.map((id) => ({ id })),
        getRecordStorePort: (id) => stores[PROFILE_IDS.indexOf(id)] || null,
    };
    const players = PROFILE_IDS.map((_, index) => ({
        index,
        isBot: false,
        vehicleId: 'ship5',
        alive: true,
        baseSpeed: 40,
        speed: 40,
        turnSpeed: 2,
        maxHp: 1,
        hp: 1,
    }));
    let appliedBonuses = null;
    const runtimeState = {
        runtimeConfig: {
            arcade: { enabled: true, runType, seed: 7, playerProfileIds: [...PROFILE_IDS], portalChainId: 'five_portals' },
            session: { sessionType: 'splitscreen', numHumans: 3 },
            player: { vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5', PLAYER_3: 'ship5' } },
        },
        entityManager: { players, humanPlayers: players, bots: [], gameModeStrategy: null },
    };
    const useStrategy = (strategy) => {
        const applyVehicleUpgrades = strategy.applyVehicleUpgrades.bind(strategy);
        strategy.applyVehicleUpgrades = (bonuses) => {
            appliedBonuses = bonuses;
            return applyVehicleUpgrades(bonuses);
        };
        runtimeState.entityManager.gameModeStrategy = strategy;
        return strategy;
    };
    useStrategy(new ArcadeModeStrategy({ runType }));
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        getGame: () => ({
            settingsManager: { getPlayerRecordStorePort: () => stores[0] },
            playerProfileManager: profileManager,
        }),
    });
    return { stores, players, profileManager, runtimeState, support, useStrategy, getAppliedBonuses: () => appliedBonuses };
}

test('special-mode start and session rebuild keep same-vehicle UUID pools frozen until next run', () => {
    const harness = makeArcadeHarness('five_portals');
    const { support, runtimeState, players, stores } = harness;

    support.startRunIfEnabled();
    assert.deepEqual(players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['ion', 'ember', 'violet']);
    assert.deepEqual([0, 1, 2].map((index) => harness.getAppliedBonuses().byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);

    runtimeState.runtimeConfig.arcade.playerProfileIds = ['next-one', 'next-two', 'next-three'];
    for (const store of stores) {
        store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, {
            schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
            nextSerial: 1,
            stones: [],
            updatedAt: '2026-10-03T00:00:00.000Z',
        });
    }
    harness.useStrategy(new ArcadeModeStrategy({ runType: 'five_portals' }));
    support.startRunIfEnabled();
    assert.deepEqual(players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['ion', 'ember', 'violet'],
        'active session rebuild keeps the start UUID binding');
    assert.deepEqual([0, 1, 2].map((index) => harness.getAppliedBonuses().byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ], 'active session rebuild keeps each player pool snapshot');

    support.resetRunState({ force: true });
    runtimeState.runtimeConfig.arcade.playerProfileIds = [...PROFILE_IDS].reverse();
    harness.useStrategy(new ArcadeModeStrategy({ runType: 'five_portals' }));
    support.startRunIfEnabled();
    assert.deepEqual(players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['violet', 'ember', 'ion'],
        'the following run loads its new UUID selection');
    assert.deepEqual([0, 1, 2].map((index) => harness.getAppliedBonuses().byPlayerIndex[index].build.stoneSteps), [
        { hull: 0, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 0, engines: 0, utility: 0 },
    ]);
});

test('arena waves uses the same player-specific binding through start and map-session rebuild', () => {
    const harness = makeArcadeHarness('arena_waves');
    harness.support.startRunIfEnabled();
    assert.deepEqual(harness.players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['ion', 'ember', 'violet']);
    assert.deepEqual([0, 1, 2].map((index) => harness.getAppliedBonuses().byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);

    harness.runtimeState.runtimeConfig.arcade.playerProfileIds = ['missing-one', 'missing-two', 'missing-three'];
    for (const store of harness.stores) {
        store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, {
            schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
            nextSerial: 1,
            stones: [],
            updatedAt: '2026-10-03T00:00:00.000Z',
        });
    }
    harness.useStrategy(new ArcadeModeStrategy({ runType: 'arena_waves' }));
    harness.support.startRunIfEnabled();
    assert.deepEqual(harness.players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['ion', 'ember', 'violet'],
        'the active arena run retains its selected profiles across session rebuild');
    assert.deepEqual([0, 1, 2].map((index) => harness.getAppliedBonuses().byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);
});

test('endless start forwards bound builds while keeping the shared reward store and run binding', () => {
    const harness = makeArcadeHarness('endless_parcours');
    const starts = [];
    const endless = {
        startProfile: null,
        _finalized: false,
        setRecordStore(store) { this.recordStore = store; },
        setRunProfile(options) {
            starts.push(options);
            this.startProfile = {};
            this._finalized = false;
        },
        getHudState() { return null; },
    };
    harness.runtimeState.endlessParcoursRuntime = endless;

    harness.support.startRunIfEnabled();
    assert.equal(starts[0].recordStore, harness.stores[0]);
    assert.deepEqual([0, 1, 2].map((index) => starts[0].playerBuildBonuses.byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ]);

    harness.runtimeState.runtimeConfig.arcade.playerProfileIds = ['missing-one', 'missing-two', 'missing-three'];
    for (const store of harness.stores) {
        store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, {
            schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
            nextSerial: 1,
            stones: [],
            updatedAt: '2026-10-03T00:00:00.000Z',
        });
    }
    harness.useStrategy(new ArcadeModeStrategy({ runType: 'endless_parcours' }));
    harness.support.startRunIfEnabled();
    assert.deepEqual([0, 1, 2].map((index) => starts[1].playerBuildBonuses.byPlayerIndex[index].build.stoneSteps), [
        { hull: 1, nose: 0, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 1, wings: 0, engines: 0, utility: 0 },
        { hull: 0, nose: 0, wings: 1, engines: 0, utility: 0 },
    ], 'active endless rebuild preserves its start pool snapshots');
    assert.equal(starts[1].recordStore, harness.stores[0], 'profile rebinding never replaces the shared Endless reward store');
});
test('weapon race keeps the selected profile cosmetic but never applies profile build bonuses', () => {
    const harness = makeArcadeHarness('weapon_race');
    harness.runtimeState.runtimeConfig.session = { sessionType: 'single', numHumans: 1, mapKey: 'parcours_assault' };
    harness.runtimeState.entityManager.players = [harness.players[0]];
    harness.runtimeState.entityManager.humanPlayers = [harness.players[0]];
    harness.support.startRunIfEnabled();
    assert.equal(harness.players[0].arcadeCosmeticLoadout.trailStyleId, 'ion');
    assert.equal(harness.getAppliedBonuses(), null, 'factory-size mode does not receive profile build overrides');
});

test('daily gauntlet stays neutral while profile bindings still drive cosmetics', () => {
    const harness = makeArcadeHarness('gauntlet');
    harness.runtimeState.runtimeConfig.arcade.dailyChallenge = true;
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });
    harness.useStrategy(strategy);
    harness.support.syncRuntimeConfig();
    harness.support.startRunIfEnabled();
    assert.deepEqual(harness.players.map((player) => player.arcadeCosmeticLoadout.trailStyleId), ['ion', 'ember', 'violet']);
    assert.ok(harness.players.every((player) => !strategy._upgradeBonusesFor(player).build));
});

test('Endless keeps shared rewards but resets spawn stats for every locally bound pilot', () => {
    const humans = [{ index: 0 }, { index: 1 }, { index: 2 }];
    const applied = [];
    const reset = [];
    const spawnStats = [];
    const recordStore = { loadJsonRecord: (_key, fallback) => fallback };
    const runtime = { _recordStore: null, entityManager: { humanPlayers: humans } };
    const playerBuildBonuses = { byPlayerIndex: { 0: { build: { marker: 1 } }, 1: { build: { marker: 2 } }, 2: { build: { marker: 3 } } } };

    const result = setEndlessRunProfile(runtime, {
        recordStore,
        vehicleId: 'ship5',
        strategy: {
            applyVehicleUpgrades: (bonuses) => applied.push(bonuses),
            resetPlayerHealth: (player) => reset.push(player),
            applySpawnStatBonuses: (player) => spawnStats.push(player),
        },
        playerBuildBonuses,
    });

    assert.equal(runtime._recordStore, recordStore, 'endless record/reward store remains the established shared run store');
    assert.equal(runtime.rewardBinding.vehicleId, 'ship5', 'the existing shared run vehicle reward binding is retained');
    assert.equal(result.vehicleId, 'ship5');
    assert.deepEqual(applied, [], 'per-player build map was already applied by the common profile cosmetics path; no P1 override');
    assert.deepEqual(reset, humans);
    assert.deepEqual(spawnStats, humans);
});

test('all special Arcade start closures validate player UUIDs before changing settings or dispatching', async () => {
    const source = await readFile(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    const startBody = source.match(/const startRunWithOwnMap = \(runType, borrowedSettings, portalChainId\) => \{([\s\S]*?)\n    \};/);
    assert.ok(startBody, 'special-mode start closure is present');
    const validation = startBody[1].indexOf("runType !== 'demolition' && !validateLocalArcadeProfileStart");
    const settingsMutation = startBody[1].indexOf('applySeedToSettings');
    const dispatch = startBody[1].indexOf('emit(eventTypes.START_MATCH');
    assert.ok(validation >= 0 && validation < settingsMutation && validation < dispatch,
        'special starts reject missing, duplicate, or unsupported profile selections before settings or dispatch change');
});

test('registered Arcade capture and daily callbacks block invalid starts before mutations or bubbling dispatch', async () => {
    const source = await readFile(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    const daily = source.match(/bindValidatedArcadeStartCapture\(bind, refs\.dailyButton,[\s\S]*?\n\s*\}\);/);
    const outer = source.match(/bindValidatedArcadeStartCapture\(bind, ui\.startButton,[\s\S]*?\n\s*\}\);/);
    assert.ok(daily, 'Daily uses the validated start callback');
    assert.match(daily[0], /playerCount: 1/);
    assert.ok(outer, 'the global start button uses its capture guard');
    assert.ok(outer[0].indexOf('validateLocalArcadeProfileStart') < outer[0].indexOf('releaseButtonOnlyArcadeRun'));

    const button = {};
    const listeners = [];
    const bind = (target, type, handler, capture = false) => {
        if (target === button && type === 'click') listeners.push({ handler, capture });
    };
    let valid = false;
    let persisted = 0;
    let settingsMutated = 0;
    let originalStartDispatches = 0;
    const profileSelection = {
        refreshForSoloStart: (count) => assert.equal(count, null),
        hasUnsupportedPlayerCount: () => false,
        readSelectedProfileIds: () => valid ? ['uuid-b', '', ''] : ['', '', ''],
        hasMissingActiveProfile: (ids) => !ids[0],
        hasDuplicateActiveProfiles: () => false,
        save: () => { persisted += 1; },
    };
    bind(button, 'click', () => { originalStartDispatches += 1; });
    bindValidatedArcadeStartCapture(
        bind, button, () => true,
        () => validateLocalArcadeProfileStart({}, profileSelection, null),
        () => { settingsMutated += 1; },
    );
    const dispatch = () => {
        let prevented = false;
        let immediateStopped = false;
        const event = {
            preventDefault() { prevented = true; },
            stopImmediatePropagation() { immediateStopped = true; },
        };
        for (const listener of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
            listener.handler(event);
            if (immediateStopped) break;
        }
        return { prevented, immediateStopped };
    };

    assert.deepEqual(dispatch(), { prevented: true, immediateStopped: true });
    assert.equal(persisted, 0, 'invalid UUID selection does not call saveSettings');
    assert.equal(settingsMutated, 0);
    assert.equal(originalStartDispatches, 0, 'capture stop prevents the existing global START_MATCH handler');

    valid = true;
    assert.deepEqual(dispatch(), { prevented: false, immediateStopped: false });
    assert.equal(persisted, 1);
    assert.equal(settingsMutated, 1);
    assert.equal(originalStartDispatches, 1);

    let dailyMutation = false;
    let dailyDispatches = 0;
    const dailyButton = {};
    const dailyListeners = [];
    const dailyBind = (target, type, handler, capture = false) => {
        if (target === dailyButton && type === 'click') dailyListeners.push({ handler, capture });
    };
    const dailySelection = {
        refreshForSoloStart: (count) => assert.equal(count, 1),
        hasUnsupportedPlayerCount: (count) => count > 3,
        readSelectedProfileIds: () => valid ? ['uuid-b', '', ''] : ['', '', ''],
        hasMissingActiveProfile: (ids) => !ids[0],
        hasDuplicateActiveProfiles: () => false,
        save: () => { persisted += 1; },
    };
    bindValidatedArcadeStartCapture(
        dailyBind, dailyButton, () => true,
        () => validateLocalArcadeProfileStart({}, dailySelection, null, { playerCount: 1 }),
        () => { dailyMutation = true; dailyDispatches += 1; },
    );
    valid = false;
    let dailyImmediateStopped = false;
    dailyListeners[0].handler({ preventDefault() {}, stopImmediatePropagation() { dailyImmediateStopped = true; } });
    assert.equal(dailyImmediateStopped, true);
    assert.equal(dailyMutation, false);
    assert.equal(dailyDispatches, 0, 'invalid Daily profile blocks its registered dispatch callback');
    valid = true;
    dailyListeners[0].handler({ preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(dailyMutation, true);
    assert.equal(dailyDispatches, 1);
});

test('forced-solo special start validates the active profile instead of split-screen slots', async () => {
    const source = await readFile(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    const start = source.match(/const startRunWithOwnMap = \(runType, borrowedSettings, portalChainId\) => \{([\s\S]*?)\n    \};/);
    assert.ok(start, 'special-mode callback exists');
    assert.match(start[1], /const playerCount = runType === 'weapon_race' \? 1 : null;/);
    assert.ok(start[1].indexOf('playerCount') < start[1].indexOf('validateLocalArcadeProfileStart'));
    const starts = await readFile(new URL('../src/ui/arcade/ArcadeMenuSpecialStartOps.js', import.meta.url), 'utf8');
    assert.match(starts, /bind\(refs\.startWeaponRaceButton, 'click', \(\) => startRunWithOwnMap\('weapon_race'/);
    assert.ok(start[1].indexOf('validateLocalArcadeProfileStart') < start[1].indexOf('applySeedToSettings'));

    let activeId = 'uuid-b';
    let saves = 0;
    const selection = {
        refreshForSoloStart: (count) => assert.equal(count, 1),
        hasUnsupportedPlayerCount: (count) => count > 3,
        readSelectedProfileIds: (count) => count === 1 ? [activeId, '', ''] : [activeId, activeId, 'uuid-c'],
        hasMissingActiveProfile: (ids, count) => ids.slice(0, count).some((id) => !id),
        hasDuplicateActiveProfiles: (ids, count) => new Set(ids.slice(0, count)).size !== count,
        save: () => { saves += 1; },
    };
    assert.equal(validateLocalArcadeProfileStart(
        { mode: '3p', localSettings: { threePlayerSplit: { enabled: true } } },
        selection, null, { playerCount: 1 },
    ), true, 'P2/P3 split assignments do not invalidate Weapon Race forced solo');
    assert.equal(saves, 1);
    activeId = '';
    assert.equal(validateLocalArcadeProfileStart({}, selection, null, { playerCount: 1 }), false);
    assert.equal(saves, 1, 'missing solo UUID blocks without persisting a failed start');

    activeId = 'uuid-b';
    const weaponButton = {};
    const weaponHandlers = [];
    let weaponStarts = 0;
    bindArcadeSpecialStartButtons(
        { startWeaponRaceButton: weaponButton },
        (target, _event, handler) => { if (target === weaponButton) weaponHandlers.push(handler); },
        (runType) => {
            const targetPlayerCount = runType === 'weapon_race' ? 1 : null;
            if (validateLocalArcadeProfileStart(
                { mode: '3p', localSettings: { threePlayerSplit: { enabled: true } } },
                selection, null, { playerCount: targetPlayerCount },
            )) weaponStarts += 1;
        },
        7, selection, null,
    );
    weaponHandlers[0]();
    assert.equal(weaponStarts, 1, 'registered Weapon Race callback validates its forced-solo target');
    activeId = '';
    weaponHandlers[0]();
    assert.equal(weaponStarts, 1);
});

test('canonical Arcade defaults keep independent local profile slots', async () => {
    const { createDefaultArcadeRunSettings, normalizeArcadeRunSettings } = await import('../src/shared/contracts/ArcadeRunSettingsContract.js');
    const first = createDefaultArcadeRunSettings();
    const second = createDefaultArcadeRunSettings();
    assert.deepEqual(first, normalizeArcadeRunSettings(null));
    for (const key of ['demolitionProfileIds', 'playerProfileIds']) {
        assert.deepEqual(first[key], ['', '', '']);
        assert.notStrictEqual(first[key], second[key]);
        assert.equal(Object.isFrozen(first[key]), true);
    }
});
