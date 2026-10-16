import test from 'node:test';
import assert from 'node:assert/strict';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { XP_REWARD_TABLE } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { dispatchGameStateUpdate } from '../src/core/GameStateUpdateDispatch.js';

function store() {
    const data = new Map();
    return {
        data, writable: false, attempts: 0,
        readJsonRecordResult: key => data.has(key)
            ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' },
        loadJsonRecord: (key, fallback) => structuredClone(data.get(key) ?? fallback),
        saveJsonRecord(key, value) {
            this.attempts++;
            if (!this.writable) return false;
            data.set(key, structuredClone(value));
            return true;
        },
    };
}

test('failed Nemesis XP stays pending across abort/profile/vehicle switches without false or duplicate credit', () => {
    const first = store(), second = store();
    second.writable = true;
    let active = first;
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => active });
    runtime.start(null, { vehicleId: 'ship1' });
    const result = runtime.handleXpEvent('checkpoint');
    assert.equal(result.persisted, false);
    assert.equal(result.earned, 0);
    assert.equal(runtime.xpEarned, 0);
    assert.equal(first.data.has(KEY), false);
    runtime.dispose();
    active = second;
    runtime.start(null, { vehicleId: 'ship2' });
    runtime.handleXpEvent('finish');
    const newRunXp = runtime.xpEarned;
    first.writable = true;
    runtime.maintainPendingSettlements(Infinity);
    runtime.maintainPendingSettlements(Infinity);
    assert.equal(first.data.get(KEY).ship1.totalXpEarned, XP_REWARD_TABLE.parcoursCheckpoint);
    assert.equal(first.data.get(KEY).ship2, undefined);
    assert.equal(second.data.get(KEY).ship1, undefined);
    assert.equal(second.data.get(KEY).ship2.totalXpEarned, XP_REWARD_TABLE.parcoursFinish);
    assert.equal(runtime.xpEarned, newRunXp);
});

test('pending Nemesis XP retries are throttled, tolerate exceptions and update only the owning result', () => {
    const target = store();
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => target });
    const human = { index: 0, alive: true }, rival = { index: 1, isBot: true, alive: true };
    const manager = { humanPlayers: [human], players: [human, rival] };
    runtime.start(manager);
    runtime.handleXpEvent('checkpoint');
    for (let map = 0; map < 2; map++) {
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: 1000 });
        runtime.getRoundOutcome();
        if (map === 0) runtime.start(manager);
    }
    const summary = runtime.getHudState().postRunSummary;
    assert.equal(summary.pendingRewardCount, 1);
    runtime.maintainPendingSettlements(0);
    const attempts = target.attempts;
    runtime.maintainPendingSettlements(1);
    assert.equal(target.attempts, attempts);
    const save = target.saveJsonRecord;
    target.saveJsonRecord = () => { throw new Error('temporary disk failure'); };
    assert.doesNotThrow(() => runtime.maintainPendingSettlements(1000));
    target.saveJsonRecord = save;
    target.writable = true;
    runtime.maintainPendingSettlements(2000);
    runtime.maintainPendingSettlements(3000);
    assert.equal(summary.xpEarned, XP_REWARD_TABLE.parcoursCheckpoint);
    assert.equal(summary.pendingRewardCount, 0);
    assert.equal(runtime.hasPendingSettlement(), false);
});

test('menu and pause keep the existing pending-reward maintenance seam alive', () => {
    for (const state of ['MENU', 'PAUSED']) {
        let retries = 0;
        dispatchGameStateUpdate({ state, _updatePausedState() {}, runtimeCoordinator: {
            getRuntimeFacade: () => ({ tickPendingArcadeRewards: () => retries++ }),
        } }, 1 / 60, true);
        assert.equal(retries, 1);
    }
});

test('future vehicle data stays opaque and its uncredited XP waits for a writable record', () => {
    const target = store(); target.writable = true;
    const future = { schemaVersion: 'arcade-vehicle-profile.v999', vehicleId: 'ship1', future: true };
    target.data.set(KEY, { ship1: future });
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => target });
    runtime.start();
    runtime.handleXpEvent('checkpoint');
    runtime.maintainPendingSettlements(0);
    assert.equal(runtime.xpEarned, 0);
    assert.deepEqual(target.data.get(KEY), { ship1: future });
    assert.equal(runtime.hasPendingSettlement(), true);
    target.data.set(KEY, {});
    runtime.maintainPendingSettlements(1000);
    assert.equal(runtime.xpEarned, XP_REWARD_TABLE.parcoursCheckpoint);
});
