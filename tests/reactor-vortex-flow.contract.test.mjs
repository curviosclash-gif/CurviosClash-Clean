import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVortexProfile, sampleVortexStream, vortexTravel } from '../src/entities/effects/ReactorVortexFlow.js';

const shape = { radius: 100, tubeRadius: 25, tubeHeight: 20, stemRadius: 30, base: 0, height: 200 };
const sample = (phase) => sampleVortexStream({}, phase, 0, shape);

test('smoke feeds continuously from the stem and rolls up, out, down and inward', () => {
    assert.ok(sample(.2).ty > 0);
    const a = sample(.45 - 1e-8), b = sample(.45);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) < .0001);
    assert.ok(Math.hypot(a.tx-b.tx,a.ty-b.ty,a.tz-b.tz) < .0001, 'joining tangents agree');
    assert.ok(b.ty > .99, 'inner rim rises');
    assert.ok(sample(.45+.55*.25).tx > .99, 'top moves outward');
    assert.ok(sample(.45+.55*.5).ty < -.99, 'outer rim descends');
    assert.ok(sample(.45+.55*.75).tx < -.99, 'underside turns inward');
});

test('four deterministic circulation profiles slow down as the cloud settles', () => {
    const speeds = new Set();
    for (let i=1;i<=4;i++) {
        const profile = resolveVortexProfile(i);
        const early = vortexTravel(5,profile)-vortexTravel(4,profile);
        const late = vortexTravel(41,profile)-vortexTravel(40,profile);
        assert.ok(early > late*5 && late > 0);
        speeds.add(early);
        assert.equal(vortexTravel(-1,profile),0);
    }
    assert.equal(speeds.size,4);
});
