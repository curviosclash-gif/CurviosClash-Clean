import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoundStateHarness } from './helpers/round-state-tick-harness.mjs';
import { ROUND_END_INPUT_LOCK_SECONDS } from '../src/state/RoundEndInputLockOps.js';

test('round-end Enter reaches the round state tick and is consumed exactly once', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    // The board opens with a short input lock, so Enter only counts after it.
    harness.system.updateRoundEnd(ROUND_END_INPUT_LOCK_SECONDS);
    harness.input.press('Enter');

    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.input.callCount('Enter'), 2, 'Enter must be read by exactly one owner per frame');
    assert.equal(harness.calls.restartRound, 1, 'Enter must skip the round-end countdown');
});

test('round-end Enter is swallowed while the board input lock runs', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.input.press('Enter');

    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.calls.restartRound, 0, 'the lock must also cover Enter');
});

test('round-end Escape returns to the menu and is consumed exactly once', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.input.press('Escape');

    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.input.callCount('Escape'), 1, 'Escape must be read by exactly one owner');
    assert.equal(harness.calls.returnToMenu, 1, 'Escape must leave the round-end countdown');
});

test('round-end countdown without input keeps ticking the shared round pause down', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    harness.system.updateRoundEnd(0.5);

    assert.equal(harness.calls.restartRound, 0);
    assert.ok(harness.game.roundPause < 3, 'round pause must decrease');
    assert.ok(harness.game.roundPause > 2, 'round pause must decrease by one step only');
});

test('interactive round-end ticks reuse one result object instead of allocating per frame', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    const first = harness.adapter.tick(1 / 60, 1);
    const second = harness.adapter.tick(1 / 60, 2);

    assert.ok(first, 'the interactive round-end tick must report its derived step');
    assert.equal(first, second, 'the round-state result object must be reused across frames');
    assert.equal(second.action, 'WAIT');
    assert.equal(second.lifecycle, 'round_end');
});

test('arcade round state controllers keep owning the round-end keys', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    const arcadeInputs = [];
    harness.game.roundStateController = {
        isArcadeRoundStateController: true,
        deriveRoundEndTick(inputs) {
            arcadeInputs.push(inputs);
            return { action: 'WAIT', nextRoundPause: 3, shouldUpdateCameras: false, countdownMessageSub: null };
        },
    };
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.input.press('Enter');

    harness.system.updateRoundEnd(1 / 60);

    assert.equal(arcadeInputs.length, 1, 'arcade controller must receive the round-end tick');
    assert.equal(arcadeInputs[0].enterPressed, true, 'arcade controller must see the key press');
    assert.equal(harness.input.callCount('Enter'), 1, 'Enter must be read by exactly one owner');
});
