import assert from 'node:assert/strict';
import test from 'node:test';

import { InputManager } from '../src/core/InputManager.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { createMatchStatePort } from '../src/shared/runtime/MatchStatePort.js';

function createPendingInput(code = 'Escape') {
    const source = {
        clearCount: 0,
        clearInputState() {
            this.clearCount += 1;
        },
    };
    const input = Object.create(InputManager.prototype);
    input.keys = { [code]: true };
    input.justPressed = { [code]: true };
    input._continueIntent = true;
    input._playerSources = new Map([[0, source]]);
    return { input, source };
}

test('match state changes drop held and pending input from the previous state', () => {
    const { input, source } = createPendingInput();
    const game = { state: GAME_STATE_IDS.MENU, input };
    const port = createMatchStatePort(game);

    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });

    assert.deepEqual(input.keys, {}, 'a held menu key must not reach the first match tick');
    assert.deepEqual(input.justPressed, {}, 'a menu key edge must not pause the new match');
    assert.equal(input._continueIntent, false, 'a menu continue intent must not reach the match');
    assert.equal(source.clearCount, 1, 'the active player input source is reset too');

    input.keys.Space = true;
    input.justPressed.Space = true;
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PAUSED });
    assert.deepEqual(input.keys, {}, 'gameplay input must not remain held in the pause state');

    input.keys.KeyW = true;
    input.justPressed.KeyW = true;
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
    assert.deepEqual(input.keys, {}, 'input pressed during pause must not move after resume');

    input.keys.Enter = true;
    input.justPressed.Enter = true;
    port.enterRoundEnd(3);
    assert.deepEqual(input.keys, {}, 'round-end input starts from a clean state');

    input.keys.KeyD = true;
    input.justPressed.KeyD = true;
    port.applyRoundEndTransition({ nextState: GAME_STATE_IDS.MATCH_END, roundPause: 0 });
    assert.deepEqual(input.keys, {}, 'round and match transitions do not carry held actions');
    assert.equal(source.clearCount, 5);
});
