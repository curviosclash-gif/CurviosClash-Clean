import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ATMOSPHERE_GRADIENT_GLSL } from '../src/core/renderer/AtmosphereGradient.js';
import { SKY_DOME_SHADER_SOURCES } from '../src/core/renderer/SkyDomeMaterial.js';

import {
    applyAtmosphericFogSettings,
    getAtmosphericFogSettings,
    getAtmosphericFogUniforms,
    installAtmosphericFog,
    isAtmosphericFogInstalled,
    setAtmosphericFogClipDistance,
    uninstallAtmosphericFog,
} from '../src/core/renderer/AtmosphericFogShaderPatch.js';

function assertRgbCloseTo(actual, expected, message) {
    const delta = Math.max(...expected.map((value, index) => Math.abs(actual[index] - value)));
    assert.ok(delta < 0.002, `${message} (got ${actual.map((v) => v.toFixed(4))}, delta ${delta})`);
}

test('opaque fog uses the sky gradient in linear light and map changes reset its uniforms', () => {
    withInstalledFog(() => {
        assert.ok(THREE.ShaderChunk.fog_pars_fragment.includes(ATMOSPHERE_GRADIENT_GLSL));
        assert.ok(SKY_DOME_SHADER_SOURCES.fragment.includes(ATMOSPHERE_GRADIENT_GLSL));
        assert.ok(THREE.ShaderChunk.fog_fragment.includes('linearToOutputTexel( vec4( skyTint, 1.0 ) )'));
        const shared = getAtmosphericFogUniforms();
        const sky = { zenithColor: 0x808080, horizonColor: 0xaabbcc, nadirColor: 0x223344 };
        applyAtmosphericFogSettings({ skyDome: sky, atmosphereColor: 0x556677 });
        assert.equal(shared.fogSkyEnabled.value, 1);
        assert.ok(Math.abs(shared.fogSkyZenith.value.r - 0.21586) < 0.001);
        assert.equal(shared.fogSkyHaze.value.getHex(), 0x556677);
        applyAtmosphericFogSettings({});
        assert.equal(shared.fogSkyEnabled.value, 0, 'direct callers without a sky retain their authored tint');
    });
});

// The shader's closure term, mirrored here so the curve can be measured outside a GPU.
function clipClosure(depth, clip = 200, start = 0.8) {
    const t = Math.min(1, Math.max(0, (depth - clip * start) / (clip - clip * start)));
    return t * t * (3 - 2 * t);
}

function withInstalledFog(run) {
    const freshlyInstalled = installAtmosphericFog();
    try {
        run();
    } finally {
        if (freshlyInstalled) uninstallAtmosphericFog();
    }
}

test('installing replaces all four fog chunks and uninstalling puts them back', () => {
    assert.equal(isAtmosphericFogInstalled(), false, 'the patch starts uninstalled');
    const before = {
        fog_fragment: THREE.ShaderChunk.fog_fragment,
        fog_vertex: THREE.ShaderChunk.fog_vertex,
    };

    assert.equal(installAtmosphericFog(), true);
    assert.equal(installAtmosphericFog(), false, 'installing twice is a no-op');
    assert.notEqual(THREE.ShaderChunk.fog_fragment, before.fog_fragment);
    assert.notEqual(THREE.ShaderChunk.fog_vertex, before.fog_vertex);

    assert.equal(uninstallAtmosphericFog(), true);
    assert.equal(THREE.ShaderChunk.fog_fragment, before.fog_fragment);
    assert.equal(THREE.ShaderChunk.fog_vertex, before.fog_vertex);
});

// The flat look comes from three's ramp saturating at fogFar: everything past it is one identical
// colour. An exponential curve must never contain that plateau.
test('the distance ramp is exponential and never reaches a flat plateau', () => {
    withInstalledFog(() => {
        const source = THREE.ShaderChunk.fog_fragment;
        assert.ok(source.includes('1.0 - exp('), 'the ramp is exponential');
        assert.ok(!source.includes('smoothstep( fogNear, fogFar'), 'the saturating ramp is gone');
    });
});

// A curve may not switch on along a line. Squaring the travel is what buys that: the slope at the
// onset is zero, so the fog appears out of nothing instead of at an edge sitting at fogNear.
test('the fog fades in with zero slope at its onset', () => {
    withInstalledFog(() => {
        assert.ok(
            /1\.0 - exp\( - [\d.]+ \* fogTravel \* fogTravel \)/.test(THREE.ShaderChunk.fog_fragment),
            'the travel is squared inside the exponential'
        );
    });

    // The same curve, evaluated here. A smooth fade is an S: the steps grow to a single steepest
    // point and then ease off again. A plain exponential instead opens with its steepest step of
    // all, which is what puts a visible line at fogNear.
    const rate = 4;
    const curve = (t) => 1 - Math.exp(-rate * t * t);
    const step = 0.01;
    const deltas = [];
    for (let i = 0; i < 100; i += 1) {
        deltas.push(curve((i + 1) * step) - curve(i * step));
    }
    const steepest = deltas.indexOf(Math.max(...deltas));
    assert.ok(steepest > 5, 'the steepest point is not at the very onset');
    for (let i = 1; i < deltas.length; i += 1) {
        const rising = i <= steepest;
        assert.ok(
            rising ? deltas[i] >= deltas[i - 1] - 1e-9 : deltas[i] <= deltas[i - 1] + 1e-9,
            `the ramp has a single steepest point, broken at i=${i}`
        );
    }
    assert.ok(deltas[0] < 0.001, 'the first step out of fogNear is imperceptible');
    // Dense enough at fogFar that the remaining haze cannot pop when the camera's far plane clips it.
    assert.ok(curve(1) > 0.97, 'the fog is effectively opaque by fogFar');
    assert.ok(curve(1) < 1, 'but it still never reaches a hard plateau');
});

// exp(-max(0, y - base) * k) is continuous in value but jumps in slope exactly at the base height,
// which draws a horizontal crease across the scene. The knee has to be rounded.
test('the height falloff has no crease at the layer base', () => {
    withInstalledFog(() => {
        const source = THREE.ShaderChunk.fog_fragment;
        assert.ok(source.includes('fogSoftKnee('), 'the height uses the rounded knee');
        assert.ok(
            !source.includes('max( 0.0, vFogWorldPosition.y'),
            'the hard clamp at the base height is gone'
        );
        assert.ok(
            THREE.ShaderChunk.fog_pars_fragment.includes('float fogSoftKnee( float x, float softness )'),
            'the helper is declared'
        );
    });

    const softness = 6;
    const softKnee = (x) => 0.5 * (x + Math.sqrt(x * x + softness * softness));
    const step = 0.05;
    let previousDelta = null;
    for (let x = -20; x < 20; x += step) {
        const delta = softKnee(x + step) - softKnee(x);
        if (previousDelta !== null) {
            assert.ok(
                Math.abs(delta - previousDelta) < step * 0.2,
                `the slope stays continuous across the base at x=${x.toFixed(2)}`
            );
        }
        previousDelta = delta;
    }
    assert.ok(softKnee(60) > 59.5, 'far above the base it behaves like max()');
    assert.ok(softKnee(-60) < 0.5, 'far below it goes to zero');
});

test('the fog reads a world position, and every varying it reads is declared on both sides', () => {
    withInstalledFog(() => {
        assert.ok(THREE.ShaderChunk.fog_pars_vertex.includes('varying vec3 vFogWorldPosition;'));
        assert.ok(THREE.ShaderChunk.fog_pars_fragment.includes('varying vec3 vFogWorldPosition;'));
        assert.ok(THREE.ShaderChunk.fog_vertex.includes('vFogWorldPosition ='));

        // Rebuilt from mvPosition, not from worldpos_vertex - three only emits that for envmap,
        // shadow and transmission materials, so relying on it would break plain fogged meshes.
        assert.ok(THREE.ShaderChunk.fog_vertex.includes('mat3( viewMatrix )'));
        assert.ok(!THREE.ShaderChunk.fog_vertex.includes('worldPosition'));
        assert.ok(!THREE.ShaderChunk.fog_vertex.includes('inverse('), 'inverse() needs GLSL ES 3.00');

        for (const name of [
            'fogHeightBase', 'fogHeightFalloff', 'fogTurbulence',
            'fogClipDistance', 'fogClipClosureStart',
        ]) {
            assert.ok(
                THREE.ShaderChunk.fog_pars_fragment.includes(`uniform float ${name};`),
                `${name} is declared`
            );
            assert.ok(THREE.ShaderChunk.fog_fragment.includes(name), `${name} is used`);
        }
    });
});

// three clones UniformsLib per material, so a value handed out there could never be updated again.
// The patch therefore injects one shared object - if that ever turns into a copy, a map change would
// silently stop reaching the shader.
test('every material receives the same uniform objects, not copies', () => {
    withInstalledFog(() => {
        const shared = getAtmosphericFogUniforms();
        const first = { uniforms: {} };
        const second = { uniforms: {} };
        const material = new THREE.MeshStandardMaterial();
        material.onBeforeCompile(first, null);
        material.onBeforeCompile(second, null);

        assert.equal(first.uniforms.fogHeightFalloff, shared.fogHeightFalloff);
        assert.equal(second.uniforms.fogHeightFalloff, shared.fogHeightFalloff);
        assert.equal(first.uniforms.fogLowColor, shared.fogLowColor);
        assert.equal(second.uniforms.fogLowColor, shared.fogLowColor);

        applyAtmosphericFogSettings({ height: 12, heightFalloff: 0.04, turbulence: 0.2 });
        assert.equal(first.uniforms.fogHeightFalloff.value, 0.04);
        assert.equal(second.uniforms.fogTurbulence.value, 0.2);
        material.dispose();
    });
});

// Geometry is clipped at the camera's far plane. If the fog has not closed by then, a surface is
// still faintly visible in the frame before it vanishes - a hard ring at a fixed distance.
test('the fog is fully closed by the camera far plane', () => {
    withInstalledFog(() => {
        const source = THREE.ShaderChunk.fog_fragment;
        assert.ok(
            source.includes('smoothstep( fogClipDistance * fogClipClosureStart, fogClipDistance, vFogDepth )'),
            'the last stretch to the clip plane is closed'
        );
        assert.ok(!source.includes('max( fogFactor,'), 'and it is blended in, not maxed over');
    });

    const shared = getAtmosphericFogUniforms();
    assert.equal(setAtmosphericFogClipDistance(200), 200);
    assert.equal(shared.fogClipDistance.value, 200);
    assert.equal(clipClosure(200), 1, 'fully opaque exactly at the far plane');
    assert.equal(clipClosure(160), 0, 'and inactive below where it starts');
    assert.ok(clipClosure(199) > 0.99, 'it arrives without a step');

    // An unusable value must not switch the term on somewhere inside the playable range.
    assert.ok(setAtmosphericFogClipDistance(0) > 1000);
    assert.ok(setAtmosphericFogClipDistance('nonsense') > 1000);
});

test('opted-in arena boundaries release their alpha with the same continuous fog curve', () => {
    withInstalledFog(() => {
        const source = THREE.ShaderChunk.fog_fragment;
        assert.ok(
            source.includes('#ifdef ATMOSPHERIC_FOG_ALPHA_FADE'),
            'alpha fading is an explicit material opt-in'
        );
        assert.ok(
            source.includes('gl_FragColor.a *= 1.0 - clampedFogFactor;'),
            'the wall disappears exactly as the fog closes'
        );
        assert.equal(
            source.match(/clamp\( fogFactor, 0\.0, 1\.0 \)/g)?.length,
            1,
            'RGB and alpha share one clamped fog result'
        );
    });
});

// Where the closure starts was one shared constant, and two maps pulled it in opposite directions:
// tuning it for a thin fog washed a dense one flat from half the view distance onwards. It is a map
// value now, so neither has to be tuned at the other's expense.
test('where the closure starts is stated per map, not shared', () => {
    withInstalledFog(() => {
        assert.ok(
            THREE.ShaderChunk.fog_pars_fragment.includes('uniform float fogClipClosureStart;'),
            'the start is a uniform, not baked into the chunk'
        );
        assert.ok(
            !/fogClipDistance \* 0\.\d/.test(THREE.ShaderChunk.fog_fragment),
            'no fixed fraction is left in the shader source'
        );
    });

    const shared = getAtmosphericFogUniforms();
    applyAtmosphericFogSettings({ clipClosureStart: 0.5 });
    assert.equal(shared.fogClipClosureStart.value, 0.5);

    applyAtmosphericFogSettings({ clipClosureStart: 0 });
    assert.ok(shared.fogClipClosureStart.value >= 0.1, 'a start of zero would fog the whole view');
    applyAtmosphericFogSettings({ clipClosureStart: 5 });
    assert.ok(shared.fogClipClosureStart.value <= 0.95, 'and one at the plane leaves no blend at all');

    // Unstated falls back to the late start, so a map that says nothing keeps its mid range.
    applyAtmosphericFogSettings({});
    assert.equal(shared.fogClipClosureStart.value, 0.8);
});

// The closure is the only term that is not shaped by the map, so it is the one that can put an edge
// into every map at once. It did: max( fogFactor, closure ) has a kink wherever the two curves
// cross, and that crossing sits at a fixed distance from the camera - a shell around the viewer that
// cuts a crisp line across every long wall and leaves one flat colour behind it.
//
// A height-damped layer is what makes the crossing happen inside the playable range at all, so the
// case below is the real one: fog that the height term has capped at 0.4, seen out to the far plane.
test('the closure to the clip plane adds no kink to the fog curve', () => {
    const clip = 200;
    const near = 25;
    const far = 110;
    // Capped by the height falloff, which is what leaves the closure something to do.
    const heightCap = 0.4;
    const natural = (depth) => {
        const travel = Math.max(0, depth - near) / (far - near);
        return (1 - Math.exp(-4 * travel * travel)) * heightCap;
    };
    const blended = (depth) => {
        const closure = clipClosure(depth, clip);
        return natural(depth) + (1 - natural(depth)) * closure;
    };
    const maxed = (depth) => Math.max(natural(depth), clipClosure(depth, clip, 0.8));

    assert.ok(Math.abs(blended(clip) - 1) < 1e-9, 'still fully closed at the far plane');
    assert.ok(Math.abs(blended(90) - natural(90)) < 1e-9, 'and untouched well inside the range');

    // Curvature, sampled as the second difference. A kink is a step in the slope, so it shows up
    // here as a spike far above the curvature the smooth part of the curve ever reaches.
    const step = 0.25;
    const curvature = (curve) => {
        let peak = 0;
        for (let depth = near; depth + 2 * step <= clip; depth += step) {
            const bend = Math.abs(
                curve(depth + 2 * step) - 2 * curve(depth + step) + curve(depth)
            );
            peak = Math.max(peak, bend);
        }
        return peak;
    };

    const kinked = curvature(maxed);
    const smooth = curvature(blended);
    assert.ok(kinked > 4 * smooth, `the old max() form bends ${(kinked / smooth).toFixed(1)}x harder`);
    assert.ok(smooth < 0.0005, 'the blended closure stays gentle over the whole range');

    // Monotone, so the fog can never get thinner as a surface moves away.
    let previous = 0;
    for (let depth = near; depth <= clip; depth += step) {
        const value = blended(depth);
        assert.ok(value >= previous - 1e-9, `the fog never thins out again, broken at ${depth}`);
        previous = value;
    }
});

test('settings are clamped so a bad map profile cannot invert or oversaturate the fog', () => {
    applyAtmosphericFogSettings({
        height: 30, heightFalloff: -5, turbulence: 4,
        colorHigh: 0xffffff, colorLow: 0x102030,
    });
    const applied = getAtmosphericFogSettings();
    assert.equal(applied.height, 30);
    assert.equal(applied.heightFalloff, 0);
    assert.equal(applied.turbulence, 1);
    assertRgbCloseTo(applied.colorHigh, [1, 1, 1], 'the high colour reaches the shader as white');
    assertRgbCloseTo(applied.colorLow, [0.0627, 0.1255, 0.1882], 'the low colour is independent');

    applyAtmosphericFogSettings({ height: 'nonsense', heightFalloff: null, turbulence: undefined });
    const cleared = getAtmosphericFogSettings();
    assert.equal(cleared.height, 0);
    assert.equal(cleared.heightFalloff, 0);
    assert.equal(cleared.turbulence, 0);
});

// The one edge that no amount of density shaping can remove: a fully fogged surface that is not the
// same colour as the sky right behind it keeps a silhouette at any distance. Driving the fog's
// colour from world height did exactly that - a tall, distant building sat at the black end of the
// run while the low sky behind it was still red. The colour therefore runs on the elevation the
// fragment is *seen* at, on the same curve the sky's haze band uses.
test('the fog colour runs on view elevation with independent upper and lower ends', () => {
    withInstalledFog(() => {
        const fragment = THREE.ShaderChunk.fog_fragment;
        assert.ok(
            fragment.includes('normalize( vFogViewOffset ).y'),
            'the tint is chosen by the angle the fragment is seen at'
        );
        assert.ok(
            !fragment.includes('vFogWorldPosition.y )'),
            'and no longer by where the surface happens to sit in the world'
        );
        assert.ok(
            fragment.includes('fogElevation >= 0.0 ? fogHighColor : fogLowColor'),
            'the lower half does not inherit the upper colour'
        );
        assert.ok(fragment.includes('mix( fogEdgeColor, fogColor,'), 'each end meets the horizon');
        assert.ok(THREE.ShaderChunk.fog_pars_fragment.includes('uniform vec3 fogHighColor;'));
        assert.ok(THREE.ShaderChunk.fog_pars_fragment.includes('uniform vec3 fogLowColor;'));
        assert.ok(THREE.ShaderChunk.fog_pars_fragment.includes('varying vec3 vFogViewOffset;'));
        assert.ok(THREE.ShaderChunk.fog_vertex.includes('vFogViewOffset = mvPosition.xyz * mat3( viewMatrix )'));
    });

    // The band keeps the same smooth weight on either side, but the colour it releases to is now
    // selected independently above and below the horizon.
    const band = 0.3;
    const tintWeight = (elevation) => {
        const haze = Math.max(0, 1 - Math.abs(elevation) / band);
        return haze * haze * (3 - 2 * haze);
    };
    assert.equal(tintWeight(0), 1, 'at the horizon the fog is exactly the sky colour');
    assert.equal(tintWeight(band), 0, 'and fully released at the edge of the band');
    assert.equal(tintWeight(-0.1), tintWeight(0.1), 'symmetric around the horizon');
    let previous = 1;
    for (let e = 0; e <= band; e += 0.01) {
        const value = tintWeight(e);
        assert.ok(value <= previous + 1e-9, `the release is monotone, broken at ${e.toFixed(2)}`);
        previous = value;
    }

    // Pure red must arrive as pure red, not as its linear-space value - linear would be 1, 0, 0 too,
    // so a mid grey is the value that actually tells the two spaces apart.
    applyAtmosphericFogSettings({ colorHigh: 0xff0000 });
    assertRgbCloseTo(getAtmosphericFogSettings().colorHigh, [1, 0, 0], 'red stays red');

    applyAtmosphericFogSettings({ colorHigh: 0x808080 });
    const grey = getAtmosphericFogSettings().colorHigh;
    assertRgbCloseTo(grey, [0.5019, 0.5019, 0.5019], 'a mid grey is handed over in output space');
    assert.ok(grey[0] > 0.4, 'not the linear 0.216 that would come from the working space');

    // Unstated low colour keeps the old mirrored behaviour for direct callers.
    assertRgbCloseTo(getAtmosphericFogSettings().colorLow, grey, 'the direct API remains compatible');

    applyAtmosphericFogSettings({ colorHigh: 0x000000, colorLow: 0x804020 });
    assertRgbCloseTo(
        getAtmosphericFogSettings().colorLow,
        [0.5019, 0.251, 0.1255],
        'the ground can stay readable under a black sky'
    );
});
