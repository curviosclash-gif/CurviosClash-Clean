import test from 'node:test';
import assert from 'node:assert/strict';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { HUNT_PARCOURS_RIVAL_STORAGE_KEY as RIVAL } from '../src/shared/contracts/HuntParcoursRivalContract.js';
import { HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY as MEDAL } from '../src/shared/contracts/HuntParcoursMedalRecordContract.js';

function store() {
    const data = new Map();
    return { data, writable: false, unreadable: false,
        readJsonRecordResult(key) {
            return this.unreadable ? { status: 'read_failed' } : data.has(key)
                ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' };
        },
        saveJsonRecord(key, value) {
            if (!this.writable) return false;
            data.set(key, structuredClone(value));
            if (this.failReadback) this.unreadable = true;
            return true;
        },
    };
}

function winRun(runtime) {
    const human = { index: 0, alive: true }, rival = { index: 1, isBot: true, alive: true };
    const manager = { humanPlayers: [human], players: [human, rival] };
    runtime.start(manager);
    for (let map = 0; map < 2; map++) {
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: 1000 });
        runtime.getRoundOutcome();
        if (map === 0) runtime.start(manager);
    }
    return runtime.getHudState().postRunSummary;
}

test('failed record saves survive abort and another run, then save both results exactly once', () => {
    const target = store();
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => target });
    const first = winRun(runtime);
    assert.equal(first.saveFailures.length, 2);
    runtime.dispose();
    const second = winRun(runtime);
    assert.equal(second.rival.stage, 1, 'the queued first result is the next run base');
    target.writable = true;
    runtime.maintainPendingSettlements(0);
    runtime.maintainPendingSettlements(1000);
    runtime.maintainPendingSettlements(2000);
    assert.equal(target.data.get(RIVAL).stage, 2);
    assert.equal(target.data.get(MEDAL).variants.nemesis.plays, 2);
    assert.deepEqual(first.saveFailures, []);
    assert.deepEqual(second.saveFailures, []);
    assert.equal(runtime.hasPendingSettlement(), false);
});

test('successful writes with unavailable readback retry absolute targets without counting another run', () => {
    const target = store(); target.writable = true; target.failReadback = true;
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => target });
    winRun(runtime);
    target.unreadable = false; target.failReadback = false;
    for (let tick = 0; tick < 4; tick++) runtime.maintainPendingSettlements(tick * 1000);
    assert.equal(target.data.get(RIVAL).stage, 1);
    assert.equal(target.data.get(MEDAL).variants.nemesis.plays, 1);
});

test('pending profile A progress cannot overwrite profile B or a future record', () => {
    const first = store(), second = store(); second.writable = true;
    let active = first;
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => active });
    winRun(runtime); runtime.dispose(); active = second;
    winRun(runtime);
    const future = { version: 999, future: true };
    first.data.set(RIVAL, future); first.writable = true;
    runtime.maintainPendingSettlements(0);
    runtime.maintainPendingSettlements(1000);
    assert.deepEqual(first.data.get(RIVAL), future);
    assert.equal(second.data.get(RIVAL).stage, 1);
    first.data.delete(RIVAL);
    runtime.maintainPendingSettlements(2000);
    assert.equal(first.data.get(RIVAL).stage, 1);
    assert.equal(second.data.get(MEDAL).variants.nemesis.plays, 1);
});

test('a second run during unavailable readback builds on the trusted pending first result', () => {
    const target = store(); target.writable = true; target.failReadback = true;
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => target });
    winRun(runtime); runtime.dispose();
    const second = winRun(runtime);
    assert.equal(second.rival.stage, 1);
    target.unreadable = false; target.failReadback = false;
    runtime.maintainPendingSettlements(0);
    runtime.maintainPendingSettlements(1000);
    assert.equal(target.data.get(RIVAL).stage, 2);
    assert.equal(target.data.get(MEDAL).variants.nemesis.plays, 2);
});
