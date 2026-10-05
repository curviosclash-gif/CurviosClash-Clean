import assert from 'node:assert/strict';
import test from 'node:test';

import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { RuleBasedBotPolicy } from '../src/entities/ai/RuleBasedBotPolicy.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';

function createRoundOwner(bots) {
    const noop = { reset() {} };
    return {
        players: [],
        bots,
        _respawnSystem: noop,
        _huntScoring: noop,
        _roundOutcomeSystem: noop,
    };
}

function dirtyBotAI(botAI) {
    botAI.reactionTimer = 0.2;
    botAI.currentInput.useItem = 2;
    botAI.currentInput.yawLeft = true;
    botAI._decision.useItem = 2;
    botAI.state.recoveryActive = true;
    botAI.state.recoveryTimer = 1.1;
    botAI.state.turnCommitTimer = 0.8;
    botAI.state.targetPlayer = { index: 4 };
    botAI._stuckScore = 3;
    botAI._bounceStreak = 2;
    botAI._recoveryChainCount = 2;
    botAI._hasPositionSample = true;
}

function assertBotAIFresh(botAI) {
    assert.equal(botAI.reactionTimer, 0);
    assert.equal(botAI.currentInput.useItem, -1);
    assert.equal(botAI.currentInput.yawLeft, false);
    assert.equal(botAI._decision.useItem, -1);
    assert.equal(botAI.state.recoveryActive, false, 'a bot must not start the round inside a wall recovery');
    assert.equal(botAI.state.recoveryTimer, 0);
    assert.equal(botAI.state.turnCommitTimer, 0);
    assert.equal(botAI.state.targetPlayer, null);
    assert.equal(botAI._stuckScore, 0);
    assert.equal(botAI._bounceStreak, 0);
    assert.equal(botAI._recoveryChainCount, 0);
    assert.equal(botAI._hasPositionSample, false, 'the respawn teleport must not count as movement');
}

test('a round restart resets rule-based and hunt bots', () => {
    const ruleBased = new RuleBasedBotPolicy();
    const hunt = new HuntBotPolicy();
    dirtyBotAI(ruleBased._botAI);
    dirtyBotAI(hunt._fallbackPolicy._botAI);

    new EntitySpawnOps(createRoundOwner([{ player: {}, ai: ruleBased }, { player: {}, ai: hunt }])).spawnAll();

    assertBotAIFresh(ruleBased._botAI);
    assertBotAIFresh(hunt._fallbackPolicy._botAI);
});

test('a round restart replays the heuristic opening and keeps the match counters', () => {
    const heuristic = new HeuristicBotPolicy();
    const openingSeconds = heuristic._huntState.openingTimer;
    heuristic._huntState.openingTimer = 0;
    heuristic._huntState.movementIntent = 'retreat';
    heuristic._decisionCounters.updates = 42;

    new EntitySpawnOps(createRoundOwner([{ player: {}, ai: heuristic }])).spawnAll();

    assert.equal(heuristic._huntState.openingTimer, openingSeconds, 'every round opens with the fan-out manoeuvre');
    assert.equal(heuristic._huntState.movementIntent, 'search');
    assert.equal(heuristic._decisionCounters.updates, 42, 'match telemetry survives a round restart');
});

test('a full heuristic reset also restores the opening timer', () => {
    const heuristic = new HeuristicBotPolicy();
    const openingSeconds = heuristic._huntState.openingTimer;
    heuristic._huntState.openingTimer = 0;
    heuristic.reset();
    assert.equal(heuristic._huntState.openingTimer, openingSeconds);
});
