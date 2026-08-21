import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { createMatchStatePort } from '../src/shared/runtime/MatchStatePort.js';

function createHarness(modePath = 'normal') {
    const calls = [];
    const game = {
        state: GAME_STATE_IDS.MENU,
        settings: { localSettings: { modePath } },
        audio: {
            setMusicState(state) { calls.push(['music', state]); },
            setPaused(paused) { calls.push(['paused', paused]); },
        },
    };
    return { calls, game, port: createMatchStatePort(game) };
}

test('match state audio lifecycle selects menu, race, pause and result scenes', () => {
    const { calls, port } = createHarness('normal');

    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PAUSED });
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
    port.enterRoundEnd(3);
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.MENU });

    assert.deepEqual(calls, [
        ['paused', false], ['music', 'race'],
        ['paused', true],
        ['paused', false], ['music', 'race'],
        ['paused', false], ['music', 'results'],
        ['paused', false], ['music', 'menu'],
    ]);
});

test('fight mode selects the dedicated fight music scene', () => {
    const { calls, port } = createHarness('fight');
    port.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
    assert.deepEqual(calls, [['paused', false], ['music', 'fight']]);
});
