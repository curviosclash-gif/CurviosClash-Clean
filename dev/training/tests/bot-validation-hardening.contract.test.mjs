import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    getBotValidationMatrix,
    selectBotValidationScenarios,
} from '../src/state/validation/BotValidationMatrix.js';
import {
    BotValidationService,
    buildBotValidationRuntimeVerification,
} from '../src/state/validation/BotValidationService.js';
import { buildBotValidationOutcomeSemantics } from '../src/state/validation/BotValidationOutcomeSemantics.js';
import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import {
    captureBotRuntimeSample,
    isTeamObjectiveFirstTickScenario,
} from '../scripts/bot-validation-first-tick.mjs';
import {
    buildArcadeSectorPlan,
    resolveArcadeSectorRuntimeProfile,
} from '../../../src/entities/directors/ArcadeEncounterCatalog.js';
import { ARCADE_DIFFICULTY_TIERS } from '../../../src/shared/contracts/ArcadeDifficultyContract.js';

function firstTickRuntime() {
    const player = { index: 0, isBot: true, teamId: 'ALPHA' };
    const policy = { type: 'heuristic', getDecisionSnapshot: () => ({ profile: 'balanced' }) };
    const entityManager = {
        _networkRoundSerial: 7,
        _simulationClockMs: 0,
        players: [player],
        botByPlayer: new Map([[player, policy]]),
        botPolicyType: 'heuristic',
        activeGameMode: 'HUNT',
    };
    const game = {
        state: 'PLAYING',
        entityManager,
        runtimeConfig: {
            bot: { policyType: 'heuristic' },
            session: { activeGameMode: 'HUNT' },
            arcade: { enabled: false, seed: 1 },
            hunt: { teamMode: true, teamObjective: 'FLAGS' },
        },
        settings: { localSettings: { modePath: 'fight' } },
    };
    return { game, entityManager, player, policy };
}

function createControlledScheduler() {
    const frames = new Map();
    const timers = new Map();
    let nextId = 0;
    const cancelledFrames = [];
    const cancelledTimers = [];
    return {
        frames,
        timers,
        cancelledFrames,
        cancelledTimers,
        performance: { now: () => 0 },
        requestAnimationFrame(callback) {
            const id = ++nextId;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            cancelledFrames.push(id);
            frames.delete(id);
        },
        setTimeout(callback, delayMs) {
            const id = ++nextId;
            timers.set(id, { callback, delayMs });
            return id;
        },
        clearTimeout(id) {
            cancelledTimers.push(id);
            timers.delete(id);
        },
        runFrame(beforeFrame = () => {}) {
            const entry = frames.entries().next().value;
            assert.ok(entry, 'a RAF callback is pending');
            beforeFrame();
            entry[1]();
        },
        fireTimer() {
            const entry = timers.entries().next().value;
            assert.ok(entry, 'a timeout callback is pending');
            entry[1].callback();
        },
    };
}

function startSample(runtime, scheduler, { waitForFirstTick = true, timeoutMs = 100, captureKind = 'runtime', sampler = captureBotRuntimeSample } = {}) {
    const previousWindow = globalThis.window;
    globalThis.window = {
        GAME_INSTANCE: runtime.game,
        performance: scheduler.performance,
        requestAnimationFrame: scheduler.requestAnimationFrame,
        cancelAnimationFrame: scheduler.cancelAnimationFrame,
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
    };
    return {
        promise: sampler({ waitForFirstTick, timeoutMs, captureKind }),
        restore() {
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
        },
    };
}

test('only normalized team objective scenario IDs request a first-tick sample', () => {
    assert.equal(isTeamObjectiveFirstTickScenario({ id: 'h-team-flags' }), true);
    assert.equal(isTeamObjectiveFirstTickScenario({ id: ' H-TEAM-ESCORT ' }), true);
    assert.equal(isTeamObjectiveFirstTickScenario({ id: 'H-TEAM-FLAGS-EXTRA', teamMode: true, teamObjective: 'FLAGS' }), false);
    assert.equal(isTeamObjectiveFirstTickScenario({ id: 'H-OTHER', teamMode: true, teamObjective: 'ESCORT' }), false);
});

for (const objective of ['FLAGS', 'ESCORT']) test(`serialized ${objective} start captures runtime and objective baseline on the same advancing tick`, async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const escort = { phase: 'moving', progress: 0, hp: 100, maxHp: 100, position: { x: 1, y: 2, z: 3 } };
    runtime.entityManager._mapUnitSystem = { getEscortObjectiveState: () => escort, isPositionNearEscortTank: () => true };
    runtime.player.position = { x: 4, y: 5, z: 6 };
    const sampler = new Function(`return (${captureBotRuntimeSample.toString()});`)();
    const pending = startSample(runtime, scheduler, { captureKind: 'start', sampler });
    try {
        scheduler.runFrame(() => {
            runtime.entityManager._simulationClockMs = 25;
            runtime.player.botObjectiveType = objective;
            runtime.player.flagBotRole = 'ATTACKER';
            runtime.player.escortBotRole = 'GUARD';
            runtime.player.flagBotTargetId = 'flag-2';
            escort.progress = 0.25;
        });
        const { runtimeSample, objectiveSnapshot } = await pending.promise;
        assert.equal(objectiveSnapshot.simulationSeconds, 0.025);
        assert.equal(objectiveSnapshot.bots[0].objectiveType, runtimeSample.botObjectiveAssignments[0].objectiveType);
        assert.equal(objectiveSnapshot.bots[0].objectiveRole, runtimeSample.botObjectiveAssignments[0].objectiveRole);
        assert.equal(objectiveSnapshot.escort.progress, 0.25);
        assert.equal(objectiveSnapshot.bots[0].nearEscortTank, true);
        runtime.entityManager._simulationClockMs = 50;
        escort.progress = 0.5; escort.position.x = 99; runtime.player.position.x = 88;
        assert.equal(objectiveSnapshot.simulationSeconds, 0.025);
        assert.equal(objectiveSnapshot.escort.progress, 0.25);
        assert.equal(objectiveSnapshot.escort.position.x, 1);
        assert.equal(objectiveSnapshot.bots[0].position.x, 4);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
    } finally { pending.restore(); }
});

test('objective-only observations keep their immediate snapshot path without waiting for a bot tick', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    runtime.entityManager._simulationClockMs = 500;
    const pending = startSample(runtime, scheduler, { waitForFirstTick: false, captureKind: 'objective' });
    try {
        const snapshot = await pending.promise;
        assert.equal(snapshot.simulationSeconds, 0.5);
        assert.equal(snapshot.gameState, 'PLAYING');
        assert.equal(snapshot.bots.length, 1);
        assert.equal(snapshot.runtimeSample, undefined);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
    } finally { pending.restore(); }
});

test('first-tick sample sees objective assignments added on the advancing frame and cleans callbacks', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    assert.equal(runtime.player.botObjectiveType, undefined);
    assert.equal(runtime.player.flagBotRole, undefined);
    const pending = startSample(runtime, scheduler);
    try {
        assert.equal(scheduler.frames.size, 1);
        assert.equal(scheduler.timers.size, 1);
        scheduler.runFrame();
        await new Promise(setImmediate);
        assert.equal(scheduler.frames.size, 1, 'a second RAF is requested while simulation time remains unchanged');
        assert.equal(scheduler.timers.size, 1, 'the per-wait timer is renewed');
        scheduler.runFrame(() => {
            runtime.player.botObjectiveType = 'FLAGS';
            runtime.player.flagBotRole = 'ATTACKER';
            runtime.player.flagBotTargetId = 'flag-alpha-2';
            runtime.entityManager._simulationClockMs = 16.667;
        });
        const sample = await pending.promise;
        assert.deepEqual(sample.botObjectiveAssignments, [{
            playerIndex: 0,
            teamId: 'ALPHA',
            objectiveType: 'FLAGS',
            objectiveRole: 'ATTACKER',
            objectiveTargetId: 'flag-alpha-2',
        }]);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
        assert.equal(scheduler.cancelledFrames.length, 2);
        assert.equal(scheduler.cancelledTimers.length, 2);
    } finally {
        pending.restore();
    }
});

test('team objective terminal states keep the immediate sample path', async (t) => {
    for (const state of ['ROUND_END', 'MATCH_END']) {
        await t.test(state, async () => {
            const runtime = firstTickRuntime();
            runtime.game.state = state;
            const scheduler = createControlledScheduler();
            const pending = startSample(runtime, scheduler);
            try {
                const sample = await pending.promise;
                assert.equal(sample.botCount, 1);
                assert.equal(scheduler.frames.size, 0);
                assert.equal(scheduler.timers.size, 0);
            } finally {
                pending.restore();
            }
        });
    }
});

test('non-objective scenarios use the shared sampler immediately', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler, { waitForFirstTick: false });
    try {
        const sample = await pending.promise;
        assert.equal(sample.botCount, 1);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
    } finally {
        pending.restore();
    }
});

test('first-tick sampler rejects changed identity and cleans pending callbacks', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler);
    try {
        scheduler.runFrame(() => {
            globalThis.window.GAME_INSTANCE = { ...runtime.game };
            runtime.entityManager._simulationClockMs = 16;
        });
        await assert.rejects(pending.promise, /game or entityManager replacement/);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
        assert.equal(scheduler.cancelledFrames.length, 1);
        assert.equal(scheduler.cancelledTimers.length, 1);
    } finally {
        pending.restore();
    }
});

test('first-tick sampler timeout cleans pending RAF and timer callbacks', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler, { timeoutMs: 5 });
    try {
        scheduler.fireTimer();
        await assert.rejects(pending.promise, /timed out without simulation advance \(5 ms\)/);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
        assert.equal(scheduler.cancelledFrames.length, 1);
        assert.equal(scheduler.cancelledTimers.length, 1);
    } finally {
        pending.restore();
    }
});

test('the timer wins a same-turn RAF race and both callbacks are cleaned', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler, { timeoutMs: 5 });
    try {
        const frame = scheduler.frames.values().next().value;
        assert.ok(frame);
        frame();
        scheduler.fireTimer();
        await assert.rejects(pending.promise, /timed out without simulation advance \(5 ms\)/);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
        assert.equal(scheduler.cancelledFrames.length, 1);
        assert.equal(scheduler.cancelledTimers.length, 1);
    } finally {
        pending.restore();
    }
});

test('first-tick sampler fails closed if state leaves PLAYING', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler);
    try {
        scheduler.runFrame(() => { runtime.game.state = 'ROUND_END'; });
        await assert.rejects(pending.promise, /stopped before a tick/);
        assert.equal(scheduler.frames.size, 0);
        assert.equal(scheduler.timers.size, 0);
    } finally {
        pending.restore();
    }
});

test('shared sampler keeps the runtime and combat sample fields', async () => {
    const runtime = firstTickRuntime();
    const scheduler = createControlledScheduler();
    const pending = startSample(runtime, scheduler, { waitForFirstTick: false });
    try {
        const sample = await pending.promise;
        assert.deepEqual(Object.keys(sample), [
            'runtimePolicyType', 'entityPolicyType', 'botPolicyTypes', 'botDecisions', 'botTeamIds',
            'botObjectiveAssignments', 'botCount', 'runtimeGameMode', 'entityGameMode', 'semanticGameMode',
            'modePath', 'arcadeEnabled', 'arcadeSeed', 'runtimeTeamMode', 'runtimeTeamObjective',
            'pageVisibility', 'renderFrameId', 'performance', 'huntKillCount', 'mgAimBins', 'combatTrace',
        ]);
    } finally {
        pending.restore();
    }
});

test('heuristic validation selection filters before limiting and rejects unknown ids', () => {
    const matrix = getBotValidationMatrix();
    const heuristic = selectBotValidationScenarios(matrix, { policy: 'heuristic', limit: 2 });
    assert.deepEqual(heuristic.map((entry) => entry.id), ['H-CLASSIC', 'H-FIGHT']);

    const ordered = selectBotValidationScenarios(matrix, {
        ids: ['h-arcade', 'H-CLASSIC'],
        policy: 'heuristic',
    });
    assert.deepEqual(ordered.map((entry) => entry.id), ['H-ARCADE', 'H-CLASSIC']);
    assert.throws(
        () => selectBotValidationScenarios(matrix, { ids: ['missing-scenario'] }),
        /Unknown bot-validation scenario/
    );
});

test('validation matrix matches the current runtime policy contract for every scenario', () => {
    // Keep this expected list independent of the runtime resolver and training benchmark source.
    const expectedPolicyById = new Map([
        // Auto in 3D Classic flies the Classic bridge; switching it to the heuristic awaits a decision.
        ['V1', 'classic-3d'],
        ['V2', 'classic-2d'],
        ['V3', 'hunt-2d'],
        ['V4', 'hunt-3d'],
        ['H-CLASSIC', 'heuristic'],
        ['H-FIGHT', 'heuristic'],
        ['H-FIGHT-DUEL', 'heuristic'],
        ['H-FIGHT-SURVIVAL', 'heuristic'],
        ['H-ARCADE', 'heuristic'],
        ['H-CLASSIC-2D-EASY', 'heuristic'],
        ['H-CLASSIC-3D-HARD', 'heuristic'],
        ['H-FIGHT-2D-HARD', 'heuristic'],
        ['H-ARCADE-VERTICAL', 'heuristic'],
        ['H-TEAM-FLAGS', 'heuristic'],
        ['H-TEAM-ESCORT', 'heuristic'],
    ]);
    const matrix = getBotValidationMatrix();
    assert.deepEqual(matrix.map(({ id }) => id), [...expectedPolicyById.keys()]);

    for (const scenario of matrix) {
        const expectedPolicyType = expectedPolicyById.get(scenario.id);
        assert.equal(scenario.expectedPolicyType, expectedPolicyType, `${scenario.id} matrix policy`);
        const runtimeConfig = createRuntimeConfigSnapshot({
            mode: scenario.mode,
            gameMode: scenario.gameMode,
            botPolicyStrategy: scenario.botPolicyStrategy,
            gameplay: { planarMode: scenario.planarMode },
            localSettings: { modePath: scenario.gameMode === 'ARCADE' ? 'arcade' : 'normal' },
            hunt: { teamMode: scenario.teamMode, teamObjective: scenario.teamObjective },
        });
        assert.equal(runtimeConfig.bot.policyType, expectedPolicyType, `${scenario.id} runtime policy`);
        const botCount = scenario.expectedRuntimeBotCount;
        const verification = buildBotValidationRuntimeVerification(scenario, [{
            runtimePolicyType: expectedPolicyType,
            entityPolicyType: expectedPolicyType,
            botPolicyTypes: new Array(botCount).fill(expectedPolicyType),
            botCount,
            botDecisions: new Array(botCount).fill(null).map(() => ({
                policyType: expectedPolicyType,
                snapshot: { profile: scenario.heuristicProfile, difficulty: scenario.botDifficulty.toLowerCase() },
            })),
            runtimeGameMode: scenario.gameMode,
            entityGameMode: scenario.gameMode,
            semanticGameMode: scenario.gameMode,
            modePath: scenario.gameMode.toLowerCase(),
            arcadeEnabled: scenario.gameMode === 'ARCADE',
            arcadeSeed: scenario.gameMode === 'ARCADE' ? scenario.seedBase : null,
        }]);
        assert.equal(verification.policy.ok, true, `${scenario.id} valid policy sample`);
        assert.equal(buildBotValidationRuntimeVerification(scenario, [{
            runtimePolicyType: 'rule-based',
            entityPolicyType: 'rule-based',
            botPolicyTypes: new Array(botCount).fill('rule-based'),
            botCount,
            botDecisions: new Array(botCount).fill(null).map(() => ({ policyType: 'rule-based' })),
            runtimeGameMode: scenario.gameMode,
            entityGameMode: scenario.gameMode,
            semanticGameMode: scenario.gameMode,
            modePath: scenario.gameMode.toLowerCase(),
            arcadeEnabled: scenario.gameMode === 'ARCADE',
            arcadeSeed: scenario.gameMode === 'ARCADE' ? scenario.seedBase : null,
        }]).policy.ok, false, `${scenario.id} incorrect policy sample`);
    }
});

test('Arcade validation preserves the ARCADE runtime contract and mode-specific setup state', () => {
    const service = new BotValidationService();
    let settingsChanged = 0;
    const game = {
        settings: {
            localSettings: {},
            gameplay: {},
            hunt: {},
            winsNeeded: 1,
        },
        _onSettingsChanged() {
            settingsChanged += 1;
        },
    };

    const applied = service.applyScenario(game, 'H-ARCADE');
    assert.equal(applied.id, 'H-ARCADE');
    assert.equal(applied.expectedRuntimeBotCount, 3);
    assert.equal(game.settings.localSettings.modePath, 'arcade');
    assert.equal(game.settings.gameMode, 'ARCADE');
    assert.equal(game.settings.mapKey, 'standard');
    assert.equal(game.settings.localSettings.startSetup.modeSelections.arcade.mapKey, 'standard');
    assert.equal(game.settings.botPolicyStrategy, 'heuristic');
    assert.equal(game.settings.botDifficulty, 'NORMAL');
    assert.equal(game.settings.botHeuristicProfile, 'balanced');
    assert.equal(game.settings.arcade.seed, 1337);
    assert.equal(game.settings.hunt.respawnEnabled, false);
    assert.equal(settingsChanged, 1);
});

test('vertical Arcade bot validation avoids parcours-only maps', () => {
    const scenario = getBotValidationMatrix().find((entry) => entry.id === 'H-ARCADE-VERTICAL');
    assert.equal(scenario.mapKey, 'vertical_maze');
    assert.equal(scenario.bots, 1);
    assert.equal(scenario.expectedRuntimeBotCount, 3);
    assert.equal(scenario.expectedRuntimeBotCountFromArcadeSeed, true);
    assert.equal(scenario.expectedPolicyType, 'heuristic');
});

test('Fight validation uses a one-kill deathmatch objective that fits the runner window', () => {
    const service = new BotValidationService();
    const game = {
        settings: {
            localSettings: {},
            gameplay: {},
            hunt: {},
            winsNeeded: 4,
        },
        _onSettingsChanged() {},
    };

    const applied = service.applyScenario(game, 'H-FIGHT-DUEL');
    assert.equal(applied.respawnEnabled, true);
    assert.equal(applied.deathmatchKillLimit, 1);
    assert.equal(game.settings.hunt.respawnEnabled, true);
    assert.equal(game.settings.hunt.deathmatchKillLimit, 1);
    assert.equal(game.settings.gameplay.fightPlayerHp, 80);
    assert.equal(game.settings.gameplay.fightMgDamage, 20);
    assert.equal(game.settings.gameplay.mgTrailAimRadius, 0.2);
});

test('Fight validation separates natural Duel outcomes from fixed Survival observations', () => {
    const matrix = getBotValidationMatrix();
    const alias = matrix.find((entry) => entry.id === 'H-FIGHT');
    const duel = matrix.find((entry) => entry.id === 'H-FIGHT-DUEL');
    const survival = matrix.find((entry) => entry.id === 'H-FIGHT-SURVIVAL');
    assert.equal(alias.validationTarget, 'duel');
    assert.equal(duel.deathmatchKillLimit, 1);
    assert.equal(duel.validationTarget, 'duel');
    assert.equal(survival.deathmatchKillLimit, 100);
    assert.equal(survival.validationTarget, 'survival');
    assert.equal(survival.observationSeconds, 40);

    const duelOutcomes = buildBotValidationOutcomeSemantics(duel, [
        { winnerIndex: 1, winnerIsBot: true },
        { winnerIndex: 0, winnerIsBot: false },
    ], { forcedRoundNumbers: [2] });
    assert.equal(duelOutcomes.outcomeRounds, 2);
    assert.equal(duelOutcomes.naturalOutcomeRounds, 1);
    assert.equal(duelOutcomes.forcedRounds, 1);

    const survivalOutcomes = buildBotValidationOutcomeSemantics(survival, [
        { winnerIndex: 1, winnerIsBot: true },
    ], { observationRuns: 1, completedObservations: 1 });
    assert.deepEqual(survivalOutcomes.rounds, []);
    assert.equal(survivalOutcomes.outcomeRounds, 0);
    assert.equal(survivalOutcomes.unexpectedOutcomeRounds, 1);
    assert.equal(survivalOutcomes.observationCompleted, true);
});

test('Survival scenario applies without changing production Fight defaults', () => {
    const service = new BotValidationService();
    const game = {
        settings: { localSettings: {}, gameplay: {}, hunt: {}, winsNeeded: 1 },
        _onSettingsChanged() {},
    };
    const applied = service.applyScenario(game, 'H-FIGHT-SURVIVAL');
    assert.equal(applied.validationTarget, 'survival');
    assert.equal(game.settings.hunt.respawnEnabled, true);
    assert.equal(game.settings.hunt.deathmatchKillLimit, 100);
});

test('runtime verification checks policy instances and separates semantic from internal mode', () => {
    const scenario = getBotValidationMatrix().find((entry) => entry.id === 'H-ARCADE');
    const sample = {
        runtimePolicyType: 'heuristic',
        entityPolicyType: 'heuristic',
        botPolicyTypes: ['heuristic'],
        botCount: 1,
        botDecisions: [{
            policyType: 'heuristic',
            snapshot: { profile: 'balanced', difficulty: 'normal' },
        }],
        runtimeGameMode: 'ARCADE',
        entityGameMode: 'ARCADE',
        semanticGameMode: 'ARCADE',
        modePath: 'arcade',
        arcadeEnabled: true,
        arcadeSeed: 42,
    };

    const valid = buildBotValidationRuntimeVerification(scenario, [sample]);
    assert.equal(valid.policy.ok, true);
    assert.equal(valid.mode.ok, true);
    assert.equal(valid.mode.expectedRuntimeGameMode, 'ARCADE');

    const invalid = buildBotValidationRuntimeVerification(scenario, [{
        ...sample,
        botPolicyTypes: ['rule-based'],
    }]);
    assert.equal(invalid.policy.ok, false);
});

test('runtime verification reports missing, additional, policyless, and botless samples separately', () => {
    const scenario = getBotValidationMatrix().find((entry) => entry.id === 'H-ARCADE-VERTICAL');
    const sample = {
        runtimePolicyType: 'heuristic',
        entityPolicyType: 'heuristic',
        botPolicyTypes: ['heuristic', 'heuristic', 'heuristic'],
        botCount: 3,
        botDecisions: [1, 2, 3].map(() => ({
            policyType: 'heuristic',
            snapshot: { profile: 'balanced', difficulty: 'hard' },
        })),
        runtimeGameMode: 'ARCADE',
        entityGameMode: 'ARCADE',
        semanticGameMode: 'ARCADE',
        modePath: 'arcade',
        arcadeEnabled: true,
        arcadeSeed: 1337,
    };
    assert.equal(buildBotValidationRuntimeVerification(scenario, [sample]).botCount.ok, true);
    const secondEncounterSample = {
        ...sample,
        arcadeSeed: 1338,
        botCount: 2,
        botPolicyTypes: ['heuristic', 'heuristic'],
        botDecisions: sample.botDecisions.slice(0, 2),
    };
    const seededCounts = buildBotValidationRuntimeVerification(scenario, [sample, secondEncounterSample]).botCount;
    assert.equal(seededCounts.ok, true);
    assert.deepEqual(seededCounts.expectedBySample, [3, 2]);
    assert.equal(buildBotValidationRuntimeVerification(scenario, [{ ...secondEncounterSample, botCount: 3 }]).botCount.ok, false);
    assert.equal(buildBotValidationRuntimeVerification(scenario, [{ ...sample, arcadeSeed: null }]).botCount.ok, false);

    const invalid = buildBotValidationRuntimeVerification(scenario, [
        { ...sample, botCount: 2, botPolicyTypes: ['heuristic', 'heuristic'] },
        { ...sample, botCount: 4, botPolicyTypes: ['heuristic', 'heuristic', 'heuristic', 'heuristic'] },
        { ...sample, botPolicyTypes: ['heuristic', 'heuristic'] },
        { ...sample, botCount: 0, botPolicyTypes: [] },
    ]).botCount;
    assert.equal(invalid.ok, false);
    assert.equal(invalid.mismatchSamples, 3);
    assert.equal(invalid.missingBots, 4);
    assert.equal(invalid.additionalBots, 1);
    assert.equal(invalid.policylessBots, 1);
    assert.equal(invalid.botlessSamples, 1);
});

test('runner applies selected ids, records real bot deaths, and analysis defaults to heuristic policy', async () => {
    const [runnerSource, analysisSource, packageSource, samplerSource] = await Promise.all([
        readFile(new URL('../scripts/bot-validation-runner.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/bot-play-analysis.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/bot-validation-first-tick.mjs', import.meta.url), 'utf8'),
    ]);
    assert.match(runnerSource, /applyBotValidationScenario\(scenarioId\)/);
    assert.match(runnerSource, /chromium\.launch\(\{\s+headless: HEADLESS,\s+\.\.\.\(HEADLESS \? \{ channel: 'chromium' \} : \{\}\),\s+args:/);
    assert.match(runnerSource, /acquirePlaywrightRunLock\(\{ label: 'bot validation' \}\)/);
    assert.match(runnerSource, /execSync\('npm run build:app'/);
    assert.match(runnerSource, /await g\.runtimeCoordinator\.startMatch\(\{ source: 'bot_validation' \}\)/);
    assert.match(samplerSource, /id === 'H-TEAM-FLAGS' \|\| id === 'H-TEAM-ESCORT'/);
    assert.match(runnerSource, /const objectiveFirstTick = isTeamObjectiveFirstTickScenario\(scenario\)/);
    assert.match(runnerSource, /waitForFirstTick: objectiveFirstTick/);
    assert.match(runnerSource, /captureKind: objectiveFirstTick \? 'start' : 'runtime'/);
    assert.match(runnerSource, /objectiveSnapshots\.push\(objectiveFirstTick\s+\? startCapture\.objectiveSnapshot/);
    assert.equal((runnerSource.match(/captureBotRuntimeSample,/g) || []).length, 4, 'the shared sampler is imported and used for start, end and objective samples');
    assert.match(
        runnerSource,
        /waitForFunction\(\(\) => \{\s+const game = window\.GAME_INSTANCE;\s+return typeof game\?\.getBotValidationMatrix === 'function'\s+&& typeof game\?\.applyBotValidationScenario === 'function';/
    );
    assert.match(runnerSource, /scenario-base-plus-round-index/);
    assert.match(runnerSource, /const outcomeRounds = rounds\.filter\(\(round\) => round\?\.forced !== true\)/);
    assert.match(runnerSource, /botWinRate: outcomePlayed > 0 \? botWins \/ outcomePlayed : null/);
    assert.match(runnerSource, /buildBotValidationOutcomeSemantics\(\s*scenario,\s*recordedScenarioRounds,\s*localStats\s*\)/);
    assert.match(analysisSource, /outcomeRounds > 0 \? toNumber\(metrics\.botWinRate, 0\) : null/);
    assert.match(runnerSource, /round\?\.botDeathCauseCounts/);
    assert.match(runnerSource, /isSurvivalObservationScenario\(scenario\)/);
    assert.match(runnerSource, /isObjectiveObservationScenario\(scenario\)/);
    assert.match(runnerSource, /captureBotObjectiveSnapshot\(/);
    assert.match(runnerSource, /Math\.min\(5000, observationMs - observedMs\)/);
    // Runtime and objective capture share one serializable module; the runner only selects the capture kind.
    assert.equal((runnerSource.match(/const objectiveRole = objectiveType === 'FLAGS'/g) || []).length, 0);
    assert.equal((samplerSource.match(/const objectiveRole = objectiveType === 'FLAGS'/g) || []).length, 2);
    assert.equal((samplerSource.match(/objectiveTargetId: objectiveType === 'FLAGS'/g) || []).length, 1);
    assert.match(runnerSource, /A att\/def\/cap=/);
    assert.match(runnerSource, /B tankDamage=/);
    assert.match(runnerSource, /Aktionsbelege sind Beobachtungsdaten, kein Win-\/Erfolgskriterium/);
    assert.match(runnerSource, /if \(typeof g\._returnToMenu !== 'function'\) throw new Error\('_returnToMenu missing'\)/);
    assert.match(runnerSource, /survival observations produced outcomes/);
    assert.match(runnerSource, /bot count contract mismatched/);
    assert.match(runnerSource, /buildScenarioMetrics\(null, allRounds, validationRuntimeSamples, validationSurvivalObservations\)/);
    assert.match(runnerSource, /browser runtime errors encountered/);
    assert.match(runnerSource, /huntRespawnEnabled: entityManager\?\._roundOutcomeSystem\?\.isRespawnEnabled\?\.\(\) \?\? null/);
    assert.match(runnerSource, /renderFrameId: Number\(game\?\.gameLoop\?\.renderFrameId \?\? 0\)/);
    assert.match(runnerSource, /pageVisibility: document\.visibilityState/);
    assert.match(runnerSource, /respawnRemainingByPlayer: entityManager\?\.getHuntRespawnRemainingByPlayer\?\.\(\) \|\| \{\}/);
    assert.match(runnerSource, /huntScoreboard: entityManager\?\.getHuntScoreboard\?\.\(\) \|\| \[\]/);
    assert.doesNotMatch(runnerSource, /DEFAULT_SCENARIO_COUNT/);
    assert.match(runnerSource, /if \(raw === 'dev'\) return 'dev';\s+return 'preview';/);
    assert.match(analysisSource, /readOption\(\['policy', 'policy-type'\], 'heuristic'\)/);
    assert.match(analysisSource, /runnerArgs\.push\('--fail-on-forced-round', 'true'\)/);
    assert.match(packageSource, /"bot:validate:fight".*H-FIGHT-DUEL.*--rounds 8.*--headless true.*--fail-on-forced-round true/);
    assert.match(
        packageSource,
        /"bot:validate:flight".*H-FIGHT-DUEL,H-CLASSIC-3D-HARD,H-ARCADE-VERTICAL.*--policy heuristic.*--rounds 2.*--headless true/
    );
});

// Arcade runs replace the menu bot count and difficulty with the seeded first sector of the
// arcade tier (dadc10fc). The runner seeds round N with seedBase + N.
function arcadeSectorProfile(seed, tierId = 'normal') {
    const tier = ARCADE_DIFFICULTY_TIERS.find((entry) => entry.id === tierId);
    return resolveArcadeSectorRuntimeProfile(buildArcadeSectorPlan({ seed, difficulty: tierId }).sequence[0], {
        fallbackBotCount: 1,
        fallbackDifficulty: tier.ai,
    });
}

function arcadeSample(seed, botCount, difficulty) {
    return {
        runtimePolicyType: 'heuristic',
        entityPolicyType: 'heuristic',
        botPolicyTypes: new Array(botCount).fill('heuristic'),
        botCount,
        botDecisions: new Array(botCount).fill(null).map(() => ({
            policyType: 'heuristic',
            snapshot: { profile: 'balanced', difficulty: difficulty.toLowerCase() },
        })),
        runtimeGameMode: 'ARCADE',
        entityGameMode: 'ARCADE',
        semanticGameMode: 'ARCADE',
        modePath: 'arcade',
        arcadeEnabled: true,
        arcadeSeed: seed,
    };
}

test('Arcade scenarios expect the seeded squad size of every round', () => {
    const arcadeScenarios = getBotValidationMatrix().filter((entry) => entry.gameMode === 'ARCADE');
    assert.deepEqual(arcadeScenarios.map((entry) => entry.id), ['H-ARCADE', 'H-ARCADE-VERTICAL']);
    for (const scenario of arcadeScenarios) {
        const samples = [0, 1, 2, 3].map((round) => {
            const seed = scenario.seedBase + round;
            const profile = arcadeSectorProfile(seed);
            return arcadeSample(seed, profile.botCount, scenario.botDifficulty);
        });
        const verification = buildBotValidationRuntimeVerification(scenario, samples).botCount;
        assert.deepEqual(verification.expectedBySample, samples.map((sample) => sample.botCount), scenario.id);
        assert.equal(verification.ok, true, scenario.id);
    }
});

test('Arcade scenarios expect the bot difficulty of the arcade tier they pin', () => {
    const service = new BotValidationService();
    for (const scenario of getBotValidationMatrix().filter((entry) => entry.gameMode === 'ARCADE')) {
        const game = { settings: { localSettings: {}, gameplay: {}, hunt: {}, winsNeeded: 1 }, _onSettingsChanged() {} };
        service.applyScenario(game, scenario.id);
        const tierId = game.settings.arcade.difficultyTierId;
        assert.equal(tierId, 'normal', `${scenario.id} must pin the tier every profile has unlocked`);
        const samples = [0, 1, 2, 3].map((round) => {
            const seed = scenario.seedBase + round;
            const profile = arcadeSectorProfile(seed, tierId);
            return arcadeSample(seed, profile.botCount, profile.botDifficulty);
        });
        const policy = buildBotValidationRuntimeVerification(scenario, samples).policy;
        assert.equal(policy.ok, true, `${scenario.id} expects ${policy.expectedDifficulty}, arcade plays ${policy.difficultyNames}`);
    }
});
