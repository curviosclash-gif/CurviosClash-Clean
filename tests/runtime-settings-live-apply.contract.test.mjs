import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { LEADERBOARD_STORAGE_KEY } from '../src/state/arcade/ArcadeLeaderboard.js';
import { ARCADE_GHOST_LIBRARY_STORAGE_KEY } from '../src/state/arcade/ArcadeGhostLibrary.js';
import { assignSectorMissions } from '../src/state/arcade/ArcadeMissionState.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    getRuntimeMapCatalog,
    getRuntimeMapDefinition,
    registerMapCatalogConfigSource,
} from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { registerSessionMenuEventHandlers } from '../src/core/runtime/menu-handlers/SessionMenuEventHandlers.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { orchestrateRuntimeSettingsChanged } from '../src/core/runtime/RuntimeSettingsChangeOrchestrator.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createDefaultSettingsSnapshotForRuntime } from '../src/core/settings/SettingsDefaultsFacade.js';
import {
    createSettingsOverrideDraft,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { createSettingsPort } from '../src/shared/runtime/GameRuntimePorts.js';
import { MENU_CONTROLLER_EVENT_TYPES } from '../src/shared/contracts/MenuControllerContract.js';
import { SETTINGS_CHANGE_KEYS } from '../src/composition/core-ui/CoreUiMenuPorts.js';

function createEntityRuntimeConfigFixture(overrides = {}) {
    return {
        PLAYER: {
            SPEED: 21,
            TURN_SPEED: 2.4,
            ROLL_SPEED: 2.1,
            MODEL_SCALE: 1.05,
            ...(overrides.PLAYER || {}),
        },
        POWERUP: {
            TYPES: {
                BOOST: {},
                SHIELD: {},
            },
            ...(overrides.POWERUP || {}),
        },
        HUNT: {
            PLAYER_MAX_HP: 100,
            ...(overrides.HUNT || {}),
        },
        ...(overrides || {}),
    };
}

function createGhostClip(durationSeconds) {
    return {
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0 }] },
            { time: durationSeconds, players: [{ idx: 0, x: durationSeconds, y: 0, z: 0 }] },
        ],
        players: [{ idx: 0, color: 0xffffff }],
        sourceDuration: durationSeconds,
        displayDuration: durationSeconds,
    };
}

function createRecordStoreSettingsManager(recordStore) {
    return {
        getSettingsRecordStorePort() {
            return recordStore;
        },
    };
}

test('Session menu handler forwards LEVEL4_OPEN payload to facade', () => {
    const calls = [];
    const facade = {
        onSettingsChanged() {},
        handleSessionTypeChange() {},
        handleModePathChange() {},
        handleQuickStartLastStart() {},
        handleQuickStartEventPlaylistStart() {},
        handleQuickStartRandomStart() {},
        handleLevel3Reset() {},
        handleLevel4Open(event) {
            calls.push(event);
        },
        handleLevel4Close() {},
        handleLevel4Reset() {},
        handleConfigExportCode() {},
        handleConfigExportJson() {},
        handleConfigImport() {},
        startMatch() {},
    };
    const registry = new Map();
    const event = { sectionId: 'gameplay-combat' };

    registerSessionMenuEventHandlers(facade, registry);
    registry.get(MENU_CONTROLLER_EVENT_TYPES.LEVEL4_OPEN)?.(event);

    assert.deepEqual(calls, [event]);
});

test('EntityManager live runtime apply propagates updated config to runtime caches and players', () => {
    const previousErc = createEntityRuntimeConfigFixture({
        PLAYER: { SPEED: 12, TURN_SPEED: 1.5, ROLL_SPEED: 1.2, MODEL_SCALE: 0.9 },
        HUNT: { PLAYER_MAX_HP: 220 },
    });
    const nextErc = createEntityRuntimeConfigFixture({
        PLAYER: { SPEED: 33, TURN_SPEED: 2.8, ROLL_SPEED: 2.3, MODEL_SCALE: 1.2 },
        POWERUP: {
            TYPES: {
                BOOST: {},
                SHIELD: {},
                ROCKET_MEGA: {},
            },
        },
        HUNT: { PLAYER_MAX_HP: 100 },
    });
    const runtimeConfig = {
        gameplay: { fireRate: 0.7 },
        arcade: { ghostTrailCollisionEnabled: true },
    };

    const directRuntimeContext = {
        services: {
            entityRuntimeConfig: previousErc,
        },
    };
    const supportRuntimeContext = {
        services: {
            entityRuntimeConfig: previousErc,
        },
    };
    const projectileSystem = {
        entityRuntimeConfig: previousErc,
    };
    const powerupManager = {
        entityRuntimeConfig: previousErc,
        runtimeConfig: null,
        typeKeys: ['BOOST', 'SHIELD'],
    };
    const strategy = {
        entityRuntimeConfig: previousErc,
    };
    const arena = {
        entityRuntimeConfig: previousErc,
        runtimeConfig: null,
    };
    const controlOptionCalls = [];
    const players = [{
        entityRuntimeConfig: previousErc,
        maxHp: 190,
        hp: 145,
        setControlOptions(options) {
            controlOptionCalls.push(options);
        },
    }];

    const managerLike = {
        entityRuntimeConfig: previousErc,
        runtime: {
            context: directRuntimeContext,
            support: {
                runtimeContext: supportRuntimeContext,
            },
            systems: {
                projectileSystem,
            },
        },
        _runtimeContext: directRuntimeContext,
        _projectileSystem: projectileSystem,
        powerupManager,
        gameModeStrategy: strategy,
        arena,
        runtimeConfig: null,
        players,
        _lastRoundGhostSystem: {
            configured: null,
            configure(options) {
                this.configured = options;
            },
        },
    };

    EntityManager.prototype.applyLiveRuntimeConfig.call(managerLike, nextErc, runtimeConfig);

    assert.equal(managerLike.entityRuntimeConfig, nextErc);
    assert.equal(managerLike.runtimeConfig, runtimeConfig);
    assert.equal(managerLike._lastRoundGhostSystem.configured.entityManager, managerLike);
    assert.equal(managerLike._lastRoundGhostSystem.configured.ghostTrailCollisionEnabled, true);
    assert.equal(arena.entityRuntimeConfig, nextErc);
    assert.equal(arena.runtimeConfig, runtimeConfig);

    assert.equal(directRuntimeContext.services.entityRuntimeConfig, nextErc);
    assert.equal(supportRuntimeContext.services.entityRuntimeConfig, nextErc);
    assert.equal(projectileSystem.entityRuntimeConfig, nextErc);
    assert.equal(powerupManager.entityRuntimeConfig, nextErc);
    assert.equal(powerupManager.runtimeConfig, runtimeConfig);
    assert.deepEqual(powerupManager.typeKeys, ['BOOST', 'SHIELD', 'ROCKET_MEGA']);
    assert.equal(strategy.entityRuntimeConfig, nextErc);

    assert.equal(players[0].entityRuntimeConfig, nextErc);
    assert.deepEqual(controlOptionCalls, [{
        speed: 33,
        turnSpeed: 2.8,
        rollSpeed: 2.3,
        modelScale: 1.2,
    }]);
    assert.equal(players[0].gameplayConfig?.PLAYER, nextErc.PLAYER);
    assert.equal(players[0].maxHp, 100);
    assert.equal(players[0].hp, 100);
});

test('Pause auto-roll setting reaches the entity runtime config used by player motion', () => {
    const previousErc = createEntityRuntimeConfigFixture({
        PLAYER: { AUTO_ROLL: true },
    });
    const runtimeConfig = {
        player: {
            autoRoll: true,
        },
    };
    const liveApplyCalls = [];
    const entityManager = {
        entityRuntimeConfig: previousErc,
        applyLiveRuntimeConfig(entityRuntimeConfig, appliedRuntimeConfig) {
            liveApplyCalls.push({ entityRuntimeConfig, appliedRuntimeConfig });
        },
    };
    const game = {
        settings: { autoRoll: true },
        runtimeBundle: {
            state: {
                runtimeConfig,
                entityManager,
            },
        },
    };

    createSettingsPort(game).applyAutoRoll(false);

    assert.equal(game.settings.autoRoll, false);
    assert.equal(runtimeConfig.player.autoRoll, false);
    assert.equal(liveApplyCalls.length, 1);
    assert.equal(liveApplyCalls[0].entityRuntimeConfig.PLAYER.AUTO_ROLL, false);
    assert.equal(liveApplyCalls[0].appliedRuntimeConfig, runtimeConfig);
});

test('Settings override validation reports explicit limit-rule errors only once per path/code', () => {
    const draft = createSettingsOverrideDraft();
    draft.limitOverrides = {
        'baseSettings.gameplay.speed': {
            min: 0,
            max: 10,
            step: -1,
        },
    };
    draft.baseSettings.gameplay.speed = 15;

    const result = validateSettingsOverrideDraft(draft);
    assert.equal(result.valid, false);

    const duplicateKey = result.errors.filter((entry) => (
        entry.path === 'baseSettings.gameplay.speed'
        && entry.code === 'LIMIT_STEP_NON_POSITIVE'
    ));
    assert.equal(duplicateKey.length, 1);
    assert(result.errors.some((entry) => (
        entry.path === 'baseSettings.gameplay.speed'
        && entry.code === 'FIELD_NUMBER_ABOVE_MAX'
    )));
});

test('V95 Runtime-Integration: override baseSettings merges into defaults and limitOverrides clamp runtime values', () => {
    const previousCurviosApp = globalThis.curviosApp;
    const previousSettingsDefaultsContract = globalThis.settingsDefaultsContract;
    globalThis.curviosApp = {
        settingsDefaults: {
            getOverrideSnapshot: () => ({
                draft: {
                    schemaVersion: 'menu-defaults-override.v1',
                    baseSettings: { gameplay: { itemAmount: 5 } },
                    limitOverrides: {
                        'baseSettings.gameplay.itemAmount': {
                            min: 1,
                            max: 5,
                            step: 1,
                            integer: true,
                        },
                    },
                },
            }),
        },
    };
    globalThis.settingsDefaultsContract = globalThis.curviosApp.settingsDefaults;
    try {
        const defaults = createDefaultSettingsSnapshotForRuntime();
        assert.equal(defaults.gameplay.itemAmount, 5);
        assert.equal(defaults.__overrideSkipped, undefined);

        const snapshot = createRuntimeConfigSnapshot({ gameplay: { itemAmount: 12 } });
        assert.equal(snapshot.powerup.maxOnField, 5);
    } finally {
        if (previousCurviosApp === undefined) {
            delete globalThis.curviosApp;
        } else {
            globalThis.curviosApp = previousCurviosApp;
        }
        if (previousSettingsDefaultsContract === undefined) {
            delete globalThis.settingsDefaultsContract;
        } else {
            globalThis.settingsDefaultsContract = previousSettingsDefaultsContract;
        }
    }
});

test('V95 Runtime-Integration: missing curviosApp global leaves code-defaults untouched', () => {
    const previousCurviosApp = globalThis.curviosApp;
    const previousSettingsDefaultsContract = globalThis.settingsDefaultsContract;
    delete globalThis.curviosApp;
    delete globalThis.settingsDefaultsContract;
    try {
        const defaults = createDefaultSettingsSnapshotForRuntime();
        assert.equal(defaults.__overrideSkipped, undefined);
        assert.equal(typeof defaults.gameplay.itemAmount, 'number');
    } finally {
        if (previousCurviosApp !== undefined) {
            globalThis.curviosApp = previousCurviosApp;
        }
        if (previousSettingsDefaultsContract !== undefined) {
            globalThis.settingsDefaultsContract = previousSettingsDefaultsContract;
        }
    }
});

test('V96.7 Runtime config accepts settings defaults port without global lookup', () => {
    const previousSettingsDefaultsContract = globalThis.settingsDefaultsContract;
    delete globalThis.settingsDefaultsContract;
    try {
        const snapshot = createRuntimeConfigSnapshot(
            { gameplay: { itemAmount: 12 } },
            {
                settingsDefaultsPort: {
                    getOverrideSnapshot: () => ({
                        draft: {
                            schemaVersion: 'menu-defaults-override.v1',
                            limitOverrides: {
                                'baseSettings.gameplay.itemAmount': {
                                    min: 1,
                                    max: 4,
                                    step: 1,
                                    integer: true,
                                },
                            },
                        },
                    }),
                },
            }
        );

        assert.equal(snapshot.powerup.maxOnField, 4);
    } finally {
        if (previousSettingsDefaultsContract !== undefined) {
            globalThis.settingsDefaultsContract = previousSettingsDefaultsContract;
        }
    }
});

test('Arcade ghost duel mode stays enabled for all single mode paths', () => {
    const normalSnapshot = createRuntimeConfigSnapshot({
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
            startSetup: {
                arcadeGhostDuelMode: 'self_longest_ghost',
                arcadeGhostTrailCollisionEnabled: true,
            },
        },
    });
    assert.equal(normalSnapshot.arcade.ghostDuelMode, 'self_longest_ghost');
    assert.equal(normalSnapshot.arcade.ghostTrailCollisionEnabled, true);

    const fightSnapshot = createRuntimeConfigSnapshot({
        localSettings: {
            sessionType: 'single',
            modePath: 'fight',
            startSetup: {
                arcadeGhostDuelMode: 'self_longest_ghost',
                arcadeGhostTrailCollisionEnabled: true,
            },
        },
    });
    assert.equal(fightSnapshot.arcade.ghostDuelMode, 'self_longest_ghost');
    assert.equal(fightSnapshot.arcade.ghostTrailCollisionEnabled, true);

    const multiplayerSnapshot = createRuntimeConfigSnapshot({
        localSettings: {
            sessionType: 'multiplayer',
            modePath: 'arcade',
            startSetup: {
                arcadeGhostDuelMode: 'self_longest_ghost',
                arcadeGhostTrailCollisionEnabled: true,
            },
        },
    });
    assert.equal(multiplayerSnapshot.arcade.ghostDuelMode, 'off');
    assert.equal(multiplayerSnapshot.arcade.ghostTrailCollisionEnabled, false);

    const modeOffSnapshot = createRuntimeConfigSnapshot({
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
            startSetup: {
                arcadeGhostDuelMode: 'off',
                arcadeGhostTrailCollisionEnabled: true,
            },
        },
    });
    assert.equal(modeOffSnapshot.arcade.ghostTrailCollisionEnabled, false);

    const entityRuntimeConfig = createEntityRuntimeConfig(normalSnapshot);
    assert.equal(entityRuntimeConfig.TRAIL.GHOST_COLLISION_ENABLED, true);
});

test('Runtime settings orchestrator full-syncs when change keys are unknown', () => {
    const calls = [];
    const game = {
        settings: {},
        renderer: {},
        mediaRecorderSystem: {},
        uiManager: {
            clearStartValidationError() {
                calls.push(['clearStartValidationError']);
            },
            syncByChangeKeys(changedKeys) {
                calls.push(['syncByChangeKeys', changedKeys]);
            },
            syncAll() {
                calls.push(['syncAll']);
            },
            updateContext() {
                calls.push(['updateContext']);
            },
        },
        settingsManager: {
            applyMenuCompatibilityRules(_settings, options) {
                calls.push(['compatibility', options.changedKeys]);
                return { changedKeys: [SETTINGS_CHANGE_KEYS.MAP_KEY] };
            },
        },
        keybindEditorController: {
            renderEditor() {
                calls.push(['renderEditor']);
            },
        },
        _syncProfileControls() {
            calls.push(['syncProfileControls']);
        },
    };
    let dirtyState = null;
    let saveButtonUpdated = false;
    let prewarmScheduled = false;

    const changedKeys = orchestrateRuntimeSettingsChanged({
        game,
        event: {
            changedKeys: [
                SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
                'unknown.settings.key',
            ],
        },
        startValidationRelevantKeySet: new Set([SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED]),
        markSettingsDirty(isDirty) {
            dirtyState = isDirty;
        },
        updateSaveButtonState() {
            saveButtonUpdated = true;
        },
        scheduleMatchPrewarm() {
            prewarmScheduled = true;
        },
    });

    assert.equal(changedKeys, null);
    assert.equal(dirtyState, true);
    assert.equal(saveButtonUpdated, true);
    assert.equal(prewarmScheduled, true);
    assert.deepEqual(calls.find((entry) => entry[0] === 'compatibility')?.[1], [
        SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
    ]);
    assert.equal(calls.some((entry) => entry[0] === 'clearStartValidationError'), true);
    assert.equal(calls.some((entry) => entry[0] === 'syncAll'), true);
    assert.equal(calls.some((entry) => entry[0] === 'syncByChangeKeys'), false);
});

test('Arcade mission assignment uses active sector template id from encounter sequence', () => {
    registerMapCatalogConfigSource({
        MAPS: {
            standard: {
                name: 'Standard',
                size: [80, 30, 80],
                obstacles: [],
                portals: [],
            },
        },
    });
    try {
        const runtime = new ArcadeRunRuntime({ now: () => 1710000000000 });
        runtime._enabled = true;
        const runSeed = 1;
        const state = runtime.startRun({
            seed: runSeed,
            encounterPlan: {
                sequence: [
                    { templateId: 'sector_hazard' },
                ],
            },
        });

        const actualMissionTypes = Array.isArray(state?.missions?.missions)
            ? state.missions.missions.map((mission) => mission.type)
            : [];
        const expectedMissionTypes = assignSectorMissions(
            { id: 'sector_hazard' },
            null,
            `${runSeed}-${state?.runId || ''}`,
            0
        ).map((mission) => mission.type);

        assert.deepEqual(actualMissionTypes, expectedMissionTypes);
    } finally {
        registerMapCatalogConfigSource(null);
    }
});

test('Arcade mission assignment prefers map-specific mission pools when present', () => {
    registerMapCatalogConfigSource({
        MAPS: {
            standard: {
                name: 'Standard',
                size: [80, 30, 80],
                obstacles: [],
                portals: [],
                missions: [
                    { type: 'REACH_PORTAL', params: {}, weight: 1 },
                ],
            },
        },
    });
    try {
        const runtime = new ArcadeRunRuntime({ now: () => 1710000000123 });
        runtime._enabled = true;
        const runSeed = 7;
        const state = runtime.startRun({
            seed: runSeed,
            encounterPlan: {
                sequence: [
                    { templateId: 'sector_intro' },
                ],
            },
        });

        const actualMissionTypes = Array.isArray(state?.missions?.missions)
            ? state.missions.missions.map((mission) => mission.type)
            : [];
        const expectedMissionTypes = assignSectorMissions(
            { id: 'sector_intro' },
            [{ type: 'REACH_PORTAL', params: {}, weight: 1 }],
            `${runSeed}-${state?.runId || ''}`,
            0
        ).map((mission) => mission.type);

        assert.deepEqual(actualMissionTypes, expectedMissionTypes);
        assert.ok(actualMissionTypes.every((typeId) => typeId === 'REACH_PORTAL'));
    } finally {
        registerMapCatalogConfigSource(null);
    }
});

test('GameRuntimeArcadeSupport binds ghost seams outside arcade runs', () => {
    let boundGhostRecorder = null;
    let ghostPlaybackHandler = null;
    let playedGhostClip = null;
    const ghostRecorder = { sample() {} };
    const runtimeState = {
        runtimeConfig: { arcade: { enabled: false } },
        entityManager: {
            playLastRoundGhost(clip) {
                playedGhostClip = clip;
            },
            _parcoursProgressSystem: {
                setXpEventCallback() {},
                setLeaderboardCallback() {},
                setGhostRecorder(recorder) {
                    boundGhostRecorder = recorder;
                },
            },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getGame: () => ({ settingsManager: null }),
        getRuntimeState: () => runtimeState,
    });
    support.arcadeRunRuntime = {
        getGhostRecorder() {
            return ghostRecorder;
        },
        setGhostPlaybackHandler(handler) {
            ghostPlaybackHandler = handler;
        },
    };

    const runState = support.startRunIfEnabled();
    const ghostClip = { frames: [{ t: 0 }] };
    ghostPlaybackHandler(ghostClip);

    assert.equal(runState, null);
    assert.equal(boundGhostRecorder, ghostRecorder);
    assert.equal(playedGhostClip, ghostClip);
});

test('Arcade startRun seeds mission assignment from active run seed override', () => {
    const configSeed = 1;
    const runSeed = 3;
    const runtime = new ArcadeRunRuntime({ now: () => 1234567890 });
    runtime._enabled = true;
    runtime._config = { ...runtime._config, seed: configSeed };

    const state = runtime.startRun({
        seed: runSeed,
        encounterPlan: {
            sequence: [
                { templateId: 'sector_pressure' },
            ],
        },
    });

    const runId = String(state?.runId || runtime._state?.runId || '');
    const mapKey = String(state?.currentMapKey || 'standard');
    const mapDefinition = getRuntimeMapDefinition(mapKey, getRuntimeMapCatalog());
    const mapMissions = Array.isArray(mapDefinition?.missions) && mapDefinition.missions.length > 0
        ? mapDefinition.missions
        : null;
    const actualMissionTypes = Array.isArray(state?.missions?.missions)
        ? state.missions.missions.map((mission) => mission.type)
        : [];
    const expectedByRunSeed = assignSectorMissions({ id: 'sector_pressure' }, mapMissions, `${runSeed}-${runId}`, 0)
        .map((mission) => mission.type);
    const expectedByConfigSeed = assignSectorMissions({ id: 'sector_pressure' }, mapMissions, `${configSeed}-${runId}`, 0)
        .map((mission) => mission.type);

    assert.deepEqual(actualMissionTypes, expectedByRunSeed);
    assert.notDeepEqual(actualMissionTypes, expectedByConfigSeed);
});

test('Arcade resetRunState resets strategy transient state hooks', () => {
    const calls = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime.setStrategy({
        exitSuddenDeath() {
            calls.push('exit-sd');
        },
        setActiveModifier(value) {
            calls.push(['modifier', value]);
        },
        setSectorType(value) {
            calls.push(['sector', value]);
        },
        applyVehicleUpgrades(value) {
            calls.push(['upgrades', value]);
        },
    });
    calls.length = 0;

    runtime.resetRunState();

    assert.deepEqual(calls, [
        'exit-sd',
        ['modifier', null],
        ['sector', null],
        ['upgrades', null],
    ]);
});

test('Arcade deriveRoundEndPlan routes PARCOURS_COMPLETE through completeParcoursSector', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._state = { placeholder: true };

    const calls = [];
    runtime.completeParcoursSector = (parcoursResult = {}, options = {}) => {
        calls.push({ parcoursResult, options });
        return {
            outcome: {
                state: 'ROUND_END',
                reason: 'PARCOURS_COMPLETE',
                parcours: parcoursResult?.parcours || null,
                requiredWins: Math.max(1, Number(options?.winsNeeded) || 1),
            },
            transition: {
                nextState: 'ROUND_END',
                roundPause: 3,
            },
        };
    };

    const baseController = {
        defaultRoundPause: 3,
        deriveOnRoundEndPlan() {
            return null;
        },
    };
    const parcours = { completionTimeMs: 1234 };
    const plan = runtime.deriveRoundEndPlan({
        players: [],
        inputs: {
            reason: 'PARCOURS_COMPLETE',
            parcours,
            winsNeeded: 4,
        },
        baseController,
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].parcoursResult.parcours, parcours);
    assert.equal(calls[0].options.winsNeeded, 4);
    assert.equal(plan?.outcome?.reason, 'PARCOURS_COMPLETE');
    assert.equal(plan?.outcome?.requiredWins, 4);
    assert.deepEqual(plan?.outcome?.parcours, parcours);
});

test('Arcade parcours wrong-order event exposes red penalty HUD payload as one-shot', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._state = {};

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'wrong_order',
        penaltyMs: 2000,
        totalPenaltyMs: 4000,
    });

    assert.deepEqual(result, { penaltyMs: 2000, totalPenaltyMs: 4000 });
    const firstHudState = runtime.getHudState();
    assert.deepEqual(firstHudState?.parcoursPenalty, { penaltyMs: 2000, totalPenaltyMs: 4000 });
    const secondHudState = runtime.getHudState();
    assert.equal(secondHudState?.parcoursPenalty, null);
});

test('Arcade parcours leaderboard persists penaltyTimeMs separately from totalTimeMs', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._state = {};
    runtime._leaderboard = {};
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        playerIndex: 0,
        routeId: 'unit_route',
        totalTimeMs: 3210,
        penaltyTimeMs: 2000,
        segmentSplitsMs: [900, 1800, 2700],
        ghostClip: null,
    });

    assert.equal(result?.inserted, true);
    runtime.flushPersistenceSaves();
    const lastWrite = writes[writes.length - 1];
    assert.equal(lastWrite?.key, 'cuviosclash.parcours-leaderboard.v1');
    assert.equal(lastWrite?.value?.unit_route?.[0]?.totalTimeMs, 3210);
    assert.equal(lastWrite?.value?.unit_route?.[0]?.penaltyTimeMs, 2000);
});

test('V96.7 Arcade persistence scheduler buffers XP and leaderboard writes until flush', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({
        arcadePersistenceSaveThrottleMs: 1000,
        ghostLibrarySaveThrottleMs: 0,
    });
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });
    runtime._enabled = true;
    runtime._state = {};
    runtime._activeVehicleId = 'ship1';
    runtime._vehicleProfiles = {};
    runtime._leaderboard = {};

    const xpResult = runtime.applyParcoursXpEvent('checkpoint', 0);
    const leaderboardResult = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        playerIndex: 0,
        routeId: 'unit_route',
        totalTimeMs: 3210,
        penaltyTimeMs: 0,
        segmentSplitsMs: [900, 1800, 2700],
        ghostClip: null,
    });

    assert.equal(xpResult?.earned, 10);
    assert.equal(leaderboardResult?.inserted, true);
    assert.equal(writes.length, 0);

    runtime.flushPersistenceSaves();

    assert.equal(writes.length, 2);
    assert(writes.some((entry) => entry.key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY));
    assert(writes.some((entry) => entry.key === LEADERBOARD_STORAGE_KEY));
});

test('V96.7 Arcade run records are scheduled and flushed instead of written inline', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({
        arcadePersistenceSaveThrottleMs: 1000,
        ghostLibrarySaveThrottleMs: 0,
    });
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });
    runtime._state = {
        runId: 'run-record-buffered',
        completedSectors: 2,
        score: {
            total: 4321,
            multiplier: 2,
            peakMultiplier: 2,
            peakCombo: 7,
        },
        sectorHistory: [],
        rewardHistory: [],
    };

    const snapshot = runtime._finalizeRun(1710000000000);

    assert.equal(snapshot?.phase, 'finished');
    assert.equal(writes.length, 0);

    runtime.flushPersistenceSaves();

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.key, 'cuviosclash.arcade-run-profile.v1');
    assert.equal(writes[0]?.value?.runsPlayed, 1);
    assert.equal(writes[0]?.value?.lastScore, 4321);
});

test('Arcade run finalization marks persistence only after an acknowledged write', () => {
    const writes = [];
    let shouldReject = true;
    const runtime = new ArcadeRunRuntime({
        arcadePersistenceSaveThrottleMs: 0,
        ghostLibrarySaveThrottleMs: 0,
        logger: { log() {}, warn() {} },
    });
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
            return shouldReject ? { success: false, reason: 'quota' } : { success: true };
        },
    });
    runtime._state = {
        runId: 'run-record-retry',
        completedSectors: 1,
        score: { total: 1200, multiplier: 1, peakMultiplier: 1, peakCombo: 2 },
        sectorHistory: [],
        rewardHistory: [],
    };

    const rejected = runtime._finalizeRun(1710000000000);
    assert.equal(rejected?.phase, 'finished');
    assert.equal(rejected?.persistedAtIso, '');
    assert.equal(runtime.getRecordsSnapshot().runsPlayed, 1);

    shouldReject = false;
    const persisted = runtime._finalizeRun(1710000000001);
    assert.equal(persisted?.persistedAtIso, '2024-03-09T16:00:00.000Z');
    assert.equal(runtime.getRecordsSnapshot().runsPlayed, 1);
    assert.equal(writes.length, 2);
});

test('Arcade ghost_start replays only in self_longest_ghost mode and uses longest route ghost', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = {};
    const ghostClip = createGhostClip(3.4);
    runtime._ghostLibrary = {
        route_alpha: {
            routeId: 'route_alpha',
            longestGhostClip: ghostClip,
            durationMs: 3400,
            updatedAt: '2026-05-01T10:00:00.000Z',
        },
    };

    const playedClips = [];
    runtime.setGhostPlaybackHandler((clip) => {
        playedClips.push(clip);
    });

    const firstStart = runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_alpha',
    });
    assert.equal(firstStart?.started, true);
    assert.equal(playedClips.length, 1);
    assert.equal(playedClips[0]?.frames?.length, 2);

    const aliasStart = runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_unknown',
        routeAliases: ['map_unknown', 'route_alpha'],
    });
    assert.equal(aliasStart?.started, true);
    assert.equal(playedClips.length, 2);
    assert.equal(playedClips[1]?.frames?.length, 2);

    runtime._config.ghostDuelMode = 'off';
    const disabledStart = runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_alpha',
    });
    assert.equal(disabledStart?.reason, 'ghost_mode_disabled');
    assert.equal(playedClips.length, 2);
});

test('Arcade ghost_start ignores duplicate checkpoint-trigger playback for same route', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = {};
    const ghostClip = createGhostClip(3.4);
    runtime._ghostLibrary = {
        route_alpha: {
            routeId: 'route_alpha',
            longestGhostClip: ghostClip,
            durationMs: 3400,
            updatedAt: '2026-05-01T10:00:00.000Z',
        },
    };

    const playedClips = [];
    runtime.setGhostPlaybackHandler((clip) => {
        playedClips.push(clip);
    });

    runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_alpha',
        source: 'match_round_start',
    });
    assert.equal(playedClips.length, 1);

    const duplicateStart = runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_alpha',
        source: 'parcours_checkpoint_start',
    });
    assert.equal(duplicateStart?.reason, 'duplicate_checkpoint_start');
    assert.equal(playedClips.length, 1);

    runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'route_alpha',
        source: 'match_round_start',
    });
    assert.equal(playedClips.length, 2);
});

test('Ghost duel playback remains available for single non-arcade runs', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = null;
    runtime._ghostLibrary = {
        map_maze: {
            routeId: 'map_maze',
            longestGhostClip: createGhostClip(5.1),
            durationMs: 5100,
            updatedAt: '2026-05-01T10:00:00.000Z',
        },
    };

    const playedClips = [];
    runtime.setGhostPlaybackHandler((clip) => {
        playedClips.push(clip);
    });

    runtime.applyParcoursLeaderboardEvent({
        type: 'ghost_start',
        routeId: 'map_maze',
    });

    assert.equal(playedClips.length, 1);
    assert.equal(playedClips[0]?.sourceDuration, 5.1);
});

test('Ghost duel route aliases resolve playback across all runtime maps', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord() {},
    });
    const maps = getRuntimeMapCatalog();
    const mapEntries = Object.entries(maps || {});
    const clip = createGhostClip(4.2);

    for (let i = 0; i < mapEntries.length; i += 1) {
        const [mapKey, mapDefinition] = mapEntries[i];
        const routeId = String(mapDefinition?.parcours?.routeId || '').trim();
        const primaryRouteId = routeId || mapKey;
        const aliases = routeId ? [mapKey] : [];
        runtime.applyParcoursLeaderboardEvent({
            type: 'finish',
            routeId: primaryRouteId,
            routeAliases: aliases,
            totalTimeMs: 4200,
            penaltyTimeMs: 0,
            segmentSplitsMs: [],
            ghostClip: clip,
            persistLibraryOnly: true,
        });

        let playbackCount = 0;
        runtime.setGhostPlaybackHandler(() => {
            playbackCount += 1;
        });
        runtime.applyParcoursLeaderboardEvent({
            type: 'ghost_start',
            routeId: mapKey,
            routeAliases: routeId ? [routeId] : [],
        });
        assert.equal(
            playbackCount,
            1,
            `Ghost playback alias lookup failed for map "${mapKey}" (route "${primaryRouteId}")`
        );
    }
});

test('Ghost library can persist finish clips in non-arcade library-only mode', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'map_downtown',
        routeAliases: ['downtown_alias'],
        totalTimeMs: 6500,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: createGhostClip(6.5),
        persistLibraryOnly: true,
    });

    assert.equal(result?.inserted, false);
    assert.equal(result?.persistLibraryOnly, true);
    assert.deepEqual(result?.ghostRouteIds, ['map_downtown', 'downtown_alias']);
    assert.equal(result?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.map_downtown.durationMs, 6500);
    assert.equal(runtime._ghostLibrary.downtown_alias, undefined);

    const leaderboardWrites = writes.filter((entry) => entry.key === 'cuviosclash.parcours-leaderboard.v1');
    const ghostLibraryWrites = writes.filter((entry) => entry.key === ARCADE_GHOST_LIBRARY_STORAGE_KEY);
    assert.equal(leaderboardWrites.length, 0);
    assert.equal(ghostLibraryWrites.length, 1);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.map_downtown?.durationMs, 6500);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.downtown_alias, undefined);
    assert.equal(ghostLibraryWrites[0]?.value?.aliasIndex?.downtown_alias, 'map_downtown');
});

test('Ghost library keeps finish clips in memory when record store is unavailable', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime.settingsManager = null;

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_memory',
        totalTimeMs: 5400,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: createGhostClip(5.4),
        persistLibraryOnly: true,
    });

    assert.equal(result?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_memory.durationMs, 5400);
});

test('Ghost library budget in runtime evicts oldest routes by updatedAt during finish upsert', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = {
        ghostDuelMode: 'self_longest_ghost',
        ghostLibraryMaxRoutes: 2,
    };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {
        route_old_a: {
            routeId: 'route_old_a',
            longestGhostClip: createGhostClip(3),
            durationMs: 3000,
            updatedAt: '2026-05-01T10:00:00.000Z',
        },
        route_old_b: {
            routeId: 'route_old_b',
            longestGhostClip: createGhostClip(4),
            durationMs: 4000,
            updatedAt: '2026-05-01T10:01:00.000Z',
        },
    };
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_new',
        totalTimeMs: 5100,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: createGhostClip(5.1),
        persistLibraryOnly: true,
    });

    assert.equal(result?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_old_a, undefined);
    assert.equal(runtime._ghostLibrary.route_old_b.durationMs, 4000);
    assert.equal(runtime._ghostLibrary.route_new.durationMs, 5100);

    const ghostLibraryWrites = writes.filter((entry) => entry.key === ARCADE_GHOST_LIBRARY_STORAGE_KEY);
    assert.equal(ghostLibraryWrites.length, 1);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.route_old_a, undefined);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.route_old_b?.durationMs, 4000);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.route_new?.durationMs, 5100);
});

test('Ghost library runtime budget respects maxBytes and evicts oldest first', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = false;
    runtime._config = {
        ghostDuelMode: 'self_longest_ghost',
        ghostLibraryMaxRoutes: 10,
    };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {
        route_old_a: {
            routeId: 'route_old_a',
            longestGhostClip: createGhostClip(3),
            durationMs: 3000,
            updatedAt: '2026-05-01T10:00:00.000Z',
        },
        route_old_b: {
            routeId: 'route_old_b',
            longestGhostClip: createGhostClip(4),
            durationMs: 4000,
            updatedAt: '2026-05-01T10:01:00.000Z',
        },
    };
    const baseSize = JSON.stringify({
        schemaVersion: 'arcade-ghost-library.v2',
        lastTouchSeq: 0,
        aliasIndex: {},
        routes: runtime._ghostLibrary,
    }).length;
    runtime._config.ghostLibraryMaxBytes = baseSize;
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_new',
        totalTimeMs: 5100,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: createGhostClip(5.1),
        persistLibraryOnly: true,
    });

    assert.equal(result?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_new?.durationMs, 5100);
    assert.equal(runtime._ghostLibrary.route_old_a, undefined);

    const ghostLibraryWrites = writes.filter((entry) => entry.key === ARCADE_GHOST_LIBRARY_STORAGE_KEY);
    assert.equal(ghostLibraryWrites.length, 1);
    assert.equal(ghostLibraryWrites[0]?.value?.routes?.route_old_a, undefined);
    assert.ok(JSON.stringify(ghostLibraryWrites[0]?.value || {}).length <= baseSize);
});

test('Arcade finish keeps longest ghost duration independent from penalty-inflated total time', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = {};
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord() {},
    });

    const clip = createGhostClip(4.2);

    const result = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_penalty',
        totalTimeMs: 6200,
        penaltyTimeMs: 2000,
        ghostDurationMs: 4200,
        segmentSplitsMs: [1200, 2500, 4200],
        ghostClip: clip,
    });

    assert.equal(result?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_penalty.durationMs, 4200);
});

test('Arcade finish updates longest ghost library by durationMs and keeps shorter runs', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({
        arcadePersistenceSaveThrottleMs: 0,
        ghostLibrarySaveThrottleMs: 0,
    });
    runtime._enabled = true;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = {};
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime._activeVehicleId = 'ship5';
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    const clipLong = createGhostClip(4.8);
    const clipShort = createGhostClip(2.9);
    const clipLonger = createGhostClip(5.2);

    const first = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_alpha',
        totalTimeMs: 4800,
        penaltyTimeMs: 0,
        segmentSplitsMs: [1200, 2400, 3600],
        ghostClip: clipLong,
    });
    assert.equal(first?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_alpha.durationMs, 4800);

    const second = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_alpha',
        totalTimeMs: 2900,
        penaltyTimeMs: 0,
        segmentSplitsMs: [800, 1600, 2400],
        ghostClip: clipShort,
    });
    assert.equal(second?.longestGhostUpdated, false);
    assert.equal(second?.longestGhostReason, 'not_longer');
    assert.equal(runtime._ghostLibrary.route_alpha.durationMs, 4800);

    const third = runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_alpha',
        totalTimeMs: 5200,
        penaltyTimeMs: 0,
        segmentSplitsMs: [1300, 2600, 3900],
        ghostClip: clipLonger,
    });
    assert.equal(third?.longestGhostUpdated, true);
    assert.equal(runtime._ghostLibrary.route_alpha.durationMs, 5200);

    const ghostLibraryWrites = writes.filter((entry) => entry.key === ARCADE_GHOST_LIBRARY_STORAGE_KEY);
    assert.equal(ghostLibraryWrites.length, 2);
    assert.equal(ghostLibraryWrites[1]?.value?.routes?.route_alpha?.durationMs, 5200);
});

test('Ghost library save throttle flushes pending write on resetRunState shutdown path', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 1000 });
    runtime._enabled = false;
    runtime._config = { ghostDuelMode: 'self_longest_ghost' };
    runtime._state = null;
    runtime._leaderboard = {};
    runtime._ghostLibrary = {};
    runtime.settingsManager = createRecordStoreSettingsManager({
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_shutdown_flush',
        totalTimeMs: 3600,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: createGhostClip(3.6),
        persistLibraryOnly: true,
    });

    assert.equal(writes.length, 0);
    runtime.resetRunState({ preserveRecords: true });
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.key, ARCADE_GHOST_LIBRARY_STORAGE_KEY);
});

test('Arcade resetRunState clears active ghost recorder state', () => {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    const recorder = runtime.getGhostRecorder();

    assert.equal(recorder.startRecording(0, 1000, {
        routeId: 'route_reset',
        color: 0xffffff,
        modelScale: 1,
        isBot: false,
    }), true);
    recorder.sample({
        index: 0,
        isBot: false,
        alive: true,
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        color: 0xffffff,
        modelScale: 1,
    }, 1000);
    recorder.sample({
        index: 0,
        isBot: false,
        alive: true,
        position: { x: 1, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        color: 0xffffff,
        modelScale: 1,
    }, 1050);

    runtime.resetRunState({ preserveRecords: true });

    assert.equal(recorder.isRecording, false);
    assert.deepEqual(recorder.getDebugSnapshot(), {
        routeId: '',
        ownerIdx: null,
        frameCount: 0,
        sourceDuration: 0,
        sampleIntervalMs: 50,
        active: false,
    });
});

test('Runtime debug snapshot exposes ghost library telemetry counters', () => {
    const writes = [];
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime.settingsManager = createRecordStoreSettingsManager({
        loadJsonRecord(key, fallbackValue = null) {
            if (key === ARCADE_GHOST_LIBRARY_STORAGE_KEY) {
                return {
                    route_old: {
                        durationMs: 4200,
                        longestGhostClip: createGhostClip(4.2),
                    },
                };
            }
            return fallbackValue;
        },
        saveJsonRecord(key, value) {
            writes.push({ key, value });
        },
    });

    runtime.configure({
        arcade: {
            enabled: false,
            ghostDuelMode: 'self_longest_ghost',
            ghostLibraryMaxRoutes: 1,
            ghostLibraryMaxFramesPerRoute: 2,
        },
    });

    runtime.applyParcoursLeaderboardEvent({
        type: 'finish',
        routeId: 'route_new',
        totalTimeMs: 5300,
        penaltyTimeMs: 0,
        segmentSplitsMs: [],
        ghostClip: {
            frames: [
                { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0 }] },
                { time: 1, players: [{ idx: 0, x: 1, y: 0, z: 0 }] },
                { time: 2, players: [{ idx: 0, x: 2, y: 0, z: 0 }] },
                { time: 3, players: [{ idx: 0, x: 3, y: 0, z: 0 }] },
            ],
            players: [{ idx: 0, color: 0xffffff }],
            sourceDuration: 3,
            displayDuration: 3,
        },
        persistLibraryOnly: true,
    });

    const debugSnapshot = runtime.getDebugSnapshot();
    assert.equal(typeof debugSnapshot?.ghostLibrary?.counters?.evictedRoutes, 'number');
    assert.equal(typeof debugSnapshot?.ghostLibrary?.counters?.trimmedFrames, 'number');
    assert.equal(typeof debugSnapshot?.ghostLibrary?.counters?.migrationWrites, 'number');
    assert.equal(typeof debugSnapshot?.ghostLibrary?.counters?.droppedByByteBudget, 'number');
    assert.ok(debugSnapshot?.ghostLibrary?.counters?.migrationWrites >= 1);
    assert.ok(debugSnapshot?.ghostLibrary?.counters?.trimmedFrames >= 1);
    assert.ok(debugSnapshot?.ghostLibrary?.counters?.evictedRoutes >= 1);
    assert.equal(debugSnapshot?.ghostLibrary?.pendingSave, false);
    assert.ok(writes.length >= 2);
});
