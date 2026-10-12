import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchStartRuntimeService } from '../src/core/runtime/MatchStartRuntimeService.js';
import { createMatchKernelInteractiveAdapter } from '../src/core/MatchKernelInteractiveAdapter.js';
import { EntityEventBus } from '../src/entities/runtime/EntityEventBus.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { wireInitializedMatchRuntime } from '../src/state/MatchSessionFactory.js';
import { createRoundStateController } from '../src/state/RoundStateController.js';
import { RoundStateTickSystem } from '../src/state/RoundStateTickSystem.js';
import { createCountingInput } from './helpers/round-state-tick-harness.mjs';
import { createMatchStatePort } from '../src/shared/runtime/MatchStatePort.js';

/**
 * Stands in for the client's EntityManager: the event bus is wired to `onRoundEnd`
 * exactly like EntityRuntimeSupportAssembly does, so the host outcome travels the
 * same path as in the game (applyHuntNetworkState -> event bus -> session factory
 * -> match start runtime -> match UI port).
 */
function createClientEntityManager({ huntEnabled = true } = {}) {
    const entityManager = {
        huntEnabled,
        isFightOutcomeAuthority: false,
        players: [{ index: 0, score: 0 }, { index: 1, score: 0 }],
        recorder: null,
        runtimeConfig: null,
        onRoundEnd: null,
    };
    entityManager._eventBus = new EntityEventBus({
        onRoundEnd: (winner, outcome) => entityManager.onRoundEnd?.(winner, outcome),
    });
    return entityManager;
}

/**
 * Stands in for the game and its match UI port on a network client. `onRoundEnd`
 * does what MatchFlowLifecycleController.onRoundEnd does first: enter ROUND_END.
 */
function startClientMatch(options = {}) {
    const entityManager = createClientEntityManager(options);
    let wired = null;
    const game = {
        state: 'PLAYING',
        boards: 0,
        runtimeCoordinator: {
            getRuntimeHandle: (key) => key === 'matchKernel' ? wired?.kernel || null : null,
        },
    };
    Object.defineProperty(game, 'roundPause', {
        enumerable: true,
        get: () => game.runtimeCoordinator.getRuntimeHandle('matchKernel')?.roundPause ?? 0,
    });
    const matchStatePort = createMatchStatePort(game);
    const facade = {
        isNetworkSession: () => true,
        isHost: () => false,
        getPorts: () => ({
            matchUiPort: {
                prepareMatchStartProjection: () => true,
                startRound() {},
                onRoundEnd: () => {
                    matchStatePort.enterRoundEnd(3);
                    game.boards += 1;
                },
            },
            lifecyclePort: { initializeSession: () => true },
        }),
        getRuntimeHandle: () => ({
            createMatchSession: (handlers) => {
                wired = wireInitializedMatchRuntime({
                    renderer: {
                        cameras: [],
                        cameraModes: [],
                        createCamera() {},
                        viewportSystem: { setNetworkMode() {} },
                        precompileMatchScene() {},
                    },
                    initializedMatch: { session: { entityManager, numHumans: 1, networkEnabled: true } },
                    ...handlers,
                });
                return wired;
            },
        }),
    };
    return {
        entityManager,
        game,
        async start() {
            assert.equal(await new MatchStartRuntimeService({ facade }).execute(), true);
            return wired;
        },
    };
}

/**
 * The host side: builds the real network snapshot from a host EntityManager that just
 * ended round `round` (the tick pipeline stores the outcome in `_lastRoundOutcome`).
 */
function createHostSnapshot({ huntEnabled = false, round = 1, reason = 'ELIMINATION', winnerIndex = 1 } = {}) {
    const players = [{ index: 0, alive: false }, { index: 1, alive: true }];
    return createGameStateSnapshot({
        huntEnabled,
        players,
        _networkRoundSerial: round,
        _lastRoundOutcome: { shouldEnd: true, winner: players[winnerIndex] || null, reason, parcours: null },
    }, null);
}

/** Delivers one host snapshot to the client the way the runtime receiver does. */
function deliver(reconciler, entityManager, snapshot) {
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile([], entityManager);
}

test('a Classic network client enters ROUND_END exactly once from the host snapshot', async () => {
    const client = startClientMatch({ huntEnabled: false });
    const wired = await client.start();
    const reconciler = new StateReconciler();
    const snapshot = createHostSnapshot({ huntEnabled: false, reason: 'ELIMINATION' });

    deliver(reconciler, client.entityManager, snapshot);
    deliver(reconciler, client.entityManager, snapshot);

    assert.equal(client.game.state, 'ROUND_END', 'the host round end must open the Classic client result board');
    assert.equal(client.game.boards, 1, 'a repeated snapshot of the same round must not open a second board');
    assert.equal(wired.kernel.lifecycle, 'round_end', 'kernel and game state must change together');
    wired.kernel.dispose();
});

test('a HUNT network client enters ROUND_END exactly once, not once per carrier', async () => {
    const client = startClientMatch({ huntEnabled: true });
    const wired = await client.start();
    const reconciler = new StateReconciler();
    const snapshot = createHostSnapshot({ huntEnabled: true, reason: 'KILL_LIMIT' });

    deliver(reconciler, client.entityManager, snapshot);
    deliver(reconciler, client.entityManager, snapshot);

    assert.equal(client.game.state, 'ROUND_END', 'the host round end must open the client result board');
    assert.equal(client.game.boards, 1);
    assert.equal(wired.kernel.lifecycle, 'round_end', 'kernel and game state must change together');
    wired.kernel.dispose();
});

/**
 * The client board after the host round end: the round state tick system runs on the
 * client's real kernel, and its entity manager is the one the reconciler writes to, so
 * a later host snapshot reaches the board the same way it does in the game.
 */
async function openClientBoard(hostSnapshot = createHostSnapshot()) {
    const client = startClientMatch();
    const wired = await client.start();
    const reconciler = new StateReconciler();
    deliver(reconciler, client.entityManager, hostSnapshot);
    assert.equal(client.game.state, 'ROUND_END');

    const calls = { restarts: 0 };
    client.entityManager.updateCameras = () => {};
    client.entityManager.updateLastRoundGhostPlayback = () => {};
    const game = {
        state: client.game.state,
        input: createCountingInput(),
        runtimeCoordinator: client.game.runtimeCoordinator,
        roundStateController: createRoundStateController({ defaultRoundPause: 3 }),
        gameLoop: { renderFrameId: 1 },
        entityManager: client.entityManager,
        matchFlowUiController: { applyMatchUiState() {} },
    };
    Object.defineProperty(game, 'roundPause', {
        enumerable: true,
        get: () => game.runtimeCoordinator.getRuntimeHandle('matchKernel')?.roundPause ?? 0,
    });
    const adapter = createMatchKernelInteractiveAdapter({ game, kernel: wired.kernel });
    game.playingStateSystem = { getKernelAdapter: () => adapter };
    const system = new RoundStateTickSystem({
        game,
        lifecyclePort: { restartRound: () => { calls.restarts += 1; }, returnToMenu() {} },
        getSessionSnapshot: () => ({ isNetworkSession: true, isHost: false }),
    });
    return { client, wired, reconciler, system, calls };
}

/** The host snapshot of a running round: no outcome, the host's new round serial. */
function createHostRunningSnapshot(round) {
    return createGameStateSnapshot({
        players: [{ index: 0, alive: true }, { index: 1, alive: true }],
        _networkRoundSerial: round,
        _lastRoundOutcome: null,
    }, null);
}

function createHostSnapshotWithSerial({
    outcomeRound = 1,
    hostRoundSerial = outcomeRound,
    includeOutcomeRound = true,
    includeHostRoundSerial = true,
    winnerIndex = 1,
    reason = 'ELIMINATION',
} = {}) {
    const safeRound = Number.isSafeInteger(outcomeRound) && outcomeRound >= 0 ? outcomeRound : 1;
    const snapshot = createHostSnapshot({ round: safeRound, winnerIndex, reason });
    if (includeOutcomeRound) snapshot.roundOutcome.round = outcomeRound;
    else delete snapshot.roundOutcome.round;
    if (includeHostRoundSerial) snapshot.roundSerial = hostRoundSerial;
    else delete snapshot.roundSerial;
    return snapshot;
}

test('the client keeps its board after its own countdown until the host starts the next round', async () => {
    const { client, wired, reconciler, system, calls } = await openClientBoard();

    for (let i = 0; i < 5; i++) system.updateRoundEnd(1);
    assert.equal(calls.restarts, 0, 'the client countdown alone must not start the next round');

    // The host still sits on its board of round 1 and repeats its result.
    deliver(reconciler, client.entityManager, createHostSnapshot({ round: 1 }));
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.restarts, 0, 'the host board of the same round is no round start');

    deliver(reconciler, client.entityManager, createHostRunningSnapshot(2));
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.restarts, 1, 'the host round start must start the client round');
    wired.kernel.dispose();
});

test('the host round start ends the client board before its own countdown ran out', async () => {
    const { client, wired, reconciler, system, calls } = await openClientBoard();

    system.updateRoundEnd(0.5);
    deliver(reconciler, client.entityManager, createHostRunningSnapshot(2));
    system.updateRoundEnd(1 / 60);

    assert.equal(calls.restarts, 1, 'the client must follow the host, not its own three seconds');
    wired.kernel.dispose();
});

test('a host without a round serial leaves the client its own countdown', async () => {
    const { roundSerial: _omitted, ...olderHostSnapshot } = createHostSnapshot();
    const { wired, system, calls } = await openClientBoard(olderHostSnapshot);

    for (let i = 0; i < 4 && calls.restarts === 0; i++) system.updateRoundEnd(1);

    assert.equal(calls.restarts, 1, 'without the host signal the client must still reach the next round');
    wired.kernel.dispose();
});

test('a stale host outcome stays ignored across reconnect on the same entity manager', () => {
    const emitted = [];
    const players = [{ index: 0 }, { index: 1 }];
    const client = {
        players,
        _eventBus: { emitRoundEnd: (winner, outcome) => emitted.push({ winner, outcome }) },
    };
    const firstConnection = new StateReconciler();

    deliver(firstConnection, client, createHostSnapshot({ round: 1, winnerIndex: 1 }));
    // The client counted down on its own and restarted; the host still sends round 1.
    client._roundEnded = false;
    // A reconnect creates a new reconciler but retains this session's entity manager.
    const reconnected = new StateReconciler();
    deliver(reconnected, client, createHostSnapshot({ round: 1, winnerIndex: 1 }));
    assert.equal(emitted.length, 1, 'the outcome of round 1 must not end the client round 2');

    deliver(reconnected, client, createHostSnapshot({ round: 2, winnerIndex: 0, reason: 'PARCOURS_COMPLETE' }));
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1].winner, players[0]);
    assert.equal(emitted[1].outcome.reason, 'PARCOURS_COMPLETE');
    assert.equal(client._roundEnded, true);
});

test('a newer running-round serial fences a late result but accepts and deduplicates the current result', () => {
    const emitted = [];
    const players = [{ index: 0 }, { index: 1 }];
    const client = { players, _eventBus: { emitRoundEnd: (winner, outcome) => emitted.push({ winner, outcome }) } };
    const reconciler = new StateReconciler();

    deliver(reconciler, client, createHostRunningSnapshot(2));
    assert.equal(client._hostRoundSerial, 2);
    deliver(reconciler, client, createHostSnapshotWithSerial({ outcomeRound: 1, hostRoundSerial: 2 }));
    assert.equal(emitted.length, 0, 'round 1 cannot end a client after the host has started round 2');
    deliver(reconciler, client, createHostSnapshotWithSerial({ outcomeRound: 3, hostRoundSerial: 2 }));
    assert.equal(emitted.length, 0, 'a future result cannot be applied before the host reports that round');
    assert.equal(client._appliedHostRoundOutcome, undefined, 'a future result cannot advance the applied-round fence');

    const currentRound = createHostSnapshotWithSerial({ outcomeRound: 2, hostRoundSerial: 2, winnerIndex: 0, reason: 'PARCOURS_COMPLETE' });
    deliver(reconciler, client, currentRound);
    deliver(reconciler, client, currentRound);
    deliver(reconciler, client, createHostSnapshotWithSerial({ outcomeRound: 1, hostRoundSerial: 2 }));
    assert.equal(emitted.length, 1, 'the current result is applied once and cannot be rolled back by round 1');
    assert.equal(emitted[0].winner, players[0]);
    assert.equal(emitted[0].outcome.reason, 'PARCOURS_COMPLETE');
    assert.equal(client._appliedHostRoundOutcome, 2);
});

test('a future result cannot suppress the next-round signal or duplicate its later legitimate result', async () => {
    const { client, wired, reconciler, system, calls } = await openClientBoard(createHostSnapshot({ round: 2 }));
    assert.equal(client.entityManager._appliedHostRoundOutcome, 2);

    deliver(reconciler, client.entityManager, createHostSnapshotWithSerial({ outcomeRound: 3, hostRoundSerial: 2 }));
    assert.equal(client.game.boards, 1, 'the future result is ignored while the host is still on round 2');
    system.updateRoundEnd(1);
    assert.equal(calls.restarts, 0, 'the current host serial does not advance the board');

    deliver(reconciler, client.entityManager, createHostRunningSnapshot(3));
    system.updateRoundEnd(1 / 60);
    assert.equal(calls.restarts, 1, 'host serial 3 advances the legitimate round 2 result');

    const currentRoundResult = createHostSnapshotWithSerial({ outcomeRound: 3, hostRoundSerial: 3 });
    deliver(reconciler, client.entityManager, currentRoundResult);
    deliver(reconciler, client.entityManager, currentRoundResult);
    assert.equal(client.game.boards, 2, 'the legitimate round 3 result is applied exactly once');
    assert.equal(client.entityManager._appliedHostRoundOutcome, 3);
    wired.kernel.dispose();
});

test('invalid host outcome serials are ignored without poisoning the known round', () => {
    const emitted = [];
    const client = { players: [], _eventBus: { emitRoundEnd: () => emitted.push(1) } };
    const reconciler = new StateReconciler();
    const invalidRounds = [null, -1, 1.5, Infinity, NaN, '2', Number.MAX_SAFE_INTEGER + 1, undefined];

    for (const outcomeRound of invalidRounds) {
        deliver(reconciler, client, createHostSnapshotWithSerial({
            outcomeRound,
            hostRoundSerial: 2,
            includeOutcomeRound: outcomeRound !== undefined,
        }));
    }

    assert.equal(client._hostRoundSerial, 2, 'a valid top-level host serial is still recorded');
    assert.equal(client._appliedHostRoundOutcome, undefined);
    assert.equal(emitted.length, 0);
    deliver(reconciler, client, createHostSnapshotWithSerial({ outcomeRound: 2, hostRoundSerial: 2 }));
    assert.equal(emitted.length, 1, 'the valid current outcome remains applicable');
});

test('missing and invalid top-level serials preserve the legacy client countdown', async () => {
    for (const hostRoundSerial of [undefined, null, -1, 1.5, Infinity, NaN, '2', Number.MAX_SAFE_INTEGER + 1]) {
        const snapshot = createHostSnapshotWithSerial({
            outcomeRound: 1,
            hostRoundSerial,
            includeHostRoundSerial: hostRoundSerial !== undefined,
        });
        const { client, wired, system, calls } = await openClientBoard(snapshot);

        assert.equal(client.entityManager._hostRoundSerial, undefined, `serial ${String(hostRoundSerial)} stays absent`);
        for (let i = 0; i < 4 && calls.restarts === 0; i += 1) system.updateRoundEnd(1);
        assert.equal(calls.restarts, 1, `serial ${String(hostRoundSerial)} keeps the local countdown fallback`);
        wired.kernel.dispose();
    }
});

test('a new match entity manager accepts host round 1 independently of the previous session', async () => {
    const snapshot = createHostSnapshot({ round: 1 });
    const first = startClientMatch();
    const second = startClientMatch();
    const firstWired = await first.start();
    const secondWired = await second.start();

    try {
        assert.notEqual(first.entityManager, second.entityManager);
        deliver(new StateReconciler(), first.entityManager, snapshot);
        deliver(new StateReconciler(), second.entityManager, snapshot);
        assert.equal(first.entityManager._appliedHostRoundOutcome, 1);
        assert.equal(second.entityManager._appliedHostRoundOutcome, 1);
        assert.equal(first.game.boards, 1);
        assert.equal(second.game.boards, 1);
    } finally {
        firstWired.kernel.dispose();
        secondWired.kernel.dispose();
    }
});

test('a snapshot without a round outcome (older host or running round) ends nothing', () => {
    const emitted = [];
    const client = { players: [], _eventBus: { emitRoundEnd: () => emitted.push(1) } };
    const snapshot = createGameStateSnapshot({ players: [] }, null);
    assert.equal(snapshot.roundOutcome, null);
    deliver(new StateReconciler(), client, snapshot);
    const { roundOutcome: _omitted, ...olderSnapshot } = snapshot;
    deliver(new StateReconciler(), client, olderSnapshot);
    assert.equal(emitted.length, 0);
});

test('a network client never ends a round from its own outcome evaluation', () => {
    // Classic rules without respawn: the replica sees one survivor in its local copy,
    // but only the host may decide the round.
    const outcomeSystem = new RoundOutcomeSystem({
        getPlayers: () => [
            { index: 0, alive: false, entitySlotActive: true },
            { index: 1, alive: true, entitySlotActive: true },
        ],
        isRespawnPending: () => false,
        isOutcomeAuthority: () => false,
    });

    assert.equal(outcomeSystem.resolve().shouldEnd, false, 'a replica must not end the round locally');
});

test('hosts and offline matches still end the round from their own evaluation', () => {
    const outcomeSystem = new RoundOutcomeSystem({
        getPlayers: () => [
            { index: 0, alive: false, entitySlotActive: true },
            { index: 1, alive: true, entitySlotActive: true },
        ],
        isRespawnPending: () => false,
    });

    assert.equal(outcomeSystem.resolve().shouldEnd, true);
});
