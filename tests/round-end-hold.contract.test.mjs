import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { GameDebugApi, createGameDebugRuntimeAccess } from '../src/core/GameDebugApi.js';

// A Classic round with the only human dead: without a hold it ends at once with the bot as winner.
function createDecidedRound() {
    const human = { index: 0, alive: false, isBot: false };
    const bot = { index: 1, alive: true, isBot: true };
    return new RoundOutcomeSystem({
        getPlayers: () => [human, bot],
        getHumanPlayers: () => [human],
        getBots: () => [{ player: bot }],
    });
}

test('a decided round ends as before while no hold is set', () => {
    assert.equal(createDecidedRound().resolve().shouldEnd, true);
});

test('the round-end hold keeps a decided round running until it is released', () => {
    const outcome = createDecidedRound();
    outcome.setRoundEndHold(true);
    assert.deepEqual(outcome.resolve(), { shouldEnd: false, winner: null, reason: '', parcours: null });
    outcome.setRoundEndHold(false);
    assert.equal(outcome.resolve().shouldEnd, true);
});

test('a new round starts without the hold', () => {
    const outcome = createDecidedRound();
    outcome.setRoundEndHold(true);
    outcome.reset();
    assert.equal(outcome.resolve().shouldEnd, true);
});

function createDebugApi(entityManager) {
    return new GameDebugApi(createGameDebugRuntimeAccess({ entityManager }));
}

test('the debug API reads the simulation clock, the flight-safety filter and holds the round end', () => {
    const roundOutcomeSystem = createDecidedRound();
    const flightSafety = { byPlayer: new Map() };
    let clockMs = 1250;
    const entityManager = {
        runtime: { systems: { roundOutcomeSystem, playerInputSystem: { flightSafety } } },
        getRuntimeContext: () => ({ callbacks: { getSimulationNowMs: () => clockMs } }),
    };
    const debugApi = createDebugApi(entityManager);
    assert.equal(debugApi.getSimulationClockMs(), 1250);
    clockMs = 2500;
    assert.equal(debugApi.getSimulationClockMs(), 2500);
    assert.equal(debugApi.getBotFlightSafety(), flightSafety);
    assert.equal(debugApi.setRoundEndHold(true), true);
    assert.equal(roundOutcomeSystem.resolve().shouldEnd, false);
    assert.equal(debugApi.setRoundEndHold(false), true);
    assert.equal(roundOutcomeSystem.resolve().shouldEnd, true);
});

test('without a running match the debug API answers safely', () => {
    const debugApi = createDebugApi(null);
    assert.equal(debugApi.getSimulationClockMs(), 0);
    assert.equal(debugApi.getBotFlightSafety(), null);
    assert.equal(debugApi.setRoundEndHold(true), false);
});
