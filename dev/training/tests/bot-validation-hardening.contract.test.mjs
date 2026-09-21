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
    const [runnerSource, analysisSource, packageSource] = await Promise.all([
        readFile(new URL('../scripts/bot-validation-runner.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/bot-play-analysis.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ]);
    assert.match(runnerSource, /applyBotValidationScenario\(scenarioId\)/);
    assert.match(runnerSource, /acquirePlaywrightRunLock\(\{ label: 'bot validation' \}\)/);
    assert.match(runnerSource, /execSync\('npm run build:app'/);
    assert.match(runnerSource, /await g\.runtimeCoordinator\.startMatch\(\{ source: 'bot_validation' \}\)/);
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
    assert.match(runnerSource, /if \(typeof g\._returnToMenu !== 'function'\) throw new Error\('_returnToMenu missing'\)/);
    assert.match(runnerSource, /survival observations produced outcomes/);
    assert.match(runnerSource, /bot count contract mismatched/);
    assert.match(runnerSource, /buildScenarioMetrics\(allRounds, validationRuntimeSamples, validationSurvivalObservations\)/);
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
