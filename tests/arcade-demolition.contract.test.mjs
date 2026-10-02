import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEMOLITION_COMBAT_PROFILE,
    DEMOLITION_CORE_MAP_KEYS,
    DEMOLITION_MAP_PROFILES,
    DEMOLITION_RUN_TYPE,
    DEMOLITION_STORM_MAP_KEYS,
    calculateDemolitionMapScore,
    calculateDemolitionMapXp,
    createDemolitionMapPlan,
    isDemolitionConfig,
    resolveDemolitionMapTimeSeconds,
    resolveDemolitionMedal,
    resolveDemolitionReferenceScore,
} from '../src/shared/contracts/DemolitionContract.js';
import {
    ARCADE_RUN_KINDS,
    resolveArcadeInitialMapKey,
    resolveArcadeRunKind,
    resolveArcadeRuntimeKind,
} from '../src/shared/contracts/ArcadeRunTypeDispatchContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolveArcadeRunCombatProfile } from '../src/modes/ArcadeRunRulesOps.js';
import { resolveDedicatedArcadeMatchStart } from '../src/core/runtime/GameRuntimeArcadeRunDispatch.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { DemolitionRuntime } from '../src/core/arcade/DemolitionRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { createDemolitionPickupConfig } from '../src/modes/ArcadeDemolitionCombatOps.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { createArcadeVehicleProfile } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createArcadePlayerUpgradeBonusMap } from '../src/core/arcade/ArcadeRunVehicleRewardOps.js';
import {
    resolveDemolitionLocalPlayerCount,
    setupArcadeDemolitionProfileSelection,
} from '../src/ui/arcade/ArcadeDemolitionProfileSelection.js';
import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';
import { getDemolitionComboMultiplier } from '../src/core/arcade/DemolitionComboOps.js';
import { readFileSync } from 'node:fs';

test('demolition settings normalize to the dedicated hunt profile', () => {
    assert.deepEqual(
        { runType: normalizeArcadeRunSettings({ runType: ' DEMOLITION ' }).runType,
            combatProfile: normalizeArcadeRunSettings({ runType: 'demolition', combatProfile: 'classic' }).combatProfile },
        { runType: DEMOLITION_RUN_TYPE, combatProfile: DEMOLITION_COMBAT_PROFILE }
    );
    assert.equal(resolveArcadeRunCombatProfile('demolition', ''), 'hunt');
    assert.equal(isDemolitionConfig({ arcade: { enabled: true, runType: 'demolition' } }), true);
    assert.equal(isDemolitionConfig({ arcade: { enabled: false, runType: 'demolition' } }), false);
});

test('the shared dispatch preserves existing specialist run types', () => {
    const types = ['gauntlet', 'endless_parcours', 'five_portals', 'arena_waves', 'weapon_race', 'demolition'];
    for (const runType of types) {
        assert.equal(resolveArcadeRunKind(runType), runType);
    }
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: true, runType: 'demolition' } }), 'demolition');
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: true, runType: 'five_portals' } }), 'five_portals');
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: true, runType: 'arena_waves' } }), 'arena_waves');
    assert.equal(resolveArcadeRuntimeKind({
        arcade: { enabled: true, runType: 'weapon_race' },
        session: { mapKey: 'parcours_assault', sessionType: 'single' },
    }), 'weapon_race');
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: true, runType: 'endless_parcours' } }), 'endless_parcours');
    assert.equal(resolveArcadeRunKind('unknown'), ARCADE_RUN_KINDS.GAUNTLET);
});

test('the extracted start dispatch keeps existing map and bot profiles', () => {
    assert.deepEqual(resolveDedicatedArcadeMatchStart(
        { arcade: { enabled: true, runType: 'five_portals', portalChainId: 'five_portals' } },
        { phase: 'idle', mapIndex: 4 }
    ).profile, { mapKey: 'micro_maw', botCount: 0, fivePortals: true });
    assert.deepEqual(resolveDedicatedArcadeMatchStart(
        { arcade: { enabled: true, runType: 'arena_waves' } }
    ).profile, { mapKey: 'notre_dame_arena', botCount: 24, arenaWaves: true });
    assert.equal(resolveDedicatedArcadeMatchStart(
        { arcade: { enabled: true, runType: 'gauntlet' } }
    ).handled, false);
    const demolitionPlan = createDemolitionMapPlan(4711);
    assert.deepEqual(resolveDedicatedArcadeMatchStart(
        { arcade: { enabled: true, runType: 'demolition', seed: 4711 } },
        null,
        { phase: 'idle', mapIndex: 2 }
    ).profile, {
        mapKey: demolitionPlan.maps[0].mapKey,
        botCount: demolitionPlan.maps[0].botCount,
        combatProfile: 'hunt',
        demolition: true,
    });
});

test('preparing non-portal runs never reads five-portals player state', () => {
    for (const runType of ['arena_waves', 'weapon_race', 'endless_parcours', 'demolition', 'gauntlet']) {
        const runtimeState = {
            runtimeConfig: {
                arcade: { enabled: true, runType, seed: 4711 },
                bot: { activeDifficulty: 'normal' },
                player: { vehicles: { PLAYER_1: 'ship5' } },
                session: { mapKey: 'standard', numBots: 3 },
            },
        };
        const support = new GameRuntimeArcadeSupport({
            getRuntimeState: () => runtimeState,
            applySectorRuntimeProfile: () => {},
        });
        support.fivePortalsRuntime.getHudState = () => {
            throw new Error(`five-portals state read for ${runType}`);
        };
        support.arcadeRunRuntime.getStateSnapshot = () => ({ phase: 'active', sectorIndex: 1 });
        support.arcadeRunRuntime.getSectorRuntimeProfile = () => ({ mapKey: 'standard', botCount: 3 });
        assert.doesNotThrow(() => support.prepareMatchStartRuntime(), runType);
    }
});

test('preparing demolition applies its seeded initial map and defender count before session build', () => {
    const runtimeState = {
        runtimeConfig: {
            arcade: { enabled: true, runType: 'demolition', seed: 4711 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
            session: { mapKey: 'standard', numBots: 1 },
        },
    };
    const applied = [];
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        applySectorRuntimeProfile: (profile) => applied.push(profile),
    });
    const profile = support.prepareMatchStartRuntime();
    assert.deepEqual(applied, [profile]);
    assert.equal(profile.mapKey, createDemolitionMapPlan(4711).maps[0].mapKey);
    assert.equal(profile.botCount, createDemolitionMapPlan(4711).maps[0].botCount);
});

test('a seeded demolition plan contains three unique maps, at least two core maps and at most one storm map', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
        const first = createDemolitionMapPlan(seed);
        const second = createDemolitionMapPlan(seed);
        assert.deepEqual(second, first, `seed ${seed} is deterministic`);
        assert.equal(first.mapKeys.length, 3);
        assert.equal(new Set(first.mapKeys).size, 3);
        assert.ok(first.mapKeys.filter((key) => DEMOLITION_CORE_MAP_KEYS.includes(key)).length >= 2);
        assert.ok(first.mapKeys.filter((key) => DEMOLITION_STORM_MAP_KEYS.includes(key)).length <= 1);
    }
});

test('all six authored maps remain reachable across seeded plans', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 500; seed += 1) {
        for (const mapKey of createDemolitionMapPlan(seed).mapKeys) seen.add(mapKey);
    }
    assert.deepEqual([...seen].sort(), DEMOLITION_MAP_PROFILES.map((entry) => entry.mapKey).sort());
});

test('the Eiffel profile relies on its two authored tank units instead of spawning extra bots', () => {
    assert.equal(DEMOLITION_MAP_PROFILES.find((entry) => entry.mapKey === 'eiffel_tower_siege')?.botCount, 0);
});

test('map time limits follow 30 seconds plus timing HP divided by 30', () => {
    assert.equal(resolveDemolitionMapTimeSeconds('eiffel_tower_siege'), 82);
    assert.equal(resolveDemolitionMapTimeSeconds('reactor_site'), 115);
    assert.equal(resolveDemolitionMapTimeSeconds('skyline_siege'), 77);
    assert.equal(resolveDemolitionMapTimeSeconds('storm_dam_siege'), 77);
    assert.equal(resolveDemolitionMapTimeSeconds('storm_bridge_siege'), 52);
    assert.equal(resolveDemolitionMapTimeSeconds('storm_lighthouse_siege'), 47);
});

test('medal references use full direct HP, maximum breaks and the thirty-second timing buffer', () => {
    assert.deepEqual(
        Object.fromEntries(DEMOLITION_MAP_PROFILES.map((profile) => [
            profile.mapKey,
            resolveDemolitionReferenceScore(profile.mapKey),
        ])),
        {
            eiffel_tower_siege: 818,
            reactor_site: 1006,
            skyline_siege: 592,
            storm_dam_siege: 490,
            storm_bridge_siege: 415,
            storm_lighthouse_siege: 402,
        }
    );
    assert.equal(resolveDemolitionMedal('eiffel_tower_siege', 737), 'gold');
    assert.equal(resolveDemolitionMedal('eiffel_tower_siege', 736), 'silver');
    assert.equal(resolveDemolitionMedal('eiffel_tower_siege', 573), 'silver');
    assert.equal(resolveDemolitionMedal('eiffel_tower_siege', 409), 'bronze');
    assert.equal(resolveDemolitionMedal('eiffel_tower_siege', 408), '');
});

test('runtime config map selection uses the same seeded demolition plan', () => {
    for (const seed of [1, 4711, 20260928]) {
        assert.equal(resolveArcadeInitialMapKey({
            arcadeEnabled: true,
            arcade: { runType: 'demolition', seed },
            fallbackMapKey: 'standard',
        }), createDemolitionMapPlan(seed).mapKeys[0]);
    }
    assert.equal(resolveArcadeInitialMapKey({ arcadeEnabled: false, arcade: { runType: 'demolition' }, fallbackMapKey: 'maze' }), 'maze');
});

test('the runtime snapshot derives the demolition map from its effective seed', () => {
    const settings = createDefaultSettingsSnapshot();
    settings.localSettings.modePath = 'arcade';
    settings.arcade.runType = 'demolition';
    settings.arcade.seed = 4711;
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.arcade.runType, 'demolition');
    assert.equal(runtimeConfig.session.mapKey, createDemolitionMapPlan(runtimeConfig.arcade.seed).mapKeys[0]);
});

test('runtime config carries the three selected demolition profile IDs', () => {
    const settings = createDefaultSettingsSnapshot();
    settings.localSettings.modePath = 'arcade';
    settings.localSettings.startSetup.demolitionProfileIds = ['profile-a', 'profile-b', 'profile-c'];
    settings.arcade.runType = 'demolition';
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.deepEqual(runtimeConfig.arcade.demolitionProfileIds, ['profile-a', 'profile-b', 'profile-c']);
});

test('demolition profile selectors refresh on focus and preserve or report saved IDs', () => {
    const oldDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ value: '', textContent: '' }) };
    try {
        class Select {
            options = [];
            selected = '';

            get value() { return this.selected; }
            set value(value) { this.selected = this.options.some((option) => option.value === value) ? value : ''; }
            replaceChildren() { this.options = []; this.selected = ''; }
            appendChild(option) { this.options.push(option); return option; }
        }
        const selects = [new Select(), new Select(), new Select()];
        const profiles = [
            { id: 'uuid-current', displayName: 'Current' },
            { id: 'uuid-other', displayName: 'Other' },
        ];
        const settings = { mode: '3p', localSettings: { startSetup: { demolitionProfileIds: ['uuid-current', 'uuid-deleted', ''] } } };
        const listeners = new Map();
        const runtimeAccess = {
            getPlayerProfiles: () => profiles,
            getActivePlayerProfile: () => profiles[0],
            saveSettings: () => {},
        };
        const selection = setupArcadeDemolitionProfileSelection(
            { demolitionProfileSelects: selects }, runtimeAccess, settings,
            (select, event, handler) => listeners.set(`${selects.indexOf(select)}:${event}`, handler),
        );

        assert.equal(selects[0].value, 'uuid-current');
        assert.equal(selects[1].value, '');
        assert.equal(selects[1].options[0].textContent, 'Profil fehlt – neu zuordnen');
        profiles.push({ id: 'uuid-created-after-setup', displayName: 'Created after setup' });
        listeners.get('1:focus')();
        assert.ok(selects[1].options.some((option) => option.value === 'uuid-created-after-setup'));
        assert.equal(selects[1].options[0].textContent, 'Profil fehlt – neu zuordnen');

        selects[0].value = 'uuid-other';
        listeners.get('0:change')();
        assert.deepEqual(settings.localSettings.startSetup.demolitionProfileIds, ['uuid-other', 'uuid-deleted', '']);
        const startIds = selection.save();
        assert.deepEqual(startIds, ['uuid-other', '', '']);
        assert.equal(selection.hasMissingActiveProfile(startIds), true);
        selects[1].value = 'uuid-created-after-setup';
        listeners.get('1:change')();
        assert.equal(settings.localSettings.startSetup.demolitionProfileIds[1], 'uuid-created-after-setup');
        assert.deepEqual(settings.localSettings.startSetup.demolitionProfileIds, ['uuid-other', 'uuid-created-after-setup', '']);
        const reassignedIds = selection.save();
        assert.deepEqual(reassignedIds, ['uuid-other', 'uuid-created-after-setup', '']);
        assert.equal(selection.hasMissingActiveProfile(reassignedIds), true);
        profiles.splice(1, 1);
        listeners.get('0:focus')();
        assert.equal(selects[0].value, '');
        assert.equal(selects[0].options[0].textContent, 'Profil fehlt – neu zuordnen');
        assert.equal(settings.localSettings.startSetup.demolitionProfileIds[0], 'uuid-other');
    } finally {
        if (oldDocument === undefined) delete globalThis.document;
        else globalThis.document = oldDocument;
    }
});

test('demolition menu summary uses its own three-map instructions', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    assert.match(source, /demolitionSelected[\s\S]{0,250}Abrisskommando: drei Belagerungskarten/);
});

test('demolition start explicitly blocks four-player planar and missing profile assignments', () => {
    const fourPlayerSettings = {
        localSettings: { sessionType: 'splitscreen', splitScreenVariant: 'four_player_planar' },
    };
    assert.equal(resolveDemolitionLocalPlayerCount(fourPlayerSettings), 4);

    for (const profiles of [
        { hasUnsupportedPlayerCount: () => true, save: () => ['a', 'b', 'c'], hasMissingActiveProfile: () => false },
        { hasUnsupportedPlayerCount: () => false, save: () => ['a', '', 'c'], hasMissingActiveProfile: () => true },
    ]) {
        const button = {};
        const handlers = new Map();
        const toasts = [];
        let starts = 0;
        bindArcadeSpecialStartButtons(
            { startDemolitionButton: button },
            (node, _event, handler) => { if (node) handlers.set(node, handler); },
            () => { starts += 1; },
            1,
            profiles,
            { showStatusToast: (message) => toasts.push(message) },
        );
        handlers.get(button)();
        assert.equal(starts, 0);
        assert.equal(toasts.length, 1);
    }
});

test('score counts collapsed HP at half value and applies correct-order bonus once', () => {
    const score = calculateDemolitionMapScore({
        mapKey: 'reactor_site',
        remainingSeconds: 10.9,
        state: {
            segments: [
                { id: 'cooling_tower_w', maxHp: 500, destroyed: true, collapsed: false },
                { id: 'cooling_tower_e', maxHp: 500, destroyed: true, collapsed: false },
                { id: 'vent_stack', maxHp: 250, destroyed: true, collapsed: false },
                { id: 'turbine_hall', maxHp: 400, destroyed: true, collapsed: false },
                { id: 'reactor_dome', maxHp: 900, destroyed: true, collapsed: false },
            ],
            events: [
                { segmentId: 'cooling_tower_w' },
                { segmentId: 'cooling_tower_e' },
                { segmentId: 'vent_stack' },
                { segmentId: 'turbine_hall' },
                { segmentId: 'reactor_dome' },
            ],
        },
    });
    assert.deepEqual(score, {
        hpPoints: 255,
        breakPoints: 250,
        timePoints: 100,
        correctOrder: true,
        orderBonus: 151,
        total: 756,
    });
});

test('sealing the reactor first never earns the correct-order bonus', () => {
    const score = calculateDemolitionMapScore({
        mapKey: 'reactor_site',
        state: {
            segments: [
                { id: 'cooling_tower_w', maxHp: 500, destroyed: true, collapsed: true },
                { id: 'reactor_dome', maxHp: 900, destroyed: true, collapsed: false },
            ],
            events: [{ segmentId: 'reactor_dome' }],
        },
    });
    assert.equal(score.correctOrder, false);
    assert.equal(score.orderBonus, 0);
});

test('score counts damage on a standing segment without granting break points', () => {
    const score = calculateDemolitionMapScore({
        mapKey: 'skyline_siege',
        state: {
            segments: [{ id: 'tower_a', maxHp: 500, hp: 400, destroyed: false, collapsed: false }],
            events: [],
        },
    });
    assert.equal(score.hpPoints, 10);
    assert.equal(score.breakPoints, 0);
    assert.equal(score.total, 10);
});

test('XP uses map, break, unit and kill rewards with the existing x3 cap', () => {
    assert.equal(calculateDemolitionMapXp({ completed: true, breakEvents: 2, unitsDestroyed: 1, kills: 3 }), 145);
    assert.equal(calculateDemolitionMapXp({ completed: true, breakEvents: 2, unitsDestroyed: 1, kills: 3, multiplier: 9 }), 435);
});

test('demolition alone overrides heavy and mega rocket pickup weights', () => {
    const entityRuntimeConfig = { HUNT: HUNT_CONFIG };
    const demolitionConfig = createDemolitionPickupConfig(entityRuntimeConfig);
    const demolition = new ArcadeModeStrategy({
        runType: 'demolition',
        combatProfile: 'hunt',
        entityRuntimeConfig,
    });
    const arena = new ArcadeModeStrategy({
        runType: 'arena_waves',
        combatProfile: 'hunt',
        entityRuntimeConfig,
    });
    let demolitionDelegatedConfig = null;
    demolition._huntCombat.resolveSpawnType = (_types, config) => { demolitionDelegatedConfig = config; return 'ROCKET_HEAVY'; };
    let arenaDelegatedConfig = null;
    arena._huntCombat.resolveSpawnType = (_types, config) => { arenaDelegatedConfig = config; return 'ROCKET_HEAVY'; };
    demolition.resolveSpawnType(['ROCKET_HEAVY'], entityRuntimeConfig);
    arena.resolveSpawnType(['ROCKET_HEAVY'], entityRuntimeConfig);
    assert.equal(demolitionConfig.HUNT.ROCKET_TIERS.HEAVY.spawnChance, 0.36);
    assert.equal(demolitionConfig.HUNT.ROCKET_TIERS.MEGA.spawnChance, 0.08);
    assert.equal(demolition._runType, 'demolition');
    assert.equal(arena._runType, 'arena_waves');
    assert.equal(demolitionDelegatedConfig.HUNT.ROCKET_TIERS.HEAVY.spawnChance, 0.36);
    assert.equal(arenaDelegatedConfig, entityRuntimeConfig);
    assert.equal(HUNT_CONFIG.ROCKET_TIERS.HEAVY.spawnChance, 0.18);
    assert.equal(HUNT_CONFIG.ROCKET_TIERS.MEGA.spawnChance, 0.03);
});

function createRewardStore() {
    const data = new Map([[
        ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
        { ship1: createArcadeVehicleProfile('ship1', 0), ship2: createArcadeVehicleProfile('ship2', 0) },
    ]]);
    return {
        data,
        loadJsonRecord(key, fallback) { return data.has(key) ? structuredClone(data.get(key)) : fallback; },
        saveJsonRecord(key, value) { data.set(key, structuredClone(value)); return true; },
    };
}

function createDemolitionEntityManager(state) {
    const human = { index: 0, isBot: false, rocketInventory: ['ROCKET_MEGA'] };
    return {
        players: [human],
        humanPlayers: [human],
        _mapDestructibleSystem: {
            getState: () => state,
            getHudState: () => ({ focusSegment: null }),
            getDefinition: () => ({ segments: [] }),
        },
    };
}

test('the demolition runtime survives map rebuilds, equips rockets and settles score and XP once', () => {
    const store = createRewardStore();
    const transitions = [];
    let advances = 0;
    const runtime = new DemolitionRuntime({
        getRecordStore: () => store,
        getRecordStoreForPlayerIndex: () => store,
        requestMapTransition: (transition) => transitions.push(transition),
        requestAdvance: () => { advances += 1; },
    });
    const states = runtime.plan.maps.map(() => ({
        sealed: true,
        segments: [{ id: 'target', maxHp: 500, hp: 0, destroyed: true, collapsed: false }],
        events: [{ segmentId: 'target', kind: 'landmark' }],
    }));

    let entityManager = createDemolitionEntityManager(states[0]);
    runtime.start({ entityManager, seed: 4711, vehicleId: 'ship1', profileIds: ['profile-1'] });
    assert.deepEqual(entityManager.humanPlayers[0].rocketInventory, ['ROCKET_MEDIUM', 'ROCKET_MEDIUM']);
    runtime.handleGameplayEvent({ type: 'unit_destroyed', playerIndex: 0, count: 1 });
    runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, count: 1 });
    runtime.update(1);
    assert.equal(runtime.phase, 'transition');
    assert.equal(transitions.length, 1);
    assert.equal(advances, 1);

    for (let index = 1; index < runtime.plan.maps.length; index += 1) {
        entityManager = createDemolitionEntityManager(states[index]);
        runtime.start({ entityManager, vehicleId: 'ship2' });
        assert.equal(runtime.rewardBinding.vehicleId, 'ship1');
        assert.deepEqual(entityManager.humanPlayers[0].rocketInventory, ['ROCKET_MEDIUM', 'ROCKET_MEDIUM']);
        runtime.update(1);
    }

    const hud = runtime.getHudState();
    assert.equal(hud.phase, 'finished');
    assert.equal(hud.postRunSummary.maps.length, 3);
    assert.equal(hud.xpEarned, 225);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.totalXpEarned, 225);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship2.totalXpEarned, 0);
    assert.equal(transitions.length, 2);
    assert.equal(advances, 2);
});

test('timeouts preserve partial score and XP, skip map-complete XP and end after three maps', () => {
    const store = createRewardStore();
    const transitions = [];
    const runtime = new DemolitionRuntime({
        getRecordStoreForPlayerIndex: () => store,
        requestMapTransition: (transition) => transitions.push(transition),
    });
    for (let mapIndex = 0; mapIndex < 3; mapIndex += 1) {
        const state = { sealed: false, segments: [{ id: 'target', maxHp: 100, hp: 50, destroyed: false }], events: [] };
        const entityManager = createDemolitionEntityManager(state);
        runtime.start({ entityManager, seed: 4711, vehicleId: 'ship1', profileIds: ['profile-1'] });
        runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, count: 1 });
        runtime.update(1000);
        if (mapIndex < 2) {
            assert.equal(runtime.phase, 'transition');
            entityManager._mapDestructibleSystem.getState = () => ({ sealed: false, segments: [], events: [] });
            runtime.start({ entityManager, vehicleId: 'ship1', profileIds: ['profile-1'] });
        }
    }
    const hud = runtime.getHudState();
    assert.equal(hud.phase, 'finished');
    assert.equal(hud.postRunSummary.maps.length, 3);
    assert.ok(hud.postRunSummary.maps.every((map) => map.timedOut));
    assert.ok(hud.postRunSummary.maps.every((map) => map.score.total > 0));
    assert.equal(hud.xpEarned, 45);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.totalXpEarned, 45);
    assert.equal(transitions.length, 2);
});

test('demolition XP follows each player profile and vehicle with the shared combo cap', () => {
    const firstStore = createRewardStore();
    const secondStore = createRewardStore();
    const thirdStore = createRewardStore();
    const state = { sealed: false, segments: [{ id: 'target', maxHp: 100, hp: 100 }], events: [] };
    const entityManager = createDemolitionEntityManager(state);
    const second = { index: 1, isBot: false, vehicleId: 'ship1', rocketInventory: [] };
    const third = { index: 2, isBot: false, vehicleId: 'ship1', rocketInventory: [] };
    entityManager.players.push(second);
    entityManager.players.push(third);
    entityManager.humanPlayers.push(second);
    entityManager.humanPlayers.push(third);
    const runtime = new DemolitionRuntime({
        getMultiplier: () => 20,
        getRecordStoreForPlayerIndex: (_index, profileId) => ({
            'profile-a': firstStore, 'profile-b': secondStore, 'profile-c': thirdStore,
        })[profileId],
    });
    runtime.start({ entityManager, seed: 7, vehicleId: 'ship1', profileIds: ['profile-a', 'profile-b', 'profile-c'] });
    assert.deepEqual(entityManager.humanPlayers.map((player) => player.rocketInventory), [
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'], ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'], ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
    ]);
    runtime.handleGameplayEvent({ type: 'unit_destroyed', playerIndex: 1, count: 1 });
    const key = ARCADE_VEHICLE_PROFILE_STORAGE_KEY;
    assert.equal(firstStore.data.get(key).ship1.totalXpEarned, 0);
    assert.equal(secondStore.data.get(key).ship1.totalXpEarned, 90);
    assert.equal(runtime.getHudState().xpEarned, 90);
    state.sealed = true;
    state.events.push({ segmentId: 'target' });
    runtime.update(1);
    assert.equal(firstStore.data.get(key).ship1.totalXpEarned, 180);
    assert.equal(secondStore.data.get(key).ship1.totalXpEarned, 270);
    assert.equal(thirdStore.data.get(key).ship1.totalXpEarned, 180);
    const rebuilt = createDemolitionEntityManager({ sealed: false, segments: [], events: [] });
    const rebuiltPlayers = [
        { index: 1, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
        { index: 2, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
    ];
    rebuilt.players.push(...rebuiltPlayers);
    rebuilt.humanPlayers.push(...rebuiltPlayers);
    runtime.start({ entityManager: rebuilt, vehicleId: 'ship2', profileIds: ['profile-c', 'profile-c', 'profile-c'] });
    runtime.handleGameplayEvent({ type: 'unit_destroyed', playerIndex: 1, count: 1 });
    assert.equal(secondStore.data.get(key).ship1.totalXpEarned, 360);
    assert.equal(thirdStore.data.get(key).ship1.totalXpEarned, 180);
});

test('integrated demolition events grow the shared combo, cap XP at x3, reset on timeout transition, and keep stores separate', () => {
    let nowMs = 10_000;
    const profileIds = [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
    ];
    const stores = new Map(profileIds.map((id) => [id, createRewardStore()]));
    const playerProfileManager = {
        getProfiles: () => profileIds.map((id) => ({ id })),
        getRecordStorePort: (id) => stores.get(id) || null,
    };
    const players = profileIds.map((_, index) => ({
        index, isBot: false, vehicleId: 'ship1', rocketInventory: [],
    }));
    const makeEntityManager = (state) => ({
        players,
        humanPlayers: players,
        gameModeStrategy: { applyVehicleUpgrades() {} },
        _mapDestructibleSystem: {
            getState: () => state,
            getHudState: () => ({ focusSegment: null }),
            getDefinition: () => ({ segments: [] }),
        },
    });
    const firstMapState = {
        sealed: false,
        segments: [{ id: 'target', maxHp: 100, hp: 100, destroyed: false, collapsed: false }],
        events: [],
    };
    const runtimeConfig = {
        arcade: { enabled: true, runType: 'demolition', seed: 4711, demolitionProfileIds: profileIds },
        player: { vehicles: { PLAYER_1: 'ship1', PLAYER_2: 'ship1', PLAYER_3: 'ship1' } },
        session: { numHumans: 3 },
    };
    const runtimeState = { runtimeConfig, entityManager: makeEntityManager(firstMapState) };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        getGame: () => ({
            settingsManager: { getPlayerRecordStorePort: () => createRewardStore() },
            playerProfileManager,
        }),
        nowMs: () => nowMs,
    });
    support.arcadeRunRuntime.configure(runtimeConfig);
    support.startRunIfEnabled();

    const runtime = support.demolitionSupport.runtime;
    const emit = (type, playerIndex) => runtimeState.entityManager.onArcadeGameplayEvent({
        type, playerIndex, count: 1,
    });
    assert.deepEqual(players.map((player) => player.rocketInventory), [
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
    ]);
    emit('kill', 0);
    assert.equal(getDemolitionComboMultiplier(support.arcadeRunRuntime), 1);
    emit('kill', 1);
    assert.equal(getDemolitionComboMultiplier(support.arcadeRunRuntime), 2);
    emit('kill', 2);
    assert.equal(getDemolitionComboMultiplier(support.arcadeRunRuntime), 2);
    firstMapState.events.push({ segmentId: 'target-1' }, { segmentId: 'target-2' });
    runtime.update(0);
    assert.equal(getDemolitionComboMultiplier(support.arcadeRunRuntime), 3);

    const readXp = (profileId) => stores.get(profileId)
        .data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.totalXpEarned;
    const beforeTimeout = profileIds.map(readXp);
    assert.deepEqual(beforeTimeout, [75, 90, 90]);
    const firstCardTime = runtime.remainingSeconds;
    runtime.update(firstCardTime + 1);
    assert.equal(runtime.getHudState().mapStats[0].timedOut, true);
    assert.deepEqual(profileIds.map(readXp), beforeTimeout, 'timeout awards no map-completion XP');

    nowMs += 1000;
    const secondMapState = {
        sealed: false,
        segments: [{ id: 'target', maxHp: 100, hp: 100, destroyed: false, collapsed: false }],
        events: [],
    };
    runtimeState.entityManager = makeEntityManager(secondMapState);
    support.startRunIfEnabled();
    assert.equal(runtime.getHudState().mapIndex, 1);
    assert.equal(getDemolitionComboMultiplier(support.arcadeRunRuntime), 1, 'combo resets when map 2 is started');
    assert.deepEqual(runtimeState.entityManager.humanPlayers.map((player) => player.rocketInventory), [
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
        ['ROCKET_MEDIUM', 'ROCKET_MEDIUM'],
    ]);
});

test('demolition hangar bonuses remain distinct for players using the same vehicle ID', () => {
    const players = [
        { index: 0, isBot: false, vehicleId: 'ship1' },
        { index: 1, isBot: false, vehicleId: 'ship1' },
    ];
    const bonusMap = createArcadePlayerUpgradeBonusMap({
        0: { ship1: { vehicleId: 'ship1', hangarBonuses: { speedBonusPct: 8 } } },
        1: { ship1: { vehicleId: 'ship1', hangarBonuses: { speedBonusPct: 24 } } },
    }, players);
    assert.equal(bonusMap.byPlayerIndex[0].speedBonusPct, 8);
    assert.equal(bonusMap.byPlayerIndex[1].speedBonusPct, 24);
});
