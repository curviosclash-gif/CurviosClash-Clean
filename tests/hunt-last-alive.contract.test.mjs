import test from 'node:test';
import assert from 'node:assert/strict';

import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { createHuntNetworkState, applyHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { normalizeHuntLivesByPlayer } from '../src/shared/contracts/HuntLivesContract.js';

const createPlayer = (index) => ({ index, alive: true, entitySlotActive: true, isBot: index > 0 });

test('last-alive HUNT grants three lives and never schedules a fourth spawn', () => {
    const runtime = {
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'last_alive', RESPAWN: { DELAY_SECONDS: 3 } } },
        callbacks: { getStrategy: () => ({ isRespawnEnabled: () => true }) },
    };
    const respawns = new RespawnSystem(runtime);
    const player = createPlayer(0);
    for (const remaining of [2, 1, 0]) {
        player.alive = false;
        respawns.onPlayerDied(player);
        assert.equal(respawns.getLivesRemainingForPlayer(player), remaining);
        assert.equal(respawns.isRespawnPending(player), remaining > 0);
        respawns.pendingByPlayer.clear();
    }
    respawns.reset();
    assert.equal(respawns.getLivesRemainingForPlayer(player), 3);
});

test('last-alive waits for pending respawns and ends when one contender remains', () => {
    const players = [createPlayer(0), createPlayer(1), createPlayer(2)];
    const pending = new Set();
    const outcome = new RoundOutcomeSystem({
        getPlayers: () => players,
        isRespawnEnabled: () => true,
        getWinCondition: () => 'last_alive',
        isRespawnPending: (player) => pending.has(player.index),
        getScoreboard: () => [{ playerIndex: 0, kills: 100 }],
        getElapsedSeconds: () => 400,
        getDeathmatchTimeLimitSeconds: () => 300,
    });
    players[1].alive = false;
    assert.equal(outcome.getDeathmatchState().timeLimitSeconds, 0);
    pending.add(1);
    players[2].alive = false;
    assert.equal(outcome.resolve().shouldEnd, false, 'the pending player still has a life');
    pending.delete(1);
    assert.equal(outcome.resolve().winner, players[0]);
    assert.equal(outcome.resolve().reason, 'LAST_ALIVE');
});

test('solo last-alive ends when the human spends the final life', () => {
    const player = createPlayer(0);
    const outcome = new RoundOutcomeSystem({
        getPlayers: () => [player],
        isRespawnEnabled: () => true,
        getWinCondition: () => 'last_alive',
    });
    assert.equal(outcome.resolve().shouldEnd, false);
    player.alive = false;
    assert.deepEqual(outcome.resolve(), {
        shouldEnd: true, winner: null, reason: 'LAST_ALIVE', parcours: null,
    });
});

test('remaining lives reach clients and HUD projection', () => {
    const players = [createPlayer(0), createPlayer(1)];
    const host = {
        huntEnabled: true,
        players,
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'last_alive' } },
        _respawnSystem: { getLivesRemainingByPlayer: () => ({ 0: 2, 1: 0 }) },
    };
    const state = createHuntNetworkState(host);
    assert.deepEqual(state.livesRemainingByPlayer, { 0: 2, 1: 0 });
    const client = { players };
    applyHuntNetworkState(client, structuredClone(state));
    const projection = createMatchRuntimeProjection({ hunt: {
        winCondition: state.winCondition,
        livesRemainingByPlayer: client._authoritativeHuntState.livesRemainingByPlayer,
    } });
    assert.deepEqual(projection.hunt.livesRemainingByPlayer, { 0: 2, 1: 0 });
    assert.deepEqual(normalizeHuntLivesByPlayer({ 0: 9, 1: -2, bad: 2, 2: 'x' }), { 0: 3, 1: 0 });
});
