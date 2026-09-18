import test from 'node:test';
import assert from 'node:assert/strict';

import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { createHuntNetworkState, applyHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';

const players = [
    { index: 0, isBot: false, entitySlotActive: true, alive: true },
    { index: 1, isBot: true, entitySlotActive: true, alive: true },
];

test('point target credits E75 events without changing the kill tally', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerElimination(players[1], { killer: players[0], nowSeconds: 0 });
    scoring.registerIntercept(0);
    scoring.registerUnitDestroyed(0, 'tank');
    scoring.registerUnitDestroyed(0, 'boss');
    const row = scoring.getScoreboard(players, { winCondition: 'score_target' })[0];
    assert.equal(row.kills, 1);
    assert.equal(row.intercepts, 1);
    assert.equal(row.unitsDestroyed, 2);
    assert.equal(row.points, 7);

    const outcome = new RoundOutcomeSystem({
        getPlayers: () => players,
        getScoreboard: () => scoring.getScoreboard(players, { winCondition: 'score_target' }),
        isRespawnEnabled: () => true,
        getWinCondition: () => 'score_target',
        getDeathmatchKillLimit: () => 7,
    });
    assert.equal(outcome.resolve().winner, players[0]);
    assert.equal(outcome.resolve().reason, 'SCORE_TARGET');
});

test('point rankings and values survive the host snapshot and HUD projection', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerIntercept(0);
    scoring.registerElimination(players[0], { killer: players[1], nowSeconds: 0 });
    const host = {
        huntEnabled: true,
        players,
        _huntScoring: scoring,
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'score_target', DEATHMATCH_KILL_LIMIT: 5 } },
    };
    const state = createHuntNetworkState(host);
    assert.equal(state.winCondition, 'score_target');
    assert.equal(state.scoreboardRows[0].playerIndex, 1);
    const client = { players, _huntScoring: new HuntScoring(() => 0) };
    applyHuntNetworkState(client, structuredClone(state));
    assert.equal(client._huntScoring.getScoreboard(players, { winCondition: 'score_target' })[0].points, 2);
    const projection = createMatchRuntimeProjection({ hunt: { winCondition: state.winCondition, scoreboardRows: state.scoreboardRows } });
    assert.equal(projection.hunt.winCondition, 'score_target');
    assert.equal(projection.hunt.scoreboardRows[0].points, 2);
});

test('default deathmatch still ranks kills and ignores intercepts for victory', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerIntercept(0);
    scoring.registerIntercept(0);
    scoring.registerElimination(players[0], { killer: players[1], nowSeconds: 0 });
    assert.equal(scoring.getScoreboard(players)[0].playerIndex, 1);
    const outcome = new RoundOutcomeSystem({
        getPlayers: () => players,
        getScoreboard: () => scoring.getScoreboard(players),
        isRespawnEnabled: () => true,
        getDeathmatchKillLimit: () => 2,
    });
    assert.equal(outcome.resolve().shouldEnd, false);
});

test('a tied point target waits for a clear leader and ignores the kill timer', () => {
    let rows = [
        { playerIndex: 0, kills: 1, points: 4 },
        { playerIndex: 1, kills: 2, points: 4 },
    ];
    const outcome = new RoundOutcomeSystem({
        getPlayers: () => players,
        getScoreboard: () => rows,
        isRespawnEnabled: () => true,
        getWinCondition: () => 'score_target',
        getDeathmatchKillLimit: () => 4,
        getDeathmatchTimeLimitSeconds: () => 300,
        getElapsedSeconds: () => 400,
    });
    assert.equal(outcome.getDeathmatchState().timeLimitSeconds, 0);
    assert.equal(outcome.resolve().shouldEnd, false);
    rows = [{ ...rows[1], points: 5 }, rows[0]];
    assert.equal(outcome.resolve().winner, players[1]);
});
