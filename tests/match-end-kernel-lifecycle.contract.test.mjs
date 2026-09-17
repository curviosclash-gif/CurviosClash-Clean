import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoundStateHarness } from './helpers/round-state-tick-harness.mjs';
import { wireInitializedMatchRuntime } from '../src/state/MatchSessionFactory.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { MATCH_END_INPUT_LOCK_SECONDS } from '../src/state/RoundEndInputLockOps.js';

test('match-end Escape reaches the kernel lifecycle and is consumed exactly once', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    // The session factory can only signal round end; the match-end decision is derived
    // downstream by the round state controller.
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.game.state = 'MATCH_END';
    harness.input.press('Escape');

    harness.system.updateMatchEnd(0);

    assert.equal(harness.kernel.lifecycle, 'match_end', 'kernel must learn about the match end');
    assert.equal(harness.input.callCount('Escape'), 1, 'Escape must be read by exactly one owner');
    assert.equal(harness.calls.returnToMenu, 1, 'Escape must return to the menu');
});

test('match-end Enter restarts the match and is consumed exactly once', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.game.state = 'MATCH_END';
    // The match-end board opens with an input lock; Enter counts once it has run out.
    harness.system.updateMatchEnd(MATCH_END_INPUT_LOCK_SECONDS);
    harness.input.press('Enter');

    harness.system.updateMatchEnd(0);

    assert.equal(harness.kernel.lifecycle, 'match_end');
    assert.equal(harness.input.callCount('Enter'), 2, 'Enter must be read by exactly one owner per frame');
    assert.equal(harness.calls.startMatch, 1, 'Enter must restart the match');
});

test('match-end Enter is swallowed while the board input lock runs', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.game.state = 'MATCH_END';
    harness.input.press('Enter');

    harness.system.updateMatchEnd(1 / 60);

    assert.equal(harness.calls.startMatch, 0, 'the lock must also cover Enter');
});

test('arcade round state controllers keep owning the match-end keys', () => {
    const harness = createRoundStateHarness({ roundPause: 3 });
    const arcadeInputs = [];
    harness.game.roundStateController = {
        isArcadeRoundStateController: true,
        deriveMatchEndTick(inputs) {
            arcadeInputs.push(inputs);
            return { action: 'WAIT', shouldUpdateCameras: false };
        },
    };
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.game.state = 'MATCH_END';

    harness.system.updateMatchEnd(0);

    assert.equal(arcadeInputs.length, 1, 'arcade controller must receive the match-end tick');
    assert.equal(harness.kernel.lifecycle, 'round_end', 'arcade runs must not be driven by the kernel');
});

test('round outcomes carry no match state, so the session factory only signals round end', () => {
    const outcomeSystem = new RoundOutcomeSystem({
        getPlayers: () => [
            { index: 0, alive: false, isBot: false, entitySlotActive: true },
            { index: 1, alive: true, isBot: true, entitySlotActive: true },
        ],
        isRespawnPending: () => false,
    });
    const outcome = outcomeSystem.resolve();

    assert.equal(outcome.shouldEnd, true);
    assert.equal(
        Object.prototype.hasOwnProperty.call(outcome, 'state'),
        false,
        'the round outcome must not be mistaken for a match state carrier'
    );

    const entityManager = {
        players: [{ index: 0, score: 5 }, { index: 1, score: 0 }],
        recorder: null,
        runtimeConfig: null,
    };
    const renderer = {
        cameras: [],
        cameraModes: [],
        createCamera() {},
        viewportSystem: { setNetworkMode() {} },
        precompileMatchScene() {},
    };
    const forwarded = [];
    const wired = wireInitializedMatchRuntime({
        renderer,
        initializedMatch: { session: { entityManager, numHumans: 1 } },
        onRoundEnd: (winner, forwardedOutcome) => forwarded.push({ winner, forwardedOutcome }),
    });

    entityManager.onRoundEnd(outcome.winner, outcome);

    assert.equal(wired.kernel.lifecycle, 'round_end');
    assert.equal(forwarded.length, 1, 'the downstream round-end handler must still run');
    wired.kernel.dispose();
});
