import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPlayingStateRuntimeAccess,
    PlayingStateSystem,
} from '../src/core/PlayingStateSystem.js';

/**
 * Stands in for Game during one playing tick with an active slow motion.
 * `entityManager.update` ends the round inside the tick, the way the entity pipeline
 * emits the round end: MatchFlowLifecycleController.onRoundEnd resets the time scale
 * to 1 and switches to ROUND_END. `_applyPlayingTimeScaleFromEffects` stands in for
 * PlanarAimAssistSystem with a SLOW_TIME effect still on a player.
 */
function createGame({ endRoundInTick }) {
    const game = {
        state: 'PLAYING',
        timeScale: 1,
        gameLoop: {
            renderFrameId: 1,
            setTimeScale(value) {
                game.timeScale = value;
            },
        },
        entityManager: {
            players: [],
            update() {
                if (!endRoundInTick) return;
                game.gameLoop.setTimeScale(1);
                game.state = 'ROUND_END';
            },
            updateLastRoundGhostPlayback() {},
        },
        _applyPlayingTimeScaleFromEffects() {
            game.gameLoop.setTimeScale(0.05);
        },
    };
    return game;
}

test('a round that ends inside a slow-motion tick leaves the clock at full speed', () => {
    const game = createGame({ endRoundInTick: true });
    new PlayingStateSystem(createPlayingStateRuntimeAccess(game)).update(1 / 60);

    assert.equal(game.state, 'ROUND_END');
    assert.equal(game.timeScale, 1, 'countdown and result board must not run in slow motion');
});

test('slow motion still applies while the round keeps running', () => {
    const game = createGame({ endRoundInTick: false });
    new PlayingStateSystem(createPlayingStateRuntimeAccess(game)).update(1 / 60);

    assert.equal(game.state, 'PLAYING');
    assert.equal(game.timeScale, 0.05);
});
