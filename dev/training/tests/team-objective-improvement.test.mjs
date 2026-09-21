import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HEURISTIC_PROFILE_FIELD_BOUNDS } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import {
    advanceTeamObjectiveSearchState,
    clampTeamObjectiveProfile,
    createInitialTeamObjectiveState,
    TEAM_OBJECTIVE_HOLDOUT_SEEDS,
    TEAM_OBJECTIVE_STATE_PATH,
    TEAM_OBJECTIVE_TRAINING_SEEDS,
    TEAM_OBJECTIVE_TUNABLE_FIELDS,
} from '../scripts/team-objective-improvement-loop.mjs';
import {
    combineTeamObjectiveResults,
    createTeamObjectiveMatchTracker,
    isTeamObjectiveCandidateBetter,
} from '../scripts/team-objective-improvement-metrics.mjs';
import {
    classifyTeamObjectiveSearch,
    runTeamObjectiveSearch,
} from '../scripts/team-objective-improvement-runner.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

function position(x, y = 0, z = 0) {
    return { x, y, z };
}

test('team objective match tracker scores assigned flag pressure', () => {
    const player = {
        index: 2,
        isBot: true,
        alive: true,
        teamId: 'ALPHA',
        flagBotRole: 'ATTACKER',
        flagBotTargetId: 'bravo_1',
        position: position(10),
    };
    const flag = {
        id: 'bravo_1',
        teamId: 'BRAVO',
        hp: 150,
        maxHp: 300,
        position: position(10),
    };
    const entityManager = {
        arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -100, maxZ: 100 } },
        bots: [{ player }],
        players: [player],
        _flagObjectiveSystem: { flags: [flag] },
        getHuntScoreboard: () => [{ playerIndex: 2, flagCaptures: 0, deaths: 0, kills: 0 }],
    };
    const tracker = createTeamObjectiveMatchTracker({ teamId: 'ALPHA', objective: 'FLAGS' });
    tracker.sample(entityManager);
    const result = tracker.summarize(entityManager, 10);

    assert.equal(result.assignmentRate, 1);
    assert.equal(result.proximityRate, 1);
    assert.equal(result.attackProgress, 0.5);
    assert.equal(result.score, 100);
});

test('combined gate requires aggregate gain without sacrificing either objective', () => {
    const current = combineTeamObjectiveResults([
        { objective: 'FLAGS', score: 10, assignmentRate: 1, proximityRate: 0.5 },
        { objective: 'ESCORT', score: 10, assignmentRate: 1, proximityRate: 0.5 },
    ]);
    const improved = combineTeamObjectiveResults([
        { objective: 'FLAGS', score: 11, assignmentRate: 1, proximityRate: 0.5 },
        { objective: 'ESCORT', score: 11, assignmentRate: 1, proximityRate: 0.5 },
    ]);
    const regressed = combineTeamObjectiveResults([
        { objective: 'FLAGS', score: 8, assignmentRate: 1, proximityRate: 0.5 },
        { objective: 'ESCORT', score: 13, assignmentRate: 1, proximityRate: 0.5 },
    ]);

    assert.equal(isTeamObjectiveCandidateBetter(improved, current), true);
    assert.equal(isTeamObjectiveCandidateBetter(regressed, current), false);
});

test('team objective search uses bounded fields, disjoint seeds, and temp state', () => {
    assert.equal(path.relative(os.tmpdir(), TEAM_OBJECTIVE_STATE_PATH).startsWith('..'), false);
    assert.equal(
        TEAM_OBJECTIVE_TRAINING_SEEDS.some((seed) => TEAM_OBJECTIVE_HOLDOUT_SEEDS.includes(seed)),
        false
    );
    const clamped = clampTeamObjectiveProfile(Object.fromEntries(
        TEAM_OBJECTIVE_TUNABLE_FIELDS.map((field) => [field, HEURISTIC_PROFILE_FIELD_BOUNDS[field][1] + 10])
    ));
    for (const field of TEAM_OBJECTIVE_TUNABLE_FIELDS) {
        assert.equal(clamped[field], HEURISTIC_PROFILE_FIELD_BOUNDS[field][1]);
    }
});

test('bounded state advances fields and only plateaus after the fine search step', () => {
    const state = createInitialTeamObjectiveState();
    for (let index = 0; index < TEAM_OBJECTIVE_TUNABLE_FIELDS.length; index += 1) {
        advanceTeamObjectiveSearchState(state, false);
    }
    assert.equal(state.stepIndex, 1);
    assert.equal(state.plateauRounds, 0);
    for (let index = 0; index < TEAM_OBJECTIVE_TUNABLE_FIELDS.length; index += 1) {
        advanceTeamObjectiveSearchState(state, false);
    }
    assert.equal(state.plateauRounds, 1);
});

test('runner stops on plateau and propagates iteration errors', () => {
    let state = { plateauRounds: 0 };
    const plateau = runTeamObjectiveSearch({
        readState: () => state,
        executeIteration: () => {
            state = { plateauRounds: 2 };
            return { status: 0 };
        },
        maxIterations: 3,
        timeoutMs: 100,
        now: () => 0,
    });
    assert.equal(plateau.outcome, 'plateau');
    assert.equal(plateau.iterations, 1);
    assert.equal(classifyTeamObjectiveSearch(state), 'plateau');

    state = { plateauRounds: 0 };
    const failed = runTeamObjectiveSearch({
        readState: () => state,
        executeIteration: () => ({ status: 1 }),
        maxIterations: 3,
        timeoutMs: 100,
        now: () => 0,
    });
    assert.equal(failed.outcome, 'error');
});

test('loop keeps candidate state external and evaluates both team objectives and sides', () => {
    const source = fs.readFileSync(
        path.join(TEST_DIR, '../scripts/team-objective-improvement-loop.mjs'),
        'utf8'
    );
    assert.match(source, /OBJECTIVES = Object\.freeze\(\['FLAGS', 'ESCORT'\]\)/);
    assert.match(source, /CANDIDATE_TEAMS = Object\.freeze\(\[TEAM_IDS\.ALPHA, TEAM_IDS\.BRAVO\]\)/);
    assert.match(source, /mode: '2p'/);
    assert.match(source, /entityManager\.spawnAll\(\)/);
    assert.doesNotMatch(source, /writeFileSync\([^\n]*src\//);
});
