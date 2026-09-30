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
    const game = { state: 'PLAYING', roundPause: 0, boards: 0 };
    let wired = null;
    const facade = {
        isNetworkSession: () => true,
        isHost: () => false,
        getPorts: () => ({
            matchUiPort: {
                prepareMatchStartProjection: () => true,
                startRound() {},
                onRoundEnd: () => {
                    game.state = 'ROUND_END';
                    game.roundPause = 3;
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

test('the client counts down on its own and starts the next round', async () => {
    const client = startClientMatch();
    const wired = await client.start();
    deliver(new StateReconciler(), client.entityManager, createHostSnapshot());
    assert.equal(client.game.state, 'ROUND_END');

    // The client has no round start signal from the host; its own board countdown
    // (the same three seconds as on the host) restarts the round.
    let restarts = 0;
    const game = {
        state: client.game.state,
        input: createCountingInput(),
        roundPause: client.game.roundPause,
        roundStateController: createRoundStateController({ defaultRoundPause: 3 }),
        gameLoop: { renderFrameId: 1 },
        entityManager: { updateCameras() {}, updateLastRoundGhostPlayback() {} },
        matchFlowUiController: { applyMatchUiState() {} },
    };
    const adapter = createMatchKernelInteractiveAdapter({ game, kernel: wired.kernel });
    game.playingStateSystem = { getKernelAdapter: () => adapter };
    const system = new RoundStateTickSystem({
        game,
        lifecyclePort: { restartRound: () => { restarts += 1; }, returnToMenu() {} },
        getSessionSnapshot: () => ({ isNetworkSession: true, isHost: false }),
    });
    for (let i = 0; i < 4 && restarts === 0; i++) system.updateRoundEnd(1);

    assert.equal(restarts, 1, 'the client must reach the next round after the countdown');
    wired.kernel.dispose();
});

test('a stale host outcome is ignored after the client restarted, the next host round ends again', () => {
    const emitted = [];
    const players = [{ index: 0 }, { index: 1 }];
    const client = {
        players,
        _eventBus: { emitRoundEnd: (winner, outcome) => emitted.push({ winner, outcome }) },
    };
    const reconciler = new StateReconciler();

    deliver(reconciler, client, createHostSnapshot({ round: 1, winnerIndex: 1 }));
    // The client counted down on its own and restarted; the host still sends round 1.
    client._roundEnded = false;
    deliver(reconciler, client, createHostSnapshot({ round: 1, winnerIndex: 1 }));
    assert.equal(emitted.length, 1, 'the outcome of round 1 must not end the client round 2');

    deliver(reconciler, client, createHostSnapshot({ round: 2, winnerIndex: 0, reason: 'PARCOURS_COMPLETE' }));
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1].winner, players[0]);
    assert.equal(emitted[1].outcome.reason, 'PARCOURS_COMPLETE');
    assert.equal(client._roundEnded, true);
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
