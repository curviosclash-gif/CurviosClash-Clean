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

test('Arcade validation preserves the CLASSIC runtime contract and the Arcade semantic path', () => {
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
    assert.equal(game.settings.localSettings.modePath, 'arcade');
    assert.equal(game.settings.gameMode, 'CLASSIC');
    assert.equal(game.settings.botPolicyStrategy, 'heuristic');
    assert.equal(game.settings.botDifficulty, 'NORMAL');
    assert.equal(game.settings.botHeuristicProfile, 'balanced');
    assert.equal(game.settings.arcade.seed, 1337);
    assert.equal(game.settings.hunt.respawnEnabled, false);
    assert.equal(settingsChanged, 1);
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
        runtimeGameMode: 'CLASSIC',
        entityGameMode: 'CLASSIC',
        semanticGameMode: 'ARCADE',
        modePath: 'arcade',
        arcadeEnabled: true,
        arcadeSeed: 42,
    };

    const valid = buildBotValidationRuntimeVerification(scenario, [sample]);
    assert.equal(valid.policy.ok, true);
    assert.equal(valid.mode.ok, true);
    assert.equal(valid.mode.expectedRuntimeGameMode, 'CLASSIC');

    const invalid = buildBotValidationRuntimeVerification(scenario, [{
        ...sample,
        botPolicyTypes: ['rule-based'],
    }]);
    assert.equal(invalid.policy.ok, false);
});

test('runner applies selected ids, records real bot deaths, and analysis defaults to heuristic policy', async () => {
    const [runnerSource, analysisSource, packageSource] = await Promise.all([
        readFile(new URL('../scripts/bot-validation-runner.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../scripts/bot-play-analysis.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ]);
    assert.match(runnerSource, /applyBotValidationScenario\(scenarioId\)/);
    assert.match(
        runnerSource,
        /waitForFunction\(\(\) => \{\s+const game = window\.GAME_INSTANCE;\s+return typeof game\?\.getBotValidationMatrix === 'function'\s+&& typeof game\?\.applyBotValidationScenario === 'function';/
    );
    assert.match(runnerSource, /scenario-base-plus-round-index/);
    assert.match(runnerSource, /const outcomeRounds = rounds\.filter\(\(round\) => round\?\.forced !== true\)/);
    assert.match(runnerSource, /botWinRate: outcomePlayed > 0 \? botWins \/ outcomePlayed : null/);
    assert.match(runnerSource, /forced: localStats\.forcedRoundNumbers\.includes\(roundIndex \+ 1\)/);
    assert.match(analysisSource, /outcomeRounds > 0 \? toNumber\(metrics\.botWinRate, 0\) : null/);
    assert.match(runnerSource, /round\?\.botDeathCauseCounts/);
    assert.match(runnerSource, /browser runtime errors encountered/);
    assert.doesNotMatch(runnerSource, /DEFAULT_SCENARIO_COUNT/);
    assert.match(runnerSource, /if \(raw === 'dev'\) return 'dev';\s+return 'preview';/);
    assert.match(analysisSource, /readOption\(\['policy', 'policy-type'\], 'heuristic'\)/);
    assert.match(analysisSource, /runnerArgs\.push\('--fail-on-forced-round', 'true'\)/);
    assert.match(packageSource, /"bot:validate:fight".*H-FIGHT.*--rounds 8.*--headless true.*--fail-on-forced-round true/);
});
