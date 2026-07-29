import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchGameStateUpdate } from '../src/core/GameStateUpdateDispatch.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

function createGame(state) {
    const calls = [];
    return {
        calls,
        state,
        entityManager: {},
        _updatePlayingState(dt) { calls.push(['playing', dt]); },
        _updatePausedState(dt) { calls.push(['paused', dt]); },
        _updateRoundEndState(dt) { calls.push(['round_end', dt]); },
        _updateMatchEndState(dt) { calls.push(['match_end', dt]); },
    };
}

test('game state update dispatch keeps paused and round-end paths out of playing updates', () => {
    const expectedByState = new Map([
        [GAME_STATE_IDS.PLAYING, 'playing'],
        [GAME_STATE_IDS.PAUSED, 'paused'],
        [GAME_STATE_IDS.ROUND_END, 'round_end'],
        [GAME_STATE_IDS.MATCH_END, 'match_end'],
    ]);

    for (const [state, expected] of expectedByState) {
        const game = createGame(state);
        dispatchGameStateUpdate(game, 0.25, true);
        assert.deepEqual(game.calls, [[expected, 0.25]]);
    }
});

test('interactive states wait for their runtime while terminal states continue', () => {
    const playing = createGame(GAME_STATE_IDS.PLAYING);
    const paused = createGame(GAME_STATE_IDS.PAUSED);
    const roundEnd = createGame(GAME_STATE_IDS.ROUND_END);

    dispatchGameStateUpdate(playing, 0.1, false);
    dispatchGameStateUpdate(paused, 0.1, false);
    dispatchGameStateUpdate(roundEnd, 0.1, false);

    assert.deepEqual(playing.calls, []);
    assert.deepEqual(paused.calls, []);
    assert.deepEqual(roundEnd.calls, [['round_end', 0.1]]);
});
