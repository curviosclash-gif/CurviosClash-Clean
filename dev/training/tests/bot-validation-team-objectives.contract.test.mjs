import assert from 'node:assert/strict';
import test from 'node:test';

import { getBotValidationMatrix } from '../src/state/validation/BotValidationMatrix.js';
import {
    BotValidationService,
    buildBotValidationRuntimeVerification,
} from '../src/state/validation/BotValidationService.js';
import {
    buildBotValidationObjectiveMetrics,
    buildBotValidationRuntimeMetrics,
} from '../src/state/validation/BotValidationRuntimeMetrics.js';
import {
    BOT_VALIDATION_TARGETS,
    buildBotValidationOutcomeSemantics,
} from '../src/state/validation/BotValidationOutcomeSemantics.js';

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
    assert.equal(flags.validationTarget, BOT_VALIDATION_TARGETS.OBJECTIVE);
    assert.equal(escort.validationTarget, BOT_VALIDATION_TARGETS.OBJECTIVE);
    assert.equal(flags.observationSeconds, 40);
    assert.equal(escort.observationSeconds, 40);
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
        {
            botCount: 7,
            runtimeTeamMode: false,
            runtimeTeamObjective: 'HUNT',
            botObjectiveAssignments: [{ objectiveType: 'ESCORT', objectiveRole: 'HUNTER' }],
            botDecisions: [],
        },
        teamSample('ESCORT', [
            { objectiveType: 'ESCORT', objectiveRole: 'ESCORT' },
            { objectiveType: 'ESCORT', objectiveRole: 'INTERCEPT' },
        ]),
        teamSample('ESCORT', [
            { objectiveType: 'ESCORT', objectiveRole: 'ESCORT' },
            { objectiveType: 'ESCORT', objectiveRole: 'VANGUARD' },
            { objectiveType: 'FLAGS', objectiveRole: 'ATTACKER' },
        ]),
    ], 10);
    assert.equal(metrics.objectiveBotSampleCount, 4);
    assert.equal(metrics.objectiveBotExpectedSampleCount, 10);
    assert.equal(metrics.objectiveParticipationRate, 0.4);
    assert.deepEqual(metrics.objectiveTypeCounts, { ESCORT: 4 });
    assert.deepEqual(metrics.objectiveRoleCounts, { ESCORT: 2, INTERCEPT: 1, VANGUARD: 1 });
});

test('objective observation reports flag approaches, enemy-flag damage, and capture as action evidence', () => {
    const scenario = { teamMode: true, teamObjective: 'FLAGS' };
    const observations = [{
        observationCompleted: true,
        naturalObjectiveOutcomeObserved: false,
        objectiveSnapshots: [
            {
                bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 300, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 0 },
            },
            {
                bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 5, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 250, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 1, flagId: 'flag-b', teamId: 'ALPHA', playerIndex: 1 },
            },
        ],
    }];
    const metrics = buildBotValidationObjectiveMetrics(scenario, observations);
    assert.equal(metrics.progressStatus, 'evidence-observed');
    assert.equal(metrics.observationCompleted, true);
    assert.equal(metrics.naturalOutcomeObserved, false, 'action evidence is separate from a completed match outcome');
    assert.equal(metrics.evidence.targetApproachPairs, 1);
    assert.equal(metrics.evidence.enemyFlagHpDamage, 50);
    assert.equal(metrics.evidence.captures, 1);
    assert.equal(metrics.evidence.alphaAttackerApproachPairs, 1);
    assert.equal(metrics.evidence.alphaCaptures, 1);
});

test('flag HP loss remains objective progress but is not credited as a bot action without a source', () => {
    const snapshots = [
        {
            bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
            flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 200, position: { x: 10, y: 0, z: 0 } }],
            flagCaptureEvent: { id: 0 },
        },
        {
            bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
            flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 140, position: { x: 10, y: 0, z: 0 } }],
            flagCaptureEvent: { id: 0 },
        },
    ];
    const metrics = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{
        objectiveSnapshots: snapshots,
    }]);
    assert.equal(metrics.evidence.enemyFlagHpDamage, 60);
    assert.equal(metrics.objectiveProgressObserved, true);
    assert.equal(metrics.actionEvidenceCount, 0);
    assert.equal(metrics.progressStatus, 'insufficient');

    const noBot = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{
        objectiveSnapshots: snapshots.map((snapshot) => ({ ...snapshot, bots: [] })),
    }]);
    assert.equal(noBot.evidence.enemyFlagHpDamage, 60, 'flag HP progress is observed independently of bot assignment');
    assert.equal(noBot.objectiveProgressObserved, true);
    assert.equal(noBot.actionEvidenceCount, 0);
    assert.equal(noBot.progressStatus, 'insufficient');
});

test('capture ID gaps attribute only the identified latest bot capture', () => {
    const snapshots = [
        {
            bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
            flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 100, position: { x: 10, y: 0, z: 0 } }],
            flagCaptureEvent: { id: 0 },
        },
        {
            bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'ATTACKER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
            flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 100, position: { x: 10, y: 0, z: 0 } }],
            flagCaptureEvent: { id: 2, flagId: 'flag-b', teamId: 'BRAVO', playerIndex: 1 },
        },
    ];
    const botCapture = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{ objectiveSnapshots: snapshots }]);
    assert.equal(botCapture.evidence.captures, 1);
    assert.equal(botCapture.evidence.alphaCaptures, 1);
    assert.equal(botCapture.evidence.unattributedCaptureEvents, 1);

    const humanCapture = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{
        objectiveSnapshots: [
            snapshots[0],
            { ...snapshots[1], flagCaptureEvent: { id: 2, flagId: 'flag-b', teamId: 'BRAVO', playerIndex: 99 } },
        ],
    }]);
    assert.equal(humanCapture.evidence.captures, 0);
    assert.equal(humanCapture.evidence.unattributedCaptureEvents, 1);
});

test('flag objective evidence excludes role-mismatched approaches and capture credits', () => {
    const metrics = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{
        objectiveSnapshots: [
            {
                bots: [{ playerIndex: 4, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'DEFENDER', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 200, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 0 },
            },
            {
                bots: [{ playerIndex: 4, teamId: 'ALPHA', objectiveType: 'FLAGS', objectiveRole: 'DEFENDER', objectiveTargetId: 'flag-b', position: { x: 4, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 200, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 1, flagId: 'flag-b', teamId: 'BRAVO', playerIndex: 4 },
            },
        ],
    }]);
    assert.equal(metrics.progressStatus, 'insufficient');
    assert.equal(metrics.evidence.targetApproachPairs, 0);
    assert.equal(metrics.evidence.captures, 0);
});

test('objective roles follow the active objective type and reject stale or unknown-role fields', () => {
    const flags = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'FLAGS' }, [{
        objectiveSnapshots: [
            {
                bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD', objectiveTargetId: 'flag-b', position: { x: 0, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 200, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 0 },
            },
            {
                bots: [{ playerIndex: 1, teamId: 'ALPHA', objectiveType: 'FLAGS', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD', objectiveTargetId: 'flag-b', position: { x: 4, y: 0, z: 0 } }],
                flags: [{ id: 'flag-b', teamId: 'BRAVO', hp: 200, position: { x: 10, y: 0, z: 0 } }],
                flagCaptureEvent: { id: 0 },
            },
        ],
    }]);
    assert.equal(flags.evidence.alphaAttackerApproachPairs, 1);
    assert.equal(flags.evidence.alphaDefenderApproachPairs, 0);

    const escort = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'ESCORT' }, [{
        objectiveSnapshots: [
            {
                bots: [
                    { playerIndex: 1, teamId: 'ALPHA', objectiveType: 'ESCORT', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                    { playerIndex: 2, teamId: 'ALPHA', objectiveType: 'FLAGS', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                    { playerIndex: 3, teamId: 'ALPHA', objectiveType: 'UNKNOWN', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                ],
                escort: { progress: 0, checkpointsReached: 0 },
                scoreboard: [
                    { playerIndex: 1, escortSeconds: 0, escortCheckpointContributions: 0, escortRepairHp: 0, escortRecoveries: 0, escortGuardKills: 0 },
                    { playerIndex: 2, escortSeconds: 0, escortCheckpointContributions: 0, escortRepairHp: 0, escortRecoveries: 0, escortGuardKills: 0 },
                    { playerIndex: 3, escortSeconds: 0, escortCheckpointContributions: 0, escortRepairHp: 0, escortRecoveries: 0, escortGuardKills: 0 },
                ],
            },
            {
                bots: [
                    { playerIndex: 1, teamId: 'ALPHA', objectiveType: 'ESCORT', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                    { playerIndex: 2, teamId: 'ALPHA', objectiveType: 'FLAGS', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                    { playerIndex: 3, teamId: 'ALPHA', objectiveType: 'UNKNOWN', flagBotRole: 'ATTACKER', escortBotRole: 'GUARD' },
                ],
                escort: { progress: 0.1, checkpointsReached: 1 },
                scoreboard: [
                    { playerIndex: 1, escortSeconds: 4, escortCheckpointContributions: 1, escortRepairHp: 0, escortRecoveries: 0, escortGuardKills: 1 },
                    { playerIndex: 2, escortSeconds: 20, escortCheckpointContributions: 3, escortRepairHp: 8, escortRecoveries: 2, escortGuardKills: 4 },
                    { playerIndex: 3, escortSeconds: 50, escortCheckpointContributions: 5, escortRepairHp: 12, escortRecoveries: 3, escortGuardKills: 7 },
                ],
            },
        ],
    }]);
    assert.equal(escort.evidence.alphaEscortSeconds, 4);
    assert.equal(escort.evidence.alphaCheckpointContributions, 1);
    assert.equal(escort.evidence.alphaGuardKills, 1);
    assert.equal(escort.evidence.bravoTankDamage, 0);
});

test('objective metrics report missing observations as incomplete with finite zero evidence', () => {
    const metrics = buildBotValidationObjectiveMetrics({ teamMode: true, teamObjective: 'ESCORT' }, []);
    assert.equal(metrics.progressStatus, 'incomplete');
    assert.equal(metrics.actionEvidenceCount, 0);
    assert.equal(metrics.observationCompleted, false);
    assert.equal(metrics.evidence.bravoTankDamage, 0);
});

test('objective observation distinguishes real escort progress and role-linked activity from no evidence', () => {
    const scenario = { teamMode: true, teamObjective: 'ESCORT' };
    const empty = buildBotValidationObjectiveMetrics(scenario, [{
        observationCompleted: true,
        objectiveSnapshots: [{ bots: [], scoreboard: [], escort: { progress: 0, checkpointsReached: 0 } }, { bots: [], scoreboard: [], escort: { progress: 0.2, checkpointsReached: 1 } }],
    }]);
    assert.equal(empty.progressStatus, 'insufficient');
    assert.equal(empty.objectiveProgressObserved, true, 'the objective moved, but no bot-role action was evidenced');
    assert.equal(empty.evidence.progressDelta, 0.2);

    const activity = buildBotValidationObjectiveMetrics(scenario, [{
        observationCompleted: true,
        naturalObjectiveOutcomeObserved: true,
        objectiveSnapshots: [
            {
                bots: [
                    { playerIndex: 1, teamId: 'ALPHA', objectiveType: 'ESCORT', objectiveRole: 'GUARD', nearEscortTank: true },
                    { playerIndex: 2, teamId: 'BRAVO', objectiveType: 'ESCORT', objectiveRole: 'HUNTER', nearEscortTank: false },
                ],
                escort: { progress: 0.1, checkpointsReached: 0 },
                scoreboard: [
                    { playerIndex: 1, escortSeconds: 1, escortCheckpointContributions: 0, escortRepairHp: 0, escortRecoveries: 0, escortGuardKills: 0 },
                    { playerIndex: 2, escortTankDamage: 4, escortAttackKills: 0, escortTankDowns: 0, escortFinalDestructions: 0 },
                ],
            },
            {
                bots: [
                    { playerIndex: 1, teamId: 'ALPHA', objectiveType: 'ESCORT', objectiveRole: 'GUARD', nearEscortTank: true },
                    { playerIndex: 2, teamId: 'BRAVO', objectiveType: 'ESCORT', objectiveRole: 'HUNTER', nearEscortTank: false },
                ],
                escort: { progress: 0.2, checkpointsReached: 1 },
                scoreboard: [
                    { playerIndex: 1, escortSeconds: 3, escortCheckpointContributions: 1, escortRepairHp: 4, escortRecoveries: 1, escortGuardKills: 1 },
                    { playerIndex: 2, escortTankDamage: 24, escortAttackKills: 1, escortTankDowns: 0, escortFinalDestructions: 1 },
                ],
            },
        ],
    }]);
    assert.equal(activity.progressStatus, 'evidence-observed');
    assert.equal(activity.naturalOutcomeObserved, true);
    assert.equal(activity.evidence.progressDelta, 0.1);
    assert.equal(activity.evidence.checkpointsReached, 1);
    assert.equal(activity.evidence.alphaNearEscortSamples, 2);
    assert.equal(activity.evidence.alphaEscortSeconds, 2);
    assert.equal(activity.evidence.alphaRepairs, 4);
    assert.equal(activity.evidence.alphaRecoveries, 1);
    assert.equal(activity.evidence.alphaGuardKills, 1);
    assert.equal(activity.evidence.bravoTankDamage, 20);
    assert.equal(activity.evidence.bravoAttackKills, 1);
    assert.equal(activity.evidence.bravoFinalDestructions, 1);
});

test('objective outcome semantics count only natural outcomes and preserve a finite observation without a win', () => {
    const scenario = { validationTarget: BOT_VALIDATION_TARGETS.OBJECTIVE };
    const result = buildBotValidationOutcomeSemantics(scenario, [
        { reason: 'FLAG_DOMINATION', forced: false },
        { reason: 'ELIMINATION', forced: true },
    ], {
        observationRuns: 1,
        completedObservations: 1,
        forcedRoundNumbers: [2],
    });
    assert.equal(result.observationCompleted, true);
    assert.equal(result.naturalOutcomeObserved, true);
    assert.equal(result.naturalOutcomeRounds, 1);
    assert.equal(result.forcedRounds, 1);

    const ongoing = buildBotValidationOutcomeSemantics(scenario, [], {
        observationRuns: 1,
        completedObservations: 1,
    });
    assert.equal(ongoing.observationCompleted, true);
    assert.equal(ongoing.naturalOutcomeObserved, false);
    assert.equal(ongoing.naturalOutcomeRounds, 0);
});
