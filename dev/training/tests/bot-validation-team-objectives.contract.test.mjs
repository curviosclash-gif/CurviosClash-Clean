import assert from 'node:assert/strict';
import test from 'node:test';

import { getBotValidationMatrix } from '../src/state/validation/BotValidationMatrix.js';
import {
    BotValidationService,
    buildBotValidationRuntimeVerification,
} from '../src/state/validation/BotValidationService.js';
import { buildBotValidationRuntimeMetrics } from '../src/state/validation/BotValidationRuntimeMetrics.js';

function teamSample(objective, assignments) {
    return {
        runtimePolicyType: 'heuristic',
        entityPolicyType: 'heuristic',
        botPolicyTypes: new Array(5).fill('heuristic'),
        botCount: 5,
        botDecisions: new Array(5).fill(null).map(() => ({
            policyType: 'heuristic',
            snapshot: { profile: 'balanced', difficulty: 'normal' },
        })),
        runtimeGameMode: objective === 'ESCORT' ? 'ESCORT' : 'HUNT',
        entityGameMode: objective === 'ESCORT' ? 'ESCORT' : 'HUNT',
        semanticGameMode: objective === 'ESCORT' ? 'ESCORT' : 'HUNT',
        modePath: 'fight',
        arcadeEnabled: false,
        arcadeSeed: 7331,
        runtimeTeamMode: true,
        runtimeTeamObjective: objective,
        botTeamIds: ['BRAVO', 'ALPHA', 'BRAVO', 'ALPHA', 'BRAVO'],
        botObjectiveAssignments: assignments,
    };
}

test('team validation scenarios cover deterministic flag and escort runtime lanes', () => {
    const matrix = getBotValidationMatrix();
    const flags = matrix.find((entry) => entry.id === 'H-TEAM-FLAGS');
    const escort = matrix.find((entry) => entry.id === 'H-TEAM-ESCORT');

    for (const scenario of [flags, escort]) {
        assert.equal(scenario.teamMode, true);
        assert.equal(scenario.teamSize, 3);
        assert.equal(scenario.expectedRuntimeBotCount, 5);
        assert.equal(scenario.botPolicyStrategy, 'heuristic');
        assert.ok(scenario.seedBase > 0);
    }
    assert.equal(flags.teamObjective, 'FLAGS');
    assert.equal(escort.teamObjective, 'ESCORT');
});

test('team validation applies the team roster and objective without changing the requested menu mode', () => {
    const service = new BotValidationService();
    const game = {
        settings: { localSettings: {}, gameplay: {}, hunt: {}, winsNeeded: 1 },
        _onSettingsChanged() {},
    };

    const applied = service.applyScenario(game, 'H-TEAM-ESCORT');
    assert.equal(applied.teamObjective, 'ESCORT');
    assert.equal(game.settings.gameMode, 'HUNT');
    assert.equal(game.settings.localSettings.modePath, 'fight');
    assert.equal(game.settings.hunt.teamMode, true);
    assert.equal(game.settings.hunt.teamObjective, 'ESCORT');
    assert.equal(game.settings.hunt.teamSize, 3);
    assert.deepEqual(game.settings.hunt.teamBotDifficulty, { ALPHA: 'NORMAL', BRAVO: 'NORMAL' });

    service.applyScenario(game, 'H-FIGHT-DUEL');
    assert.equal(game.settings.hunt.teamMode, false);
    assert.equal(game.settings.hunt.teamObjective, 'HUNT');
});

test('runtime verification requires both teams and observed objective assignments', () => {
    const scenario = getBotValidationMatrix().find((entry) => entry.id === 'H-TEAM-FLAGS');
    const sample = teamSample('FLAGS', [
        { teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER' },
        { teamId: 'BRAVO', objectiveType: 'FLAGS', objectiveRole: 'DEFENDER' },
    ]);
    const partial = buildBotValidationRuntimeVerification(scenario, [sample]);
    assert.equal(partial.policy.ok, true);
    assert.equal(partial.mode.ok, true);
    assert.equal(partial.team.ok, false);
    assert.deepEqual(partial.team.botTeamIds, ['BRAVO', 'ALPHA']);
    assert.deepEqual(partial.team.objectiveTypes, ['FLAGS']);
    assert.deepEqual(partial.team.objectiveRoles, ['ATTACKER', 'DEFENDER']);
    assert.equal(partial.team.missingObjectiveBotSamples, 3);

    const complete = buildBotValidationRuntimeVerification(scenario, [{
        ...sample,
        botObjectiveAssignments: [
            ...sample.botObjectiveAssignments,
            { teamId: 'BRAVO', objectiveType: 'FLAGS', objectiveRole: 'SUPPORT' },
            { teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'DEFENDER' },
            { teamId: 'BRAVO', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER' },
        ],
    }]);
    assert.equal(complete.team.ok, true);
    assert.equal(complete.team.missingObjectiveBotSamples, 0);

    const missingAssignments = buildBotValidationRuntimeVerification(scenario, [{
        ...sample,
        botObjectiveAssignments: [],
    }]);
    assert.equal(missingAssignments.team.ok, false);
});

test('team objective assignments become comparable validation metrics', () => {
    const metrics = buildBotValidationRuntimeMetrics([
        teamSample('ESCORT', [
            { objectiveType: 'ESCORT', objectiveRole: 'ESCORT' },
            { objectiveType: 'ESCORT', objectiveRole: 'INTERCEPT' },
        ]),
        teamSample('ESCORT', [
            { objectiveType: 'ESCORT', objectiveRole: 'ESCORT' },
            { objectiveType: 'ESCORT', objectiveRole: 'VANGUARD' },
        ]),
    ], 10);
    assert.equal(metrics.objectiveBotSampleCount, 4);
    assert.equal(metrics.objectiveBotExpectedSampleCount, 10);
    assert.equal(metrics.objectiveParticipationRate, 0.4);
    assert.deepEqual(metrics.objectiveTypeCounts, { ESCORT: 4 });
    assert.deepEqual(metrics.objectiveRoleCounts, { ESCORT: 2, INTERCEPT: 1, VANGUARD: 1 });
});
