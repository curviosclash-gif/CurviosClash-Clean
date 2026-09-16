// Verifies that the Five Fronts (runType "arena_waves") death transition holds the
// round-end tick during the upgrade choice and only restarts once the selection moves
// the run into the "transition" phase, without disturbing other modes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RoundStateTickSystem } from '../src/state/RoundStateTickSystem.js';

function createStubGame({ surfaceState = null, roundPause = 3, pressed = {},
    roundStateController = null } = {}) {
    const calls = { restartRound: 0, returnToMenu: 0, updateCameras: 0, controllerTick: 0 };
    const game = {
        roundPause,
        input: { wasPressed: (key) => !!pressed[key] },
        entityManager: {
            updateCameras: () => { calls.updateCameras += 1; },
            updateLastRoundGhostPlayback: () => {},
        },
        matchFlowUiController: { applyMatchUiState: () => {} },
        runtimeCoordinator: {
            getArcadeMenuSurfaceState: () => surfaceState,
        },
        roundStateController: roundStateController || {
            deriveRoundEndTick: (inputs) => {
                calls.controllerTick += 1;
                return { action: 'WAIT', nextRoundPause: inputs.roundPause,
                    shouldUpdateCameras: true, countdownMessageSub: null };
            },
        },
    };
    const lifecyclePort = {
        restartRound: () => { calls.restartRound += 1; },
        returnToMenu: () => { calls.returnToMenu += 1; },
    };
    const system = new RoundStateTickSystem({ game, lifecyclePort });
    return { game, system, lifecyclePort, calls };
}

test('arena_waves upgrade phase waits even when the base countdown would expire', () => {
    // roundPause 0 means the ordinary tick would return START_ROUND immediately.
    const { system, game, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'upgrade' },
        roundPause: 0,
    });
    system.updateRoundEnd(1);
    assert.equal(calls.restartRound, 0, 'must not restart the arena during the choice');
    assert.equal(calls.controllerTick, 0, 'must bypass the ordinary controller');
    assert.equal(game.roundPause, 0, 'round pause stays unchanged while waiting');
});

test('arena_waves transition phase restarts the round exactly once', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'transition' },
        roundPause: 3,
    });
    system.updateRoundEnd(1 / 60);
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.restartRound, 1, 'transition consumes the pending map switch once');
    assert.equal(calls.controllerTick, 0, 'must bypass the ordinary controller');
});

test('arena_waves transition restart re-arms after leaving the transition phase', () => {
    const surfaceState = { runType: 'arena_waves', phase: 'transition' };
    const { system, calls } = createStubGame({ surfaceState, roundPause: 3 });
    system.updateRoundEnd(1 / 60);
    surfaceState.phase = 'upgrade';
    system.updateRoundEnd(1 / 60);
    surfaceState.phase = 'transition';
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.restartRound, 2, 'a later map transition may restart once again');
    assert.equal(calls.controllerTick, 0);
});

test('non-arena_waves runs still delegate to the existing controller', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'gauntlet', phase: 'intermission' },
        roundPause: 3,
    });
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.controllerTick, 1, 'existing controller path is used');
    assert.equal(calls.restartRound, 0);
});

test('missing arcade surface state still delegates to the existing controller', () => {
    const { system, calls } = createStubGame({ surfaceState: null, roundPause: 3 });
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.controllerTick, 1);
});

test('unknown arena_waves phase falls back to the existing controller', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'sector_active' },
        roundPause: 3,
    });
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.controllerTick, 1, 'unknown phases keep the existing path');
    assert.equal(calls.restartRound, 0);
});

test('Escape returns to menu during the upgrade phase', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'upgrade' },
        roundPause: 3,
        pressed: { Escape: true },
    });
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.returnToMenu, 1, 'Escape leaves the upgrade choice for the menu');
    assert.equal(calls.restartRound, 0);
});

test('Escape returns to menu during the finished phase', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'finished' },
        roundPause: 3,
        pressed: { Escape: true },
    });
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.returnToMenu, 1, 'Escape leaves the finished screen for the menu');
    assert.equal(calls.restartRound, 0);
});

test('finished phase waits without restarting when Escape is not pressed', () => {
    const { system, calls } = createStubGame({
        surfaceState: { runType: 'arena_waves', phase: 'finished' },
        roundPause: 0,
    });
    system.updateRoundEnd(1);
    assert.equal(calls.restartRound, 0, 'finished never auto-restarts');
    assert.equal(calls.returnToMenu, 0);
    assert.equal(calls.controllerTick, 0);
});
