import assert from 'node:assert/strict';
import test from 'node:test';

import { installK19SegmentTimeoutObserver } from './helpers/k19-segment-timeout-observer.mjs';

const installDesktopObserver = new Function(`return (${installK19SegmentTimeoutObserver.toString()});`)();

function makePlayer(index = 0) {
    return {
        index,
        alive: true,
        hp: 100,
        position: { x: 4, y: 150, z: -143 },
        speed: 46,
        velocity: { x: 3, y: 0.5, z: -8 },
        quaternion: { x: 0, y: 0.2, z: 0, w: 0.98 },
        vehicleId: 'ship5',
        modelScale: 1.5,
    };
}

function makeState() {
    return {
        startedAtMs: 900,
        lastCheckpointAtMs: 1000,
        lastCheckpointId: 'CP01',
        nextCheckpointIndex: 1,
        resetCount: 0,
        checkpointRespawnsUsed: 0,
        wrongOrderCount: 0,
        completed: false,
        lastError: '',
        errorUntilMs: 0,
    };
}

function makeContext() {
    return {
        mapKey: 'neon_circuit',
        checkpointId: 'CP02',
        startPosition: { x: -243, y: 43, z: 1 },
        startSpeed: 46,
        selectedWaypoint: { x: -286, y: 150, z: -143 },
        currentWaypoint: { x: -286, y: 150, z: -143 },
        previousDriverPosition: { x: 5, y: 150, z: -140 },
        waypointIndex: 0,
        completedRafCallbacks: 240,
        simulationClockMs: 17050,
        renderTiming: {
            frameId: 250,
            rawDt: 0.02,
            stabilizedDt: 0.018,
            reset: false,
            resetReason: '',
            timestampMs: 20100,
        },
    };
}

function makeSystem(method) {
    return {
        _route: {
            routeId: 'neon_circuit_v1',
            totalCheckpoints: 10,
            rules: { maxSegmentTimeMs: 16_000, resetToLastValid: false, resetOnDeath: true },
        },
        _registerSegmentTimeout: method,
    };
}

test('captures the exact live progress and motion snapshot before the original reset mutates state', () => {
    const player = makePlayer();
    const state = makeState();
    let observed;
    let delegateCalls = 0;
    const system = makeSystem(function registerTimeout(actualPlayer, actualState, now) {
        delegateCalls += 1;
        assert.equal(this, system);
        assert.equal(actualPlayer, player);
        assert.equal(actualState, state);
        assert.equal(actualState.resetCount, 0, 'observer must run before product reset');
        assert.equal(actualState.lastCheckpointAtMs, 1000);
        actualState.resetCount += 1;
        actualState.nextCheckpointIndex = 0;
        actualState.lastError = 'Segment-Zeit überschritten';
        return { now, reset: true };
    });
    const observer = installDesktopObserver({
        progressSystem: system,
        expectedPlayer: player,
        getContext: makeContext,
        onSnapshot(snapshot) { observed = snapshot; },
    });

    const result = system._registerSegmentTimeout(player, state, 17_050);

    assert.deepEqual(result, { now: 17_050, reset: true });
    assert.equal(delegateCalls, 1);
    assert.equal(observed, observer.getSnapshot());
    assert.equal(observed.event, 'PARCOURS_SEGMENT_TIMEOUT_PRE_RESET');
    assert.deepEqual(observed.simulation, {
        nowMs: 17_050,
        simulationClockMs: 17_050,
        lastCheckpointAtMs: 1000,
        segmentElapsedMs: 16_050,
        maxSegmentTimeMs: 16_000,
        exceededByMs: 50,
    });
    assert.deepEqual(observed.progress, {
        startedAtMs: 900,
        lastCheckpointId: 'CP01',
        nextCheckpointIndex: 1,
        totalCheckpoints: 10,
        resetCount: 0,
        checkpointRespawnsUsed: 0,
        wrongOrderCount: 0,
        completed: false,
        lastError: '',
        errorUntilMs: 0,
    });
    assert.deepEqual(observed.player.velocity, { x: 3, y: 0.5, z: -8 });
    assert.deepEqual(observed.player.quaternion, { x: 0, y: 0.2, z: 0, w: 0.98 });
    assert.deepEqual(observed.driver.selectedWaypoint, { x: -286, y: 150, z: -143 });
    assert.equal(state.resetCount, 1);
    observer.restore();
});

test('delegates a synchronous return with the exact receiver, player, state, and time', () => {
    const player = makePlayer();
    const state = makeState();
    const marker = { ok: true };
    let calls = 0;
    const system = makeSystem(function registerTimeout(actualPlayer, actualState, now) {
        calls += 1;
        assert.equal(this, system);
        assert.equal(actualPlayer, player);
        assert.equal(actualState, state);
        assert.equal(now, 17_000);
        return marker;
    });
    const observer = installDesktopObserver({ progressSystem: system, expectedPlayer: player });

    assert.equal(system._registerSegmentTimeout(player, state, 17_000), marker);
    assert.equal(calls, 1);
    observer.restore();
});

test('propagates the original synchronous exception unchanged and calls the delegate once', () => {
    const player = makePlayer();
    const state = makeState();
    const failure = new Error('original timeout failure');
    let calls = 0;
    const system = makeSystem(function registerTimeout() {
        calls += 1;
        throw failure;
    });
    const observer = installDesktopObserver({ progressSystem: system, expectedPlayer: player });

    assert.throws(() => system._registerSegmentTimeout(player, state, 17_000), (error) => error === failure);
    assert.equal(calls, 1);
    observer.restore();
});

test('filters other players and records only the first matching timeout while delegating every call', () => {
    const player = makePlayer(0);
    const otherPlayer = makePlayer(1);
    let snapshots = 0;
    let delegates = 0;
    const prototype = {
        _registerSegmentTimeout(actualPlayer) {
            delegates += 1;
            return actualPlayer.index;
        },
    };
    const system = Object.assign(Object.create(prototype), {
        _route: { routeId: 'neon_circuit_v1', totalCheckpoints: 10, rules: { maxSegmentTimeMs: 16_000 } },
    });
    const observer = installDesktopObserver({
        progressSystem: system,
        expectedPlayer: player,
        onSnapshot() { snapshots += 1; },
    });

    assert.equal(system._registerSegmentTimeout(otherPlayer, makeState(), 17_000), 1);
    assert.equal(system._registerSegmentTimeout(player, makeState(), 17_001), 0);
    assert.equal(system._registerSegmentTimeout(player, makeState(), 17_002), 0);
    assert.equal(snapshots, 1);
    assert.equal(delegates, 3);
    observer.restore();
});

test('restores own descriptors exactly and removes only its temporary shadow of an inherited method', () => {
    const player = makePlayer();
    const inheritedMethod = function inheritedTimeout() { return 'inherited'; };
    const prototype = { _registerSegmentTimeout: inheritedMethod };
    const inheritedSystem = Object.assign(Object.create(prototype), {
        _route: { rules: { maxSegmentTimeMs: 16_000 } },
    });
    const inheritedObserver = installDesktopObserver({
        progressSystem: inheritedSystem,
        expectedPlayer: player,
    });
    assert.equal(Object.hasOwn(inheritedSystem, '_registerSegmentTimeout'), true);
    assert.equal(inheritedSystem._registerSegmentTimeout(player, makeState(), 17_000), 'inherited');
    assert.equal(inheritedObserver.restore(), true);
    assert.equal(Object.hasOwn(inheritedSystem, '_registerSegmentTimeout'), false);
    assert.equal(Object.getOwnPropertyDescriptor(prototype, '_registerSegmentTimeout').value, inheritedMethod);

    const ownMethod = function ownTimeout() { return 'own'; };
    const ownSystem = makeSystem(ownMethod);
    Object.defineProperty(ownSystem, '_registerSegmentTimeout', {
        value: ownMethod,
        writable: false,
        enumerable: true,
        configurable: true,
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(ownSystem, '_registerSegmentTimeout');
    const ownObserver = installDesktopObserver({ progressSystem: ownSystem, expectedPlayer: player });
    assert.equal(ownSystem._registerSegmentTimeout(player, makeState(), 17_000), 'own');
    assert.equal(ownObserver.restore(), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(ownSystem, '_registerSegmentTimeout'), originalDescriptor);
});

test('does not overwrite a foreign replacement made while the observer is installed', () => {
    const player = makePlayer();
    const system = Object.assign(Object.create({
        _registerSegmentTimeout() { return 'original'; },
    }), { _route: { rules: { maxSegmentTimeMs: 16_000 } } });
    const observer = installDesktopObserver({ progressSystem: system, expectedPlayer: player });
    const replacement = function foreignReplacement() { return 'foreign'; };
    system._registerSegmentTimeout = replacement;

    assert.equal(observer.restore(), false);
    assert.equal(system._registerSegmentTimeout, replacement);
    assert.equal(system._registerSegmentTimeout(player, makeState(), 17_000), 'foreign');
});

test('a throwing diagnostic sink cannot suppress the original reset handler', () => {
    const player = makePlayer();
    const state = makeState();
    let delegates = 0;
    const system = makeSystem(function registerTimeout() {
        delegates += 1;
        return 'reset-completed';
    });
    const observer = installDesktopObserver({
        progressSystem: system,
        expectedPlayer: player,
        onSnapshot() { throw new Error('diagnostic sink failed'); },
    });

    assert.equal(system._registerSegmentTimeout(player, state, 17_000), 'reset-completed');
    assert.equal(delegates, 1);
    observer.restore();
});
