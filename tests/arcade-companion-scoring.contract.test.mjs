import test from 'node:test';
import assert from 'node:assert/strict';

import { ARCADE_COMPANION_KILL_SCORE_FACTOR } from '../src/shared/contracts/ArcadeCompanionContract.js';
import { emitArcadeEliminationEvents } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { applyComboAction } from '../src/state/arcade/ArcadeScoreOps.js';
import { createArcadeObjectiveState } from '../src/state/arcade/ArcadeObjectiveState.js';
import { buildObjectiveParticipants } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';

const human = { index: 0, isBot: false, teamId: 'ALPHA', alive: true };
const companion = { index: 4, isBot: true, isArcadeCompanion: true, teamId: 'ALPHA', alive: true };
const enemy = { index: 1, isBot: true, teamId: 'BRAVO', alive: true };
const rival = { index: 2, isBot: true, teamId: 'BRAVO', alive: true };

/** Stands for EntityManager as the arcade event source: it records what reaches the run. */
function eventOwner() {
    const events = [];
    return { events, players: [human, enemy, rival, companion], runtimeConfig: { arcade: { enabled: true, runType: 'gauntlet' } }, onArcadeGameplayEvent: (event) => events.push(event) };
}

test('a companion kill reaches the run flagged with the half score factor, a squad kill does not', () => {
    const owner = eventOwner();
    emitArcadeEliminationEvents(owner, enemy, 'PROJECTILE', { killer: companion });
    emitArcadeEliminationEvents(owner, companion, 'PROJECTILE', { killer: rival });
    assert.equal(owner.events.length, 1, 'only the companion kill counts');
    assert.deepEqual(
        [owner.events[0].type, owner.events[0].victimIndex, owner.events[0].companion, owner.events[0].scoreFactor],
        ['kill', enemy.index, true, ARCADE_COMPANION_KILL_SCORE_FACTOR],
    );
});

test('a companion kill grows the combo at half the rate of a human kill', () => {
    const config = { maxMultiplier: 8 };
    let byHuman = { combo: 0, comboAccum: 0 };
    let byCompanion = { combo: 0, comboAccum: 0 };
    for (let i = 0; i < 4; i += 1) {
        byHuman = applyComboAction(byHuman, { type: 'kill', nowMs: i }, config);
        byCompanion = applyComboAction(byCompanion, { type: 'kill', nowMs: i, companion: true, scoreFactor: ARCADE_COMPANION_KILL_SCORE_FACTOR }, config);
    }
    assert.equal(byHuman.combo, 4);
    assert.equal(byCompanion.combo, 2);
});

test('the bounty target is always an enemy, never a companion', () => {
    const entityManager = { players: [human, { ...companion, index: 1 }, { ...enemy, index: 2 }] };
    const participants = buildObjectiveParticipants(entityManager);
    assert.equal(participants.find((entry) => entry.playerIndex === 1).isCompanion, true);
    const state = createArcadeObjectiveState({ id: 'bounty_hunt', durationSec: 50 }, { participants });
    assert.equal(state.targetPlayerIndex, 2, 'the lowest enemy index is the bounty, the companion is skipped');
});

test('a run with companions keeps scaled enemies but never enters the leaderboard', () => {
    const base = { runId: 'r1', runType: 'gauntlet', vehicleId: 'ship5', profile: { level: 3 } };
    const solo = createArcadeRankContext(base);
    const helped = createArcadeRankContext({ ...base, companionCount: 2 });
    assert.equal(solo.ranked, true);
    assert.equal(helped.ranked, false, 'no leaderboard entry and no tier unlock');
    assert.equal(helped.strengthScaled, true, 'the squad still follows the player vehicle');
    assert.equal(resolveArcadeRankKey(helped), '');
    assert.deepEqual(helped.botStrength, solo.botStrength);
});

test('a companion destroying a map unit counts for the sector targets, its colour progress does not', async () => {
    const { rewardMapUnitDestruction } = await import('../src/entities/systems/map-units/MapUnitRewardOps.js');
    const { createArcadeColorProgress, trackArcadeColorEvent } = await import('../src/shared/contracts/ArcadeColorProgressContract.js');
    const owner = eventOwner();
    const unit = { id: 'tank_1', deaths: 1, definition: { kind: 'tank', loot: [] }, position: { y: 0 }, groundPosition: { x: 0, z: 0 } };
    rewardMapUnitDestruction({ entityManager: owner }, unit, companion);
    assert.deepEqual(owner.events.map((event) => [event.type, event.companion]), [['unit_destroyed', true]]);
    const progress = createArcadeColorProgress({ runType: 'gauntlet', humanIndices: [0, 4] });
    for (let i = 0; i < 12; i += 1) trackArcadeColorEvent(progress, { type: 'kill', playerIndex: 4, count: 1, companion: true });
    assert.equal(progress.players[4]?.kills ?? 0, 0, 'companion kills never unlock colours');
});
