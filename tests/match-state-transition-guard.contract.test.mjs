import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureInteractiveMatchRuntime } from '../src/core/InteractiveMatchRuntimeGuard.js';
import { RoundStateTickSystem } from '../src/state/RoundStateTickSystem.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { createRuntimePorts } from '../src/shared/runtime/GameRuntimePorts.js';
import { createInteractiveMatchKernel } from '../src/state/MatchKernel.js';

function createGame(state, events = []) {
    const kernel = createInteractiveMatchKernel({ simPorts: {} });
    kernel.boot({ roundIndex: 0, roundPause: 6 });
    if (state === GAME_STATE_IDS.MATCH_END) {
        kernel.signalMatchEnd();
        kernel.setRoundPause(6);
    }
    const game = {
        state,
        _hudTimer: 12,
        huntState: { killFeed: ['kept'], overheatByPlayer: { 0: 0.6 } },
        input: { clearInputState(reason) { events.push(`input:${reason}`); } },
        audio: {
            setPaused(value) { events.push(`audio-paused:${value}`); },
            setMusicState(value) { events.push(`audio-music:${value}`); },
        },
        settings: { localSettings: { modePath: 'normal' } },
        runtimeCoordinator: {
            getRuntimeHandle: (key) => key === 'matchKernel' ? kernel : null,
        },
    };
    Object.defineProperty(game, 'roundPause', {
        enumerable: true,
        get: () => game.runtimeCoordinator.getRuntimeHandle('matchKernel')?.roundPause ?? 0,
    });
    return game;
}

test('the match-state port rejects forbidden match-end transitions before any side effect', () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.MATCH_END, events);
    const ports = createRuntimePorts(game);
    const originalKillFeed = game.huntState.killFeed;
    const originalHeat = game.huntState.overheatByPlayer;

    assert.equal(ports.matchStatePort.applyLifecycleTransition({
        state: GAME_STATE_IDS.PLAYING,
        roundPause: 0,
        hudTimer: 0,
        huntStatePatch: { killFeed: [], overheatByPlayer: {} },
    }), false);
    assert.equal(ports.matchStatePort.applyRoundEndTransition({
        nextState: GAME_STATE_IDS.ROUND_END,
        roundPause: 0,
    }), false);
    assert.equal(ports.matchStatePort.enterRoundEnd(3), false);
    assert.equal(ports.sessionPort.setState(GAME_STATE_IDS.PLAYING), false,
        'the session port must not bypass the shared transition guard');

    assert.equal(game.state, GAME_STATE_IDS.MATCH_END);
    assert.equal(game.roundPause, 6);
    assert.equal(game._hudTimer, 12);
    assert.strictEqual(game.huntState.killFeed, originalKillFeed);
    assert.strictEqual(game.huntState.overheatByPlayer, originalHeat);
    assert.deepEqual(events, [], 'rejected transitions must not clear input or touch audio');
});

test('an authorized match-end restart from the round tick can enter PLAYING once', async () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.MATCH_END, events);
    let ports = null;
    let startPromise = null;
    game.runtimeBundle = {
        components: {
            matchFlowUiController: {
                startRound() {
                    return ports.matchStatePort.applyLifecycleTransition({
                        state: GAME_STATE_IDS.PLAYING,
                        roundPause: 0,
                        hudTimer: 0,
                    });
                },
            },
            runtimeCoordinator: {
                startMatch(options) {
                    assert.equal(options?.source, 'round_state_restart_match');
                    startPromise = Promise.resolve().then(() => ports.matchUiPort.startRound());
                    return startPromise;
                },
            },
        },
    };
    ports = createRuntimePorts(game);

    assert.equal(ports.matchStatePort.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING }), false,
        'a generic transition cannot masquerade as a restart');
    const roundStateTick = new RoundStateTickSystem({
        game,
        getRuntimeIntentPort: () => ports.runtimeIntentPort,
    });

    assert.equal(roundStateTick._executeRoundStateTickAction('RESTART_MATCH'), true);
    assert.equal(await startPromise, true);
    assert.equal(game.state, GAME_STATE_IDS.PLAYING);
    assert.equal(game.roundPause, 0);
    assert.deepEqual(events, ['input:lifecycle-transition', 'audio-paused:false', 'audio-music:classic']);
});

test('false and rejected match-end starts release authorization for a different legitimate source', async () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.MATCH_END, events);
    let ports = null;
    let startCount = 0;
    game.runtimeBundle = {
        components: {
            matchFlowUiController: {
                startRound() {
                    return ports.matchStatePort.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
                },
            },
            runtimeCoordinator: {
                startMatch(options) {
                    startCount += 1;
                    if (startCount === 1) return Promise.resolve(false);
                    if (startCount === 2) throw new Error('start threw');
                    if (startCount === 3) return Promise.reject(new Error('start rejected'));
                    assert.equal(options?.source, 'arcade_sector_transition');
                    return Promise.resolve().then(() => ports.matchUiPort.startRound());
                },
            },
        },
    };
    ports = createRuntimePorts(game);

    assert.equal(await ports.runtimeIntentPort.startMatch({ source: 'round_state_restart_match' }), false);
    assert.throws(
        () => ports.runtimeIntentPort.startMatch({ source: 'round_state_restart_match' }),
        /start threw/
    );
    await assert.rejects(
        ports.runtimeIntentPort.startMatch({ source: 'round_state_restart_match' }),
        /start rejected/
    );
    assert.equal(await ports.runtimeIntentPort.startMatch({ source: 'arcade_sector_transition' }), true);
    assert.equal(startCount, 4);
    assert.equal(game.state, GAME_STATE_IDS.PLAYING);
});

test('an Arcade sector-rebuild restart can enter PLAYING through the lifecycle restart port', async () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.MATCH_END, events);
    let ports = null;
    game.runtimeBundle = {
        components: {
            matchFlowUiController: {
                startRound() {
                    return ports.matchStatePort.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
                },
            },
            runtimeCoordinator: {
                restartRound() {
                    // The production session handler rebuilds the match from its pending sector transition.
                    return Promise.resolve().then(() => ports.matchUiPort.startRound());
                },
            },
        },
    };
    ports = createRuntimePorts(game);

    assert.equal(await ports.lifecyclePort.restartRound(), true);
    assert.equal(game.state, GAME_STATE_IDS.PLAYING);
});

test('an overlapping start cannot claim or consume the first start authorization', async () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.MATCH_END, events);
    let ports = null;
    let startCount = 0;
    let releaseFirstStart;
    game.runtimeBundle = {
        components: {
            matchFlowUiController: {
                startRound() {
                    return ports.matchStatePort.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
                },
            },
            runtimeCoordinator: {
                startMatch() {
                    startCount += 1;
                    return new Promise((resolve) => {
                        releaseFirstStart = () => resolve(ports.matchUiPort.startRound());
                    });
                },
            },
        },
    };
    ports = createRuntimePorts(game);

    const firstStart = ports.runtimeIntentPort.startMatch({ source: 'round_state_restart_match' });
    assert.equal(ports.runtimeIntentPort.startMatch({ source: 'arcade_sector_transition' }), false);
    assert.equal(startCount, 1, 'the overlapping coordinator call must be rejected before it starts');
    releaseFirstStart();
    assert.equal(await firstStart, true);
    assert.equal(game.state, GAME_STATE_IDS.PLAYING);
    assert.deepEqual(events, ['input:lifecycle-transition', 'audio-paused:false', 'audio-music:classic']);
});

test('overlapping match-start and Arcade-restart entries cannot steal each other authorization', async () => {
    async function verifyFirstEntryOwnsAuthorization(firstEntry, overlappingEntry) {
        const events = [];
        const game = createGame(GAME_STATE_IDS.MATCH_END, events);
        let ports = null;
        let startCount = 0;
        let restartCount = 0;
        let release;
        const deferredStart = () => new Promise((resolve) => {
            release = () => resolve(ports.matchUiPort.startRound());
        });
        game.runtimeBundle = {
            components: {
                matchFlowUiController: {
                    startRound() {
                        return ports.matchStatePort.applyLifecycleTransition({ state: GAME_STATE_IDS.PLAYING });
                    },
                },
                runtimeCoordinator: {
                    startMatch() {
                        startCount += 1;
                        return deferredStart();
                    },
                    restartRound() {
                        restartCount += 1;
                        return deferredStart();
                    },
                },
            },
        };
        ports = createRuntimePorts(game);
        const invoke = (entry) => entry === 'matchStart'
            ? ports.runtimeIntentPort.startMatch({ source: 'round_state_restart_match' })
            : ports.lifecyclePort.restartRound();

        const pending = invoke(firstEntry);
        assert.equal(invoke(overlappingEntry), false);
        assert.deepEqual([startCount, restartCount], [firstEntry === 'matchStart' ? 1 : 0,
            firstEntry === 'arcadeRestart' ? 1 : 0]);
        release();
        assert.equal(await pending, true);
        assert.equal(game.state, GAME_STATE_IDS.PLAYING);
    }

    await verifyFirstEntryOwnsAuthorization('matchStart', 'arcadeRestart');
    await verifyFirstEntryOwnsAuthorization('arcadeRestart', 'matchStart');
});

test('the missing-runtime fallback returns through the guarded match-state port', () => {
    const events = [];
    const game = createGame(GAME_STATE_IDS.PLAYING, events);
    game._missingInteractiveMatchRuntimeReported = true;

    assert.equal(ensureInteractiveMatchRuntime(game), false);
    assert.equal(game.state, GAME_STATE_IDS.MENU);
    assert.deepEqual(events, ['input:lifecycle-transition', 'audio-paused:false', 'audio-music:menu']);
});
