// Contract: "continue on any key" at round end and match end, including the input lock.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInteractiveMatchKernel, createHeadlessMatchKernel, createHeadlessInputAdapter } from '../src/state/MatchKernel.js';
import { createMatchKernelInteractiveAdapter } from '../src/core/MatchKernelInteractiveAdapter.js';
import { dispatchGameStateUpdate } from '../src/core/GameStateUpdateDispatch.js';
import { RoundStateTickSystem } from '../src/state/RoundStateTickSystem.js';
import { createRoundStateController } from '../src/state/RoundStateController.js';
import { createArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import {
    MATCH_END_INPUT_LOCK_SECONDS,
    ROUND_END_INPUT_LOCK_SECONDS,
} from '../src/state/RoundEndInputLockOps.js';
import {
    deriveMatchEndTickStep,
    deriveRoundEndTickStep,
} from '../src/state/RoundStateControllerOps.js';

/** Input stub with the continue intent of the real InputManager: one frame, then consumed. */
function createContinueInput() {
    const pressed = new Set();
    let continueIntent = false;
    const stats = { clearContinue: 0, continueReads: 0 };
    return {
        stats,
        press(key) {
            if (key === 'Continue') continueIntent = true;
            else pressed.add(key);
        },
        wasPressed(key) {
            if (key === 'Continue') {
                stats.continueReads += 1;
                const value = continueIntent;
                continueIntent = false;
                return value;
            }
            if (!pressed.has(key)) return false;
            pressed.delete(key);
            return true;
        },
        clearContinueIntent() {
            stats.clearContinue += 1;
            continueIntent = false;
        },
        isDown: () => false,
        getPlayerInput: () => null,
    };
}

function createArcadeControllerStub() {
    return createArcadeRoundStateController({
        baseController: createRoundStateController({ defaultRoundPause: 3 }),
        arcadeRuntime: {
            isEnabled: () => false,
            getPhase: () => 'running',
            isIntermissionPaused: () => false,
            beginNextSector() {},
        },
    });
}

function createHarness({
    roundPause = 3,
    sessionSnapshot = null,
    arcadeSurface = null,
    withoutKernel = false,
} = {}) {
    const input = createContinueInput();
    const calls = { returnToMenu: 0, restartRound: 0, startMatch: 0 };
    const state = { kernel: null, adapter: null, sessionSnapshot };

    const game = {
        state: 'ROUND_END',
        input,
        roundPause,
        roundStateController: withoutKernel
            ? createArcadeControllerStub()
            : createRoundStateController({ defaultRoundPause: 3 }),
        gameLoop: { renderFrameId: 1 },
        runtimeCoordinator: arcadeSurface
            ? { getArcadeMenuSurfaceState: () => arcadeSurface }
            : undefined,
        entityManager: {
            updateCameras() {},
            updateLastRoundGhostPlayback() {},
        },
        matchFlowUiController: { applyMatchUiState() {} },
    };
    game.playingStateSystem = { getKernelAdapter: () => state.adapter };

    const system = new RoundStateTickSystem({
        game,
        lifecyclePort: {
            returnToMenu() { calls.returnToMenu += 1; },
            restartRound() { calls.restartRound += 1; },
        },
        runtimeIntentPort: {
            startMatch() { calls.startMatch += 1; },
        },
        getSessionSnapshot: () => state.sessionSnapshot,
    });

    const harness = {
        input,
        game,
        system,
        calls,
        get kernel() { return state.kernel; },
        get adapter() { return state.adapter; },
        /** A new match builds a new kernel (MatchSessionFactory does the same). */
        replaceKernel() {
            if (withoutKernel) return null;
            state.kernel = createInteractiveMatchKernel({ simPorts: {} });
            state.kernel.boot({ roundIndex: 0 });
            state.adapter = createMatchKernelInteractiveAdapter({ game, kernel: state.kernel });
            return state.kernel;
        },
        setSessionSnapshot(next) { state.sessionSnapshot = next; },
    };
    harness.replaceKernel();
    return harness;
}

function stepRoundEnd(harness, seconds, stepSize = 0.05) {
    let left = seconds;
    while (left > 1e-9) {
        const dt = Math.min(stepSize, left);
        harness.system.updateRoundEnd(dt);
        left -= dt;
    }
}

function stepMatchEnd(harness, seconds, stepSize = 0.05) {
    let left = seconds;
    while (left > 1e-9) {
        const dt = Math.min(stepSize, left);
        harness.system.updateMatchEnd(dt);
        left -= dt;
    }
}

test('round end clears a pending continue intent when the board opens', () => {
    const harness = createHarness();
    harness.input.press('Continue');
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    harness.system.updateRoundEnd(1 / 60);

    assert.ok(harness.input.stats.clearContinue >= 1, 'the board must drop the pending press');
    assert.equal(harness.calls.restartRound, 0, 'a carried-over press must not skip the countdown');
    assert.equal(harness.input.stats.continueReads, 1, 'continue must be read exactly once per frame');
});

test('continue during the round-end lock has no effect, not even afterwards', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    harness.system.updateRoundEnd(0.1);
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.1);
    assert.equal(harness.calls.restartRound, 0, 'the lock must swallow the press');

    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS);
    assert.equal(harness.calls.restartRound, 0, 'a swallowed press must not act later');
});

test('continue after the round-end lock skips the countdown', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS);
    assert.equal(harness.calls.restartRound, 0, 'the countdown must still be running');

    harness.input.press('Continue');
    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.calls.restartRound, 1, 'continue must start the next round');
});

test('round-end lock ends after 0.75 s even with uneven frame times', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    for (const dt of [0.2, 0.05, 0.3, 0.19]) harness.system.updateRoundEnd(dt);
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.01);
    assert.equal(harness.calls.restartRound, 0, '0.74 s of frames must still be locked');

    harness.system.updateRoundEnd(0.02);
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.01);
    assert.equal(harness.calls.restartRound, 1, 'past 0.75 s the press must count');
});

test('escape beats continue and works during the lock', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });

    harness.input.press('Continue');
    harness.input.press('Escape');
    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.calls.returnToMenu, 1, 'the menu path must work without waiting');
    assert.equal(harness.calls.restartRound, 0, 'escape must beat continue');
});

test('the gamepad pause button reaches the menu through wasPressed(Escape)', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    // The real InputManager reports the bound PAUSE button as Escape.
    harness.input.press('Escape');

    harness.system.updateRoundEnd(1 / 60);

    assert.equal(harness.calls.returnToMenu, 1);
});

test('the round-end countdown still runs down without any input', () => {
    const harness = createHarness({ roundPause: 1 });
    harness.kernel.signalRoundEnd({ roundPause: 1 });

    stepRoundEnd(harness, 0.9, 0.1);
    assert.equal(harness.calls.restartRound, 0, 'the countdown must not be shortened');

    stepRoundEnd(harness, 0.2, 0.1);
    assert.equal(harness.calls.restartRound, 1, 'the countdown must still start the round');
});

test('match end waits 1.5 s and then restarts the match on continue', () => {
    const harness = createHarness();
    harness.kernel.signalMatchEnd();

    stepMatchEnd(harness, ROUND_END_INPUT_LOCK_SECONDS);
    harness.input.press('Continue');
    harness.system.updateMatchEnd(0.05);
    assert.equal(harness.calls.startMatch, 0, 'the match lock is longer than the round lock');

    stepMatchEnd(harness, MATCH_END_INPUT_LOCK_SECONDS);
    harness.input.press('Continue');
    harness.system.updateMatchEnd(0.05);
    assert.equal(harness.calls.startMatch, 1, 'continue must restart the match');
});

test('network clients never start a round or a match with continue', () => {
    const roundHarness = createHarness({ sessionSnapshot: { isNetworkSession: true, isHost: false } });
    roundHarness.kernel.signalRoundEnd({ roundPause: 3 });
    stepRoundEnd(roundHarness, ROUND_END_INPUT_LOCK_SECONDS);
    roundHarness.input.press('Continue');
    roundHarness.system.updateRoundEnd(0.05);
    assert.equal(roundHarness.calls.restartRound, 0, 'a client must not skip the countdown');

    const matchHarness = createHarness({ sessionSnapshot: { isNetworkSession: true, isHost: false } });
    matchHarness.kernel.signalMatchEnd();
    stepMatchEnd(matchHarness, MATCH_END_INPUT_LOCK_SECONDS);
    matchHarness.input.press('Continue');
    matchHarness.system.updateMatchEnd(0.05);
    assert.equal(matchHarness.calls.startMatch, 0, 'a client must not restart the match');

    matchHarness.input.press('Escape');
    matchHarness.system.updateMatchEnd(0.05);
    assert.equal(matchHarness.calls.returnToMenu, 1, 'the menu path stays open for clients');
});

test('the five fronts advantage choice ignores continue', () => {
    const harness = createHarness({
        arcadeSurface: { runType: 'arena_waves', phase: 'upgrade' },
    });
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS);

    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.05);

    assert.equal(harness.calls.restartRound, 0, 'the advantage choice needs its own buttons');
});

test('the arcade intermission ignores continue and enter', () => {
    const controller = createArcadeRoundStateController({
        baseController: createRoundStateController({ defaultRoundPause: 3 }),
        arcadeRuntime: {
            isEnabled: () => true,
            getPhase: () => 'intermission',
            isIntermissionPaused: () => false,
            beginNextSector() {},
        },
    });

    const tick = controller.deriveRoundEndTick({
        dt: 1 / 60,
        roundPause: 3,
        enterPressed: true,
        continuePressed: true,
        escapePressed: false,
        inputLockRemaining: 0,
    });

    assert.equal(tick.action, 'WAIT', 'the intermission is confirmed by its own button only');
});

test('the pure steps count the lock down and report the rest', () => {
    const locked = deriveRoundEndTickStep({
        dt: 0.25,
        roundPause: 3,
        continuePressed: true,
        inputLockRemaining: ROUND_END_INPUT_LOCK_SECONDS,
    });
    assert.equal(locked.action, 'WAIT');
    assert.ok(Math.abs(locked.nextInputLockRemaining - 0.5) < 1e-9, 'the lock must count down by dt');

    const free = deriveRoundEndTickStep({
        dt: 0.25,
        roundPause: 3,
        continuePressed: true,
        inputLockRemaining: 0,
    });
    assert.equal(free.action, 'START_ROUND');

    const matchLocked = deriveMatchEndTickStep({
        dt: 0.25,
        continuePressed: true,
        inputLockRemaining: MATCH_END_INPUT_LOCK_SECONDS,
    });
    assert.equal(matchLocked.action, 'WAIT');

    const matchFree = deriveMatchEndTickStep({
        dt: 0.25,
        continuePressed: true,
        inputLockRemaining: 0,
    });
    assert.equal(matchFree.action, 'RESTART_MATCH');
});

test('the headless kernel locks continue the same way and never fires twice', () => {
    const kernel = createHeadlessMatchKernel({ simPorts: {} });
    kernel.boot({ roundIndex: 0 });
    kernel.signalMatchEnd();
    const held = createHeadlessInputAdapter({ commands: ['Continue'] });

    // The headless adapter never consumes a command, so a command held from the start
    // must stay swallowed instead of firing once the lock is over.
    for (let i = 0; i < 40; i++) {
        const step = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
        assert.equal(step.action, 'WAIT', `tick ${i} must not restart the match`);
    }
});

test('the headless kernel restarts once on a fresh press after the lock', () => {
    const kernel = createHeadlessMatchKernel({ simPorts: {} });
    kernel.boot({ roundIndex: 0 });
    kernel.signalMatchEnd();
    const idle = createHeadlessInputAdapter({ commands: [] });
    const held = createHeadlessInputAdapter({ commands: ['Continue'] });

    for (let i = 0; i < 20; i++) kernel.tick({ fixedStepSeconds: 0.1 }, idle, true);
    const first = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
    assert.equal(first.action, 'RESTART_MATCH', 'a fresh press after the lock must count');

    const second = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
    assert.equal(second.action, 'WAIT', 'a held command must not fire every tick');
});

test('a match-end board left from outside locks again for the next match', () => {
    const harness = createHarness();
    harness.kernel.signalMatchEnd();
    stepMatchEnd(harness, MATCH_END_INPUT_LOCK_SECONDS + 0.1);

    // Left through an overlay button or a host kick: no tick action ran, and the
    // runtime builds a fresh kernel for the next match.
    const clearsBefore = harness.input.stats.clearContinue;
    harness.replaceKernel();
    harness.kernel.signalMatchEnd();
    harness.input.press('Continue');
    harness.system.updateMatchEnd(0.05);

    assert.ok(harness.input.stats.clearContinue > clearsBefore, 'the second board must drop the press');
    assert.equal(harness.calls.startMatch, 0, 'a carried-over press must not restart the match');
    assert.ok(harness.system.getRoundEndInputLockState().remaining > MATCH_END_INPUT_LOCK_SECONDS - 0.2,
        'the second board must lock for the full 1.5 s again');
});

test('a round-end board left from outside locks again for the next match', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS + 0.1);

    const clearsBefore = harness.input.stats.clearContinue;
    harness.replaceKernel();
    harness.game.roundPause = 3;
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.05);

    assert.ok(harness.input.stats.clearContinue > clearsBefore, 'the second board must drop the press');
    assert.equal(harness.calls.restartRound, 0, 'a carried-over press must not skip the countdown');
    assert.ok(harness.system.getRoundEndInputLockState().remaining > ROUND_END_INPUT_LOCK_SECONDS - 0.2,
        'the second board must lock for the full 0.75 s again');
});

test('the second round of the same match locks again', () => {
    const harness = createHarness();
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS + 0.1);

    // The round was restarted elsewhere (arcade run advance, host sync, overlay button).
    harness.kernel.signalRoundRestart();
    harness.game.roundPause = 3;
    harness.kernel.signalRoundEnd({ roundPause: 3 });
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.05);

    assert.equal(harness.calls.restartRound, 0, 'the next board must lock again');
    assert.ok(harness.system.getRoundEndInputLockState().remaining > ROUND_END_INPUT_LOCK_SECONDS - 0.2);
});

test('a board without a kernel locks again after the state was left', () => {
    const harness = createHarness({ withoutKernel: true, roundPause: 3 });
    stepRoundEnd(harness, ROUND_END_INPUT_LOCK_SECONDS + 0.1);

    // Leaving ROUND_END is reported by the state dispatch, not by a tick action.
    harness.system.resetRoundEndInputLock();
    harness.game.roundPause = 3;
    harness.input.press('Continue');
    harness.system.updateRoundEnd(0.05);

    assert.equal(harness.calls.restartRound, 0, 'the arcade board must lock again too');
    assert.ok(harness.system.getRoundEndInputLockState().remaining > ROUND_END_INPUT_LOCK_SECONDS - 0.2);
});

test('leaving the board states resets the lock through the state dispatch', () => {
    const harness = createHarness();
    harness.kernel.signalMatchEnd();
    harness.system.updateMatchEnd(0.05);
    assert.ok(harness.system.getRoundEndInputLockState().remaining > 0);

    harness.game.state = 'MENU';
    harness.game.roundStateTickSystem = harness.system;
    dispatchGameStateUpdate(harness.game, 0.05, true);

    assert.equal(harness.system.getRoundEndInputLockState().remaining, 0, 'the closed board keeps no lock');
});

test('the session role is read again for every board', () => {
    const clientFirst = createHarness({ sessionSnapshot: { isNetworkSession: true, isHost: false } });
    clientFirst.kernel.signalMatchEnd();
    stepMatchEnd(clientFirst, MATCH_END_INPUT_LOCK_SECONDS + 0.1);
    clientFirst.input.press('Continue');
    clientFirst.system.updateMatchEnd(0.05);
    assert.equal(clientFirst.calls.startMatch, 0, 'a client must not restart the match');

    clientFirst.setSessionSnapshot(null);
    clientFirst.replaceKernel();
    clientFirst.kernel.signalMatchEnd();
    stepMatchEnd(clientFirst, MATCH_END_INPUT_LOCK_SECONDS + 0.1);
    clientFirst.input.press('Continue');
    clientFirst.system.updateMatchEnd(0.05);
    assert.equal(clientFirst.calls.startMatch, 1, 'a later single player match must be free again');

    const soloFirst = createHarness({ sessionSnapshot: null });
    soloFirst.kernel.signalMatchEnd();
    stepMatchEnd(soloFirst, MATCH_END_INPUT_LOCK_SECONDS + 0.1);
    soloFirst.input.press('Continue');
    soloFirst.system.updateMatchEnd(0.05);
    assert.equal(soloFirst.calls.startMatch, 1);

    soloFirst.setSessionSnapshot({ isNetworkSession: true, isHost: false });
    soloFirst.replaceKernel();
    soloFirst.kernel.signalMatchEnd();
    stepMatchEnd(soloFirst, MATCH_END_INPUT_LOCK_SECONDS + 0.1);
    soloFirst.input.press('Continue');
    soloFirst.system.updateMatchEnd(0.05);
    assert.equal(soloFirst.calls.startMatch, 1, 'the client board must not add a second restart');
});

test('a network client keeps its countdown and its way to the menu', () => {
    const harness = createHarness({ sessionSnapshot: { isNetworkSession: true, isHost: false } });
    harness.kernel.signalRoundEnd({ roundPause: 1 });
    harness.game.roundPause = 1;

    harness.input.press('Enter');
    stepRoundEnd(harness, 0.9, 0.1);
    assert.equal(harness.calls.restartRound, 0, 'a client must not skip the countdown with enter');

    stepRoundEnd(harness, 0.2, 0.1);
    assert.equal(harness.calls.restartRound, 1, 'the client countdown must still finish on its own');
});

test('the headless kernel treats a held Enter like a held continue', () => {
    const kernel = createHeadlessMatchKernel({ simPorts: {} });
    kernel.boot({ roundIndex: 0 });
    kernel.signalMatchEnd();
    const held = createHeadlessInputAdapter({ commands: ['Enter'] });

    for (let i = 0; i < 40; i++) {
        const step = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
        assert.equal(step.action, 'WAIT', `tick ${i} must not restart the match`);
    }

    const idle = createHeadlessInputAdapter({ commands: [] });
    kernel.tick({ fixedStepSeconds: 0.1 }, idle, true);
    const first = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
    assert.equal(first.action, 'RESTART_MATCH', 'a fresh enter after the lock must count once');
    const second = kernel.tick({ fixedStepSeconds: 0.1 }, held, true);
    assert.equal(second.action, 'WAIT', 'a held enter must not fire every tick');
});

test('the tick system reports the lock for the result board', () => {
    const harness = createHarness();
    harness.kernel.signalMatchEnd();
    harness.system.updateMatchEnd(0.5);

    const lockState = harness.system.getRoundEndInputLockState();
    assert.equal(lockState.total, MATCH_END_INPUT_LOCK_SECONDS, 'the board needs the full duration');
    assert.ok(lockState.remaining > 0 && lockState.remaining < MATCH_END_INPUT_LOCK_SECONDS,
        'the board needs the remaining lock time');
});
