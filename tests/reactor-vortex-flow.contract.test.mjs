import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVortexProfile, sampleVortexStream, smokeHeat, stemWidthAt, vortexTravel } from '../src/entities/effects/ReactorVortexFlow.js';

const shape = { radius: 100, tubeRadius: 25, tubeHeight: 20, stemRadius: 30, base: 0, height: 200 };
const sample = (phase) => sampleVortexStream({}, phase, 0, shape);

test('stem profile keeps lower and upper width ratios with no pinched middle', () => {
    assert.equal(stemWidthAt(.1),3);
    assert.equal(stemWidthAt(.9),2);
    let previous=3;
    for(let h=0;h<=1;h+=.01){const width=stemWidthAt(h);assert.ok(width<=previous+1e-10 && width>=2);previous=width;}
    assert.equal(sample(0).x,shape.stemRadius*.5*3);
});

test('individual embers survive ascent and cool at distinct bounded rates', () => {
    for(let variant=1;variant<=4;variant++){
        const profile=resolveVortexProfile(variant);
        assert.ok(smokeHeat(12,2,profile)>.05);
        assert.ok(smokeHeat(30,2,profile)<smokeHeat(12,2,profile));
        assert.notEqual(smokeHeat(12,1,profile),smokeHeat(12,2,profile));
    }
});

test('stream widening uses the exported stem height rather than the roll height', () => {
    const unequal={...shape,stemHeight:160};
    for(const h of [.1,.5,.9]) {
        const s=h*unequal.stemHeight/(unequal.height-unequal.base);
        const point=sampleVortexStream({},s*.45,0,unequal);
        const bend=s**4*(5-4*s);
        const expected=unequal.stemRadius*.5*stemWidthAt(h)*(1-bend)+(unequal.radius-unequal.tubeRadius)*bend;
        assert.ok(Math.abs(point.x-expected)<1e-8);
        assert.ok(Math.abs(point.y-h*unequal.stemHeight)<1e-8);
    }
});

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
