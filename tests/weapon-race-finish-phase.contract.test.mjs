import assert from 'node:assert/strict';
import test from 'node:test';

import { WeaponRaceRuntime } from '../src/core/arcade/WeaponRaceRuntime.js';

function racer(index, isBot) {
    return { index, isBot, inventory: [], rocketInventory: [], activeEffects: [], applyPowerup() {} };
}

// A decided race with one bot still on the course: the human finishes, the grace window runs
// out and the round outcome is settled before the straggler crosses the line.
function createDecidedRace() {
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    const players = [racer(0, false), racer(1, true), racer(2, true)];
    const entityManager = { players, humanPlayers: [players[0]], _projectileSystem: { clearForOwner() {} } };
    runtime.start({ entityManager });
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: 5000 });
    const outcome = runtime.getRoundOutcome(20_000);
    assert.ok(outcome?.shouldEnd, 'the race is decided once the grace window has run out');
    assert.equal(runtime.phase, 'finished');
    return { runtime, entityManager };
}

test('a bot crossing the line after the race was decided does not reopen it', () => {
    const { runtime } = createDecidedRace();

    const late = runtime.handleFinish({ playerIndex: 1, finishedAtMs: 21_000 });

    assert.equal(late.accepted, false, 'a finish after the decision is not accepted');
    assert.equal(runtime.phase, 'finished', 'the decided race stays finished');
    assert.equal(runtime.handleNewBest(0).pendingXp, 0, 'no new best XP is queued after the decision');
});

test('the next round starts fresh even when a straggler finished after the decision', () => {
    const { runtime, entityManager } = createDecidedRace();
    runtime.handleFinish({ playerIndex: 1, finishedAtMs: 21_000 });

    runtime.rebind({ entityManager });

    assert.equal(runtime.phase, 'racing', 'rebinding after a decided race starts a new race');
    assert.equal(runtime.roundOutcome, null, 'the old outcome is not carried into the next round');
});
