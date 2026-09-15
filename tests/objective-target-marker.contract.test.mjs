import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createObjectiveTargetMarkerState,
    findObjectiveTargetPlayer,
    resolveObjectiveTargetIndex,
    resolveObjectiveTargetMarkerPulse,
    setObjectiveTargetMarkerIndex,
    updateObjectiveTargetMarkerState,
} from '../src/entities/systems/ObjectiveTargetMarkerOps.js';

function bountyObjective(overrides = {}) {
    return {
        objectiveId: 'bounty_hunt',
        targetPlayerIndex: 1,
        targetLabel: 'Bot 2',
        completed: false,
        failed: false,
        status: 'active',
        ...overrides,
    };
}

function roster() {
    return [
        { index: 0, isBot: false, alive: true },
        { index: 1, isBot: true, alive: true },
        { index: 2, isBot: true, alive: true },
    ];
}

test('an active bounty hunt objective marks its target bot', () => {
    const state = createObjectiveTargetMarkerState();
    setObjectiveTargetMarkerIndex(state, resolveObjectiveTargetIndex(bountyObjective()));
    const result = updateObjectiveTargetMarkerState(state, { players: roster(), dt: 1 / 60 });

    assert.equal(resolveObjectiveTargetIndex(bountyObjective()), 1);
    assert.equal(result.activeIndex, 1);
    assert.equal(result.target?.index, 1);
    assert.equal(state.activeIndex, 1);
});

test('only bounty hunt objectives resolve a marker target', () => {
    assert.equal(resolveObjectiveTargetIndex(null), null);
    assert.equal(resolveObjectiveTargetIndex({ objectiveId: 'survive_window', targetPlayerIndex: 1 }), null);
    assert.equal(resolveObjectiveTargetIndex(bountyObjective({ targetPlayerIndex: null })), null);
});

test('a completed or failed objective stops resolving a marker target', () => {
    assert.equal(resolveObjectiveTargetIndex(bountyObjective({ completed: true, status: 'completed' })), null);
    assert.equal(resolveObjectiveTargetIndex(bountyObjective({ failed: true, status: 'failed' })), null);
});

test('clearing the target deactivates the marker and reports the removed index', () => {
    const state = createObjectiveTargetMarkerState();
    const players = roster();
    setObjectiveTargetMarkerIndex(state, 1);
    updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    setObjectiveTargetMarkerIndex(state, resolveObjectiveTargetIndex(bountyObjective({ completed: true, status: 'completed' })));
    const cleared = updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    assert.equal(cleared.activeIndex, null);
    assert.equal(cleared.previousIndex, 1);
    assert.equal(cleared.changed, true);
    assert.equal(cleared.target, null);
});

test('a dead target bot deactivates the marker even while the objective stays active', () => {
    const state = createObjectiveTargetMarkerState();
    const players = roster();
    setObjectiveTargetMarkerIndex(state, 1);
    updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    players[1].alive = false;
    const result = updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    assert.equal(result.activeIndex, null);
    assert.equal(result.previousIndex, 1);
    assert.equal(state.targetIndex, 1);
    assert.equal(findObjectiveTargetPlayer(players, 1), null);
});

test('switching the target deactivates the old index and activates the new one', () => {
    const state = createObjectiveTargetMarkerState();
    const players = roster();
    setObjectiveTargetMarkerIndex(state, 1);
    updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    setObjectiveTargetMarkerIndex(state, 2);
    const switched = updateObjectiveTargetMarkerState(state, { players, dt: 1 / 60 });

    assert.equal(switched.previousIndex, 1);
    assert.equal(switched.activeIndex, 2);
    assert.equal(switched.changed, true);
    assert.equal(switched.elapsedSeconds, 0);
});

test('a null target marks nothing at all', () => {
    const state = createObjectiveTargetMarkerState();
    setObjectiveTargetMarkerIndex(state, null);
    const result = updateObjectiveTargetMarkerState(state, { players: roster(), dt: 1 / 60 });

    assert.equal(state.targetIndex, null);
    assert.equal(result.activeIndex, null);
    assert.equal(result.changed, false);
    assert.equal(result.target, null);
});

test('a missing player index never activates the marker', () => {
    const state = createObjectiveTargetMarkerState();
    setObjectiveTargetMarkerIndex(state, 7);
    const result = updateObjectiveTargetMarkerState(state, { players: roster(), dt: 1 / 60 });

    assert.equal(result.activeIndex, null);
});

test('the pulse stays inside its documented scale and opacity range', () => {
    const samples = [0, 0.2, 0.4, 0.7, 1.1, 1.9, 3.3];
    for (const elapsed of samples) {
        const pulse = resolveObjectiveTargetMarkerPulse(elapsed);
        assert.ok(pulse.scale >= 0.9 && pulse.scale <= 1.15, `scale out of range at ${elapsed}`);
        assert.ok(pulse.opacity >= 0.3 && pulse.opacity <= 0.8, `opacity out of range at ${elapsed}`);
    }
});
