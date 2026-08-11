import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createArcadeObjectiveState,
    updateArcadeObjectiveState,
} from '../src/state/arcade/ArcadeObjectiveState.js';
import { applyArcadeSectorScore } from '../src/state/arcade/ArcadeScoreOps.js';
import { createArcadeRunState } from '../src/state/arcade/ArcadeRunState.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import {
    emitArcadeDamageEvent,
    emitArcadeEliminationEvents,
} from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';

const PARTICIPANTS = [
    { playerIndex: 0, label: 'Spieler 1', isBot: false, alive: true },
    { playerIndex: 1, label: 'Bot 2', isBot: true, alive: true },
    { playerIndex: 2, label: 'Bot 3', isBot: true, alive: true },
];

function objective(id, durationSec, scoreWeight) {
    return { id, label: id.replace(/_/g, ' '), durationSec, scoreWeight };
}

test('survive window requests sector completion only after its full duration', () => {
    const initial = createArcadeObjectiveState(objective('survive_window', 55, 1), { participants: PARTICIPANTS });
    const early = updateArcadeObjectiveState(initial, { type: 'tick', elapsed: 54.9 });
    const completed = updateArcadeObjectiveState(early, { type: 'tick', elapsed: 55 });

    assert.equal(early.completed, false);
    assert.equal(completed.completed, true);
    assert.equal(completed.shouldEnd, true);
});

test('bounty hunt marks one bot and completes only for that victim', () => {
    const initial = createArcadeObjectiveState(objective('bounty_hunt', 50, 1.2), { participants: PARTICIPANTS });
    const wrongTarget = updateArcadeObjectiveState(initial, { type: 'kill', victimIndex: 2 });
    const completed = updateArcadeObjectiveState(wrongTarget, { type: 'kill', victimIndex: 1 });

    assert.equal(initial.targetPlayerIndex, 1);
    assert.equal(initial.targetLabel, 'Bot 2');
    assert.equal(wrongTarget.completed, false);
    assert.equal(completed.completed, true);
    assert.equal(completed.shouldEnd, true);
});

test('clean sector loses its score bonus after a self collision without ending the round', () => {
    const initial = createArcadeObjectiveState(objective('clean_sector', 45, 1.15), { participants: PARTICIPANTS });
    const failed = updateArcadeObjectiveState(initial, { type: 'self_collision' });
    const finalized = updateArcadeObjectiveState(failed, { type: 'sector_complete', elapsed: 30 });
    const clean = updateArcadeObjectiveState(initial, { type: 'sector_complete', elapsed: 30 });

    assert.equal(failed.failed, true);
    assert.equal(failed.shouldEnd, false);
    assert.equal(finalized.completed, false);
    assert.equal(clean.completed, true);
    assert.equal(clean.shouldEnd, false);
});

test('hazard lane requires forty continuous seconds without a self collision', () => {
    const initial = createArcadeObjectiveState(objective('hazard_lane', 40, 1.3), { participants: PARTICIPANTS });
    const beforeHit = updateArcadeObjectiveState(initial, { type: 'tick', elapsed: 39 });
    const hit = updateArcadeObjectiveState(beforeHit, { type: 'self_collision' });
    const tooEarly = updateArcadeObjectiveState(hit, { type: 'tick', elapsed: 78 });
    const completed = updateArcadeObjectiveState(tooEarly, { type: 'tick', elapsed: 79 });

    assert.equal(tooEarly.completed, false);
    assert.equal(completed.completed, true);
    assert.equal(completed.shouldEnd, true);
});

test('objective score weight applies only to a successfully completed objective', () => {
    const createRun = (completed) => {
        const run = createArcadeRunState({ config: { enabled: true }, nowMs: 0 });
        run.completedSectors = 1;
        run.encounterSequence = [{ templateId: 'sector_intro', objectiveId: 'hazard_lane' }];
        run.objectiveState = {
            sectorIndex: 1,
            objectiveId: 'hazard_lane',
            completed,
            failed: !completed,
            scoreWeight: 1.3,
        };
        return run;
    };
    const payload = { duration: 0, selfCollisions: 1, itemUses: 1 };
    const failed = applyArcadeSectorScore(createRun(false), payload, { nowMs: 1 });
    const completed = applyArcadeSectorScore(createRun(true), payload, { nowMs: 1 });

    assert.equal(completed.score.lastSectorPoints, Math.round(failed.score.lastSectorPoints * 1.3));
    assert.equal(completed.lastSectorSummary.objectiveMultiplierApplied, 1.3);
});

test('round outcome request uses the regular authoritative round-end resolution', () => {
    const human = { index: 0, alive: true };
    const bot = { index: 1, alive: true };
    const system = new RoundOutcomeSystem({ getPlayers: () => [human, bot] });

    assert.equal(system.requestRoundEnd({ winner: human, reason: 'ARCADE_OBJECTIVE' }), true);
    assert.deepEqual(system.resolve(), {
        shouldEnd: true,
        winner: human,
        reason: 'ARCADE_OBJECTIVE',
        parcours: null,
    });
    system.reset();
    assert.equal(system.resolve().shouldEnd, false);
});

test('human kill events identify the victim required by bounty hunt', () => {
    const events = [];
    const human = { index: 0, isBot: false };
    const bot = { index: 1, isBot: true };
    const owner = { players: [human, bot], onArcadeGameplayEvent: (event) => events.push(event) };

    emitArcadeEliminationEvents(owner, bot, 'TRAIL_OTHER', { killer: human });

    assert.deepEqual(events, [{ type: 'kill', playerIndex: 0, victimIndex: 1, count: 1 }]);
});

test('a non-lethal own-trail hit invalidates clean objectives immediately', () => {
    const events = [];
    const human = { index: 0, isBot: false, hp: 66, maxHp: 100 };
    const owner = { players: [human], onArcadeGameplayEvent: (event) => events.push(event) };

    emitArcadeDamageEvent(owner, {
        target: human,
        cause: 'TRAIL_SELF',
        damageResult: { applied: 34 },
    });

    assert.deepEqual(events.map((entry) => entry.type), ['damage', 'self_collision']);
});

test('runtime forwards a completed bounty objective to the round-end request port', () => {
    const requests = [];
    const runtime = new ArcadeRunRuntime({
        now: () => 1000,
        getObjectiveParticipants: () => PARTICIPANTS,
        requestRoundEnd: (request) => {
            requests.push(request);
            return true;
        },
    });
    runtime.configure({ arcade: { enabled: true, sectorCount: 2 } });
    runtime.startRun({
        encounterPlan: {
            sequence: [{
                sectorNumber: 1,
                templateId: 'sector_pressure',
                objectiveId: 'bounty_hunt',
                mapKey: 'standard',
            }],
        },
    });

    runtime.applyGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 1, count: 1 });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].reason, 'ARCADE_OBJECTIVE');
    assert.equal(requests[0].objectiveId, 'bounty_hunt');
    assert.equal(runtime.getHudState().objectiveState.completed, true);
    assert.equal(Object.hasOwn(runtime, '_objectiveState'), false);
});

test('production arcade support resolves the human winner for objective round end', () => {
    const requests = [];
    const human = { index: 0, isBot: false, alive: true };
    const bot = { index: 1, isBot: true, alive: true };
    const entityManager = {
        players: [human, bot],
        humanPlayers: [human],
        gameModeStrategy: {},
        onArcadeGameplayEvent: null,
        requestRoundEnd(request) {
            requests.push(request);
            return true;
        },
    };
    const runtimeState = {
        runtimeConfig: {
            arcade: { enabled: true, sectorCount: 2 },
            session: { mapKey: 'standard', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship5' } },
        },
        entityManager,
    };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => runtimeState });
    support.syncRuntimeConfig();
    support._preparedEncounterPlan = {
        sequence: [{
            sectorNumber: 1,
            templateId: 'sector_pressure',
            objectiveId: 'bounty_hunt',
            mapKey: 'standard',
        }],
    };
    support.startRunIfEnabled();

    entityManager.onArcadeGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 1, count: 1 });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].winner, human);
    assert.equal(requests[0].reason, 'ARCADE_OBJECTIVE');
});
