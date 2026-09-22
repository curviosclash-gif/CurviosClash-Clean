import assert from 'node:assert/strict';
import test from 'node:test';
import { createHearingMuffle, MUFFLE_NEUTRAL_HZ } from '../src/core/audio/HearingMuffle.js';

function param(value) {
    const calls = [];
    return {
        value,
        calls,
        setValueAtTime: (v, t) => calls.push(['set', v, t]),
        exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
        linearRampToValueAtTime: (v, t) => calls.push(['lin', v, t]),
        cancelScheduledValues: (t) => calls.push(['cancel', t]),
    };
}

function node(kind) {
    return { kind, targets: [], connect(target) { this.targets.push(target); return target; }, disconnect() { this.targets = []; } };
}

function fakeContext() {
    const created = [];
    return {
        currentTime: 10,
        created,
        createBiquadFilter() {
            const filter = { ...node('filter'), type: 'peaking', frequency: param(350), Q: param(1) };
            created.push(filter); return filter;
        },
        createOscillator() {
            const osc = { ...node('osc'), type: 'square', frequency: param(440), started: [], stopped: [],
                start(t) { this.started.push(t); }, stop(t) { this.stopped.push(t); } };
            created.push(osc); return osc;
        },
        createGain() {
            const gain = { ...node('gain'), gain: param(1) };
            created.push(gain); return gain;
        },
    };
}

test('world buses run through one neutral low-pass; music and ui stay outside it', () => {
    const ctx = fakeContext();
    const master = node('master');
    const buses = [node('sfx'), node('engine'), node('ambience')];
    const muffle = createHearingMuffle(ctx, buses, master);
    const filter = ctx.created.find((entry) => entry.kind === 'filter');
    assert.equal(filter.type, 'lowpass');
    assert.equal(filter.frequency.value, MUFFLE_NEUTRAL_HZ);
    for (const bus of buses) assert.deepEqual(bus.targets, [filter]);
    assert.deepEqual(filter.targets, [master]);
    assert.ok(muffle);
});

test('a close bang dulls the world after its first crack, rings, and fully recovers', () => {
    const ctx = fakeContext();
    const master = node('master');
    const muffle = createHearingMuffle(ctx, [node('sfx')], master);
    const filter = ctx.created.find((entry) => entry.kind === 'filter');
    muffle.trigger(1, 3);
    const ramps = filter.frequency.calls.filter(([kind]) => kind === 'exp');
    const lowest = Math.min(...ramps.map(([, value]) => value));
    assert.ok(lowest < 600, 'hearing closes down to a dull thud');
    const first = ramps.find(([, value]) => value === lowest);
    assert.ok(first[2] >= ctx.currentTime + 0.12, 'the crack of the bang itself stays clear');
    const last = ramps[ramps.length - 1];
    assert.equal(last[1], MUFFLE_NEUTRAL_HZ, 'hearing returns to neutral');
    assert.ok(last[2] >= ctx.currentTime + 3, 'recovery takes the requested time');

    const osc = ctx.created.find((entry) => entry.kind === 'osc');
    assert.equal(osc.type, 'sine');
    assert.ok(osc.frequency.value > 3000 && osc.frequency.value < 5000, 'a high ring');
    assert.equal(osc.started.length, 1);
    assert.ok(osc.stopped[0] >= ctx.currentTime + 3, 'the ring ends with the recovery');
    const ringGain = osc.targets[0];
    assert.equal(ringGain.targets[0], master, 'the ring bypasses the low-pass');
    const peak = Math.max(...ringGain.gain.calls.map(([, value]) => value));
    assert.ok(peak > 0 && peak <= 0.05, 'the ring stays quiet');
});

test('a weaker bang dulls less, and none at all does nothing', () => {
    const lowestFor = (intensity) => {
        const ctx = fakeContext();
        const muffle = createHearingMuffle(ctx, [node('sfx')], node('master'));
        muffle.trigger(intensity, 2);
        const filter = ctx.created.find((entry) => entry.kind === 'filter');
        const ramps = filter.frequency.calls.filter(([kind]) => kind === 'exp');
        return { lowest: ramps.length ? Math.min(...ramps.map(([, value]) => value)) : MUFFLE_NEUTRAL_HZ, ctx };
    };
    assert.ok(lowestFor(0.3).lowest > lowestFor(1).lowest);
    const none = lowestFor(0);
    assert.equal(none.lowest, MUFFLE_NEUTRAL_HZ);
    assert.equal(none.ctx.created.filter((entry) => entry.kind === 'osc').length, 0);
});

test('without a filter node the buses connect straight to the master', () => {
    const ctx = fakeContext();
    delete ctx.createBiquadFilter;
    const master = node('master');
    const bus = node('sfx');
    const muffle = createHearingMuffle(ctx, [bus], master);
    assert.deepEqual(bus.targets, [master]);
    assert.doesNotThrow(() => muffle.trigger(1, 2));
});
