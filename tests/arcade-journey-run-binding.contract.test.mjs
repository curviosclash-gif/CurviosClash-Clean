import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createArcadeJourneyRunBinding,
    settleArcadeJourneyRun,
} from '../src/core/arcade/ArcadeJourneyRunBinding.js';

function createStore({ failSaves = 0 } = {}) {
    let value = null;
    let remainingFailures = failSaves;
    const saves = [];
    return {
        saves,
        readJsonRecordResult() {
            return value === null ? { status: 'missing' } : { status: 'found', value: structuredClone(value) };
        },
        saveJsonRecord(key, next) {
            saves.push({ key, value: structuredClone(next) });
            if (remainingFailures > 0) {
                remainingFailures -= 1;
                return { success: false };
            }
            value = structuredClone(next);
            return { success: true };
        },
        readValue() { return value === null ? null : structuredClone(value); },
    };
}

function descriptor(overrides = {}) {
    return {
        stageId: 'first_run', runType: 'gauntlet', portalChainId: '', tierId: 'normal', runId: 'journey-run-1',
        participants: [], ...overrides,
    };
}

test('a completed run settles to every frozen profile store exactly once', () => {
    const a = createStore();
    const b = createStore();
    const c = createStore();
    const binding = createArcadeJourneyRunBinding(descriptor({ participants: [
        { profileId: 'profile-a', store: a }, { profileId: 'profile-b', store: b }, { profileId: 'profile-c', store: c },
    ] }));
    assert.ok(binding);
    assert.equal(Object.isFrozen(binding.participants), true);
    assert.equal(Object.isFrozen(binding.participants[0]), true);
    assert.equal(Object.isFrozen(binding.recipients), true);
    assert.equal(Object.isFrozen(binding.recipients[0]), true);

    const result = settleArcadeJourneyRun(binding, { succeeded: true, value: 30000 });
    assert.equal(result.status, 'finished');
    assert.equal(result.medal, 3);
    assert.deepEqual(result.recipients.map((entry) => entry.profileId), ['profile-a', 'profile-b', 'profile-c']);
    for (const store of [a, b, c]) assert.equal(store.readValue().stages.first_run.medals.normal.medal, 3);
    settleArcadeJourneyRun(binding, { succeeded: false, value: 0, aborted: true });
    assert.deepEqual([a, b, c].map((store) => store.saves.length), [1, 1, 1]);
});

test('duplicate profile IDs bind and receive one write only', () => {
    const a = createStore();
    const b = createStore();
    const binding = createArcadeJourneyRunBinding(descriptor({ participants: [
        { profileId: 'profile-a', store: a }, { profileId: 'profile-a', store: a }, { profileId: 'profile-b', store: b },
    ] }));
    assert.ok(binding);
    assert.deepEqual(binding.participants.map(({ profileId }) => profileId), ['profile-a', 'profile-b']);
    const result = settleArcadeJourneyRun(binding, { succeeded: true, value: 4000 });
    assert.equal(result.medal, 2);
    assert.deepEqual([a.saves.length, b.saves.length], [1, 1]);
});

test('a pending store retries the captured result without resaving successful participants', () => {
    const a = createStore();
    const b = createStore({ failSaves: 1 });
    const c = createStore();
    const binding = createArcadeJourneyRunBinding(descriptor({ participants: [
        { profileId: 'profile-a', store: a }, { profileId: 'profile-b', store: b }, { profileId: 'profile-c', store: c },
    ] }));
    const first = settleArcadeJourneyRun(binding, { succeeded: true, value: 4000 });
    assert.equal(first.status, 'pending');
    assert.equal(first.medal, 2);
    assert.deepEqual(first.recipients.map(({ status }) => status), ['saved', 'pending', 'saved']);

    const retry = settleArcadeJourneyRun(binding, { succeeded: true, value: 30000 });
    assert.equal(retry.status, 'finished');
    assert.equal(retry.medal, 2);
    assert.equal(retry.result.value, 4000);
    assert.deepEqual([a.saves.length, b.saves.length, c.saves.length], [1, 2, 1]);
    assert.equal(b.readValue().stages.first_run.medals.normal.medal, 2);
});

test('aborted and medal-zero results finish without writing', () => {
    const cases = [
        { descriptor: descriptor(), outcome: { succeeded: false, value: 30000 } },
        { descriptor: descriptor({ stageId: 'five_portals', runType: 'five_portals', portalChainId: 'five_portals' }), outcome: { succeeded: true, value: 0 } },
        { descriptor: descriptor(), outcome: { succeeded: true, value: 30000, aborted: true } },
    ];
    for (const { descriptor: run, outcome } of cases) {
        const store = createStore();
        const binding = createArcadeJourneyRunBinding({ ...run, participants: [{ profileId: 'p', store }] });
        const result = settleArcadeJourneyRun(binding, outcome);
        assert.equal(result.status, 'finished');
        assert.equal(result.medal, 0);
        assert.equal(store.saves.length, 0);
        assert.equal(result.recipients[0].status, 'not_awarded');
    }
});

test('portal chain and tier are validated exactly, with portal any normalized to normal', () => {
    assert.equal(createArcadeJourneyRunBinding(descriptor({ stageId: 'five_portals', runType: 'gauntlet', portalChainId: 'five_portals' })), null);
    assert.equal(createArcadeJourneyRunBinding(descriptor({ stageId: 'five_portals', runType: 'five_portals', portalChainId: 'sky_ladder' })), null);
    assert.equal(createArcadeJourneyRunBinding(descriptor({ stageId: 'first_run', runType: 'gauntlet', tierId: 'any' })), null);
    const store = createStore();
    const binding = createArcadeJourneyRunBinding(descriptor({
        stageId: 'five_portals', runType: 'five_portals', portalChainId: 'five_portals', tierId: 'any',
        participants: [{ profileId: 'p', store }],
    }));
    assert.ok(binding);
    assert.equal(binding.tierId, 'normal');
});

test('invalid stage, run ID, tier, and incomplete participant bindings fail closed', () => {
    const store = createStore();
    const invalid = [
        descriptor({ stageId: 'unknown', participants: [{ profileId: 'p', store }] }),
        descriptor({ runId: ' ', participants: [{ profileId: 'p', store }] }),
        descriptor({ tierId: 'nightmare+', participants: [{ profileId: 'p', store }] }),
        descriptor({ participants: [{ profileId: '', store }] }),
        descriptor({ participants: [{ profileId: 'p', store: {} }] }),
        descriptor({ participants: [] }),
    ];
    for (const value of invalid) assert.equal(createArcadeJourneyRunBinding(value), null);
    assert.equal(settleArcadeJourneyRun({}, { succeeded: true, value: 30000 }).status, 'invalid');
});
