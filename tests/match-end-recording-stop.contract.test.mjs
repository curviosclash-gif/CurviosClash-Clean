import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { dispatchGameStateUpdate } from '../src/core/GameStateUpdateDispatch.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { createFourPlayerPlanarRuntimePort } from '../src/four-player-planar/FourPlayerPlanarRuntimePort.js';

// src/core/main.js cannot be imported from Node: it bootstraps the browser app at module
// scope and pulls in a CSS asset. The wiring between the match-end state tick and the
// cinematic recording stop is therefore asserted on the source of the Game class.
const MAIN_SOURCE = readFileSync(new URL('../src/core/main.js', import.meta.url), 'utf8');

function readMethodBody(source, methodName) {
    const signatureIndex = source.indexOf(`\n    ${methodName}(`);
    assert.notEqual(signatureIndex, -1, `main.js must define ${methodName}()`);
    const bodyStart = source.indexOf('{', signatureIndex);
    assert.notEqual(bodyStart, -1, `${methodName}() must have a body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
        if (character === '{') depth += 1;
        if (character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(bodyStart, index + 1);
        }
    }
    throw new Error(`${methodName}() body is not balanced`);
}

test('the round outcome never carries a game state id', () => {
    const outcomeSystem = new RoundOutcomeSystem();
    outcomeSystem.requestRoundEnd({ winner: { index: 1 }, reason: 'OBJECTIVE' });

    const outcome = outcomeSystem.resolve();

    assert.equal(outcome.shouldEnd, true);
    assert.equal(
        Object.prototype.hasOwnProperty.call(outcome, 'state'),
        false,
        'RoundOutcomeSystem.resolve reports the round end only, never the match end'
    );
});

test('the cinematic recording stop is not gated on the round outcome state', () => {
    const roundEndBody = readMethodBody(MAIN_SOURCE, '_onRoundEnd');

    assert.equal(
        roundEndBody.includes('match_completed'),
        false,
        '_onRoundEnd is never called in production (only dev/training calls it) and the round '
        + 'outcome carries no state field, so the match-end recording stop must not live here'
    );
    assert.equal(
        roundEndBody.includes(`outcome?.state === GAME_STATE_IDS.${'MATCH_END'}`),
        false,
        'the round outcome has no state field, so this branch can never be taken'
    );
});

test('the match-end state tick triggers the cinematic recording stop', () => {
    const matchEndBody = readMethodBody(MAIN_SOURCE, '_updateMatchEndState');
    const stopBody = readMethodBody(MAIN_SOURCE, '_stopCinematicReplayRecordingAtMatchEnd');

    assert.equal(
        matchEndBody.includes('_stopCinematicReplayRecordingAtMatchEnd()'),
        true,
        'MATCH_END is the first runtime state that knows the match is decided'
    );
    assert.equal(
        stopBody.includes('isCinematicReplayRecording'),
        true,
        'only a running cinematic replay recording may be stopped'
    );
    assert.equal(
        stopBody.includes(`type: 'match_completed'`),
        true,
        'the queued replay must be tagged as a completed match'
    );
});

test('the game start hands the coordinator answer back to its caller', () => {
    const startMatchBody = readMethodBody(MAIN_SOURCE, 'startMatch');

    assert.equal(
        startMatchBody.includes('return this.runtimeCoordinator.startMatch();'),
        true,
        'a rejected start resolves to false and the four-player module needs that answer to '
        + 'roll back the settings it staged for the match'
    );
});

test('the four player runtime port forwards the runtime start answer', async () => {
    const answers = [];
    const port = createFourPlayerPlanarRuntimePort({
        getRuntime: () => ({
            startMatch: () => Promise.resolve(false),
        }),
    });

    answers.push(await port.startMatch());

    assert.deepEqual(answers, [false]);
});

test('the MATCH_END dispatch reaches the match-end state tick, not the round-end hook', () => {
    const calls = [];
    const game = {
        state: GAME_STATE_IDS.MATCH_END,
        entityManager: {},
        _updatePlayingState: () => calls.push('playing'),
        _updatePausedState: () => calls.push('paused'),
        _updateRoundEndState: () => calls.push('round_end'),
        _updateMatchEndState: () => calls.push('match_end'),
        _onRoundEnd: () => calls.push('on_round_end'),
    };

    dispatchGameStateUpdate(game, 1 / 60, true);

    assert.deepEqual(calls, ['match_end']);
});
