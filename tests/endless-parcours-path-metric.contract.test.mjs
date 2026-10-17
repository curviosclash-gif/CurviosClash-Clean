import test from 'node:test';
import assert from 'node:assert/strict';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { EndlessParcoursPathMetric, createEndlessPathSample } from '../src/entities/endless/EndlessParcoursPathMetric.js';
import { generateEndlessParcoursSequence } from '../src/entities/endless/EndlessParcoursGenerator.js';
import { resolveModuleCenterAtZ } from '../src/entities/endless/EndlessParcoursModuleBuilder.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(
    Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`
);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function assertFrame(frame) {
    for (const vector of [frame.position, frame.tangent, frame.right, frame.up]) {
        assert.ok(Object.values(vector).every(Number.isFinite));
    }
    const { tangent: t, right: r, up: u } = frame;
    for (const v of [t, r, u]) near(dot(v, v), 1);
    near(dot(t, r), 0); near(dot(t, u), 0); near(dot(r, u), 0);
    near(r.y * u.z - r.z * u.y, t.x);
    near(r.z * u.x - r.x * u.z, t.y);
    near(r.x * u.y - r.y * u.x, t.z);
}

test('1000 generated modules preserve seed, frozen tier and the existing centreline', () => {
    const path = new EndlessParcoursPath({ baseSeed: 130707 });
    const expected = generateEndlessParcoursSequence(130707, 1000, 4);
    const metric = path.getMetric(), frame = createEndlessPathSample(), projected = createEndlessPathSample();
    let previousEnd = 0, bent = 0;
    for (let index = 0; index < 1000; index++) {
        const module = path.getModule(index, 4);
        assert.deepEqual(module, expected[index]);
        assert.deepEqual(path.getModule(index, 9), module, 'reloading freezes the original tier');
        const range = metric.getStationRange(index, {});
        near(range.startS, previousEnd);
        assert.ok(range.endS > range.startS);
        assert.ok(range.lengthS >= module.length - 1e-8);
        if (module.entryDrift.x !== module.exitDrift.x || module.entryDrift.y !== module.exitDrift.y) {
            assert.ok(range.lengthS > module.length + 0.01, 'arc length includes the bend');
            bent++;
        }
        for (const fraction of [0, 0.17, 0.5, 0.89]) {
            const s = range.startS + fraction * range.lengthS;
            assert.equal(metric.sampleAtS(s, frame), frame);
            assert.equal(frame.moduleIndex, index);
            assertFrame(frame);
            const center = resolveModuleCenterAtZ(module, frame.position.z);
            near(frame.position.x, center.x, 1e-6);
            near(frame.position.y, center.y, 1e-6);
            metric.projectPoint(frame.position, projected);
            near(projected.s, s, 0.25);
            assert.equal(projected.moduleIndex, index);
            near(projected.distanceSquared, 0, 1e-12);
        }
        previousEnd = range.endS;
    }
    assert.ok(bent > 100);
    assert.equal(metric.getModuleCount(), 1000);
    near(metric.totalLength, previousEnd);
});

test('shared seams have continuous positions and C1 frames with a canonical following module', () => {
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    path.getModule(100, 8);
    const metric = path.getMetric();
    const before = createEndlessPathSample(), after = createEndlessPathSample();
    for (let index = 1; index <= 100; index++) {
        const s = metric.getStationRange(index).startS;
        metric.sampleAtS(s - 1e-6, before); metric.sampleAtS(s, after);
        assert.equal(after.moduleIndex, index);
        for (const key of ['position', 'tangent', 'right', 'up']) {
            for (const axis of ['x', 'y', 'z']) near(before[key][axis], after[key][axis], 2e-6);
        }
        assertFrame(after);
    }
});

test('projection handles off-curve inputs, aliased output, endpoints and retained outputs', () => {
    const metric = new EndlessParcoursPathMetric();
    const module = { moduleIndex: 0, originZ: 0, length: 120,
        entryDrift: { x: 3, y: 5 }, exitDrift: { x: 3, y: 5 } };
    metric.appendModule(module);
    near(metric.totalLength, 120);
    const frame = createEndlessPathSample();
    frame.position = { x: 13, y: 25, z: 40 };
    assert.equal(metric.projectPoint(frame.position, frame), frame);
    near(frame.s, 40, 1e-6); near(frame.distanceSquared, 500, 1e-9);
    near(metric.projectPoint({ x: 3, y: 5, z: -20 }).s, 0);
    near(metric.projectPoint({ x: 3, y: 5, z: 200 }).s, 120);
    near(metric.sampleAtS(-1).s, 0); near(metric.sampleAtS(Infinity).s, 120);
    near(metric.sampleAtS(NaN).s, 0);
    const retained = metric.getStationRange(0, {});
    metric.appendModule({ ...module, moduleIndex: 1, originZ: 120 });
    assert.deepEqual(retained, { moduleIndex: 0, startS: 0, endS: 120, lengthS: 120 });
    assert.equal(metric.projectPoint({ x: NaN, y: 0, z: 0 }), null);
    assert.equal(metric.getStationRange(-1), null);
    assert.equal(metric.getStationRange(0.5), null);
});

test('bent arc length agrees with an independent dense chord integral and nearest-point search', () => {
    const metric = new EndlessParcoursPathMetric();
    const module = { moduleIndex: 0, originZ: 0, length: 120,
        entryDrift: { x: -42, y: -12 }, exitDrift: { x: 42, y: 30 } };
    metric.appendModule(module);
    let previous = { x: -42, y: -12, z: 0 }, chordLength = 0;
    const points = [];
    for (let step = 1; step <= 20000; step++) {
        const z = step * 120 / 20000;
        const next = { ...resolveModuleCenterAtZ(module, z), z };
        chordLength += Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z);
        previous = next; points.push(next);
    }
    near(metric.totalLength, chordLength, 1e-6);
    for (const point of [{ x: 20, y: -5, z: 40 }, { x: -10000, y: 7000, z: 90 }, { x: 10000, y: -7000, z: 30 }]) {
        const projected = metric.projectPoint(point);
        const distance = (p) => (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2;
        const denseBest = points.reduce((best, p) => Math.min(best, distance(p)), distance({ x: -42, y: -12, z: 0 }));
        assert.ok(projected.distanceSquared <= denseBest + 1e-6);
    }
});

test('invalid or discontinuous modules fail without changing the metric; ten restarts release caches', () => {
    const metric = new EndlessParcoursPathMetric();
    const module = { moduleIndex: 0, originZ: 0, length: 120,
        entryDrift: { x: 0, y: 0 }, exitDrift: { x: 1, y: 2 } };
    for (const invalid of [{ ...module, moduleIndex: 1 }, { ...module, length: 0 }, { ...module, originZ: Infinity }]) {
        assert.throws(() => metric.appendModule(invalid), RangeError);
        assert.equal(metric.getModuleCount(), 0);
    }
    metric.appendModule(module);
    assert.throws(() => metric.appendModule({ ...module, moduleIndex: 1, originZ: 120 }), RangeError);
    assert.equal(metric.getModuleCount(), 1);
    const path = new EndlessParcoursPath({ baseSeed: 42 });
    let expected;
    for (let restart = 0; restart < 10; restart++) {
        const last = path.getModule(99, 3);
        expected ??= last;
        assert.deepEqual(last, expected);
        const sameMetric = path.getMetric();
        assert.equal(sameMetric.getModuleCount(), 100);
        path.dispose();
        assert.equal(path.getChainLength(), 0);
        assert.equal(sameMetric.totalLength, 0);
        assert.equal(sameMetric.sampleAtS(1), null);
        assert.equal(sameMetric.projectPoint({ x: 0, y: 0, z: 0 }), null);
    }
});
