import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { resolveEnvironmentKey } from '../src/core/renderer/SceneEnvironmentFactory.js';
import { resolveMapLighting } from '../src/shared/contracts/MapLightingContract.js';

// The magma map's own values - the point of the seam is that these two are deliberately different.
const FOG_COLOR = 0x2a0c06;
const HORIZON_COLOR = 0x6b2410;
const ZENITH_COLOR = 0x140603;

const MAP_LIGHTING = Object.freeze({
    fog: { color: FOG_COLOR, near: 30, far: 130 },
    skyDome: { zenithColor: ZENITH_COLOR, horizonColor: HORIZON_COLOR, nadirColor: 0x40100a },
});

function createRig() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    return new SceneLightingRig({ scene, renderer: { toneMappingExposure: 1 }, config: CONFIG });
}

function applyStyle(rig, graphicsStyle) {
    return rig.apply({
        graphicsStyle,
        mapLighting: MAP_LIGHTING,
        brightnessFactors: { exposure: 1, ambient: 1, fog: 1 },
        viewDistance: 0,
    });
}

// The dome carries its gradient as vertex colours, so a band is read back by finding the vertex
// closest to the wanted height rather than by evaluating the curve a second time.
function sampleDomeColor(rig, normalizedHeight) {
    const geometry = rig.skyDome.geometry;
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const radius = Math.max(1, rig._skyRadius);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < positions.count; i += 1) {
        const distance = Math.abs(positions.getY(i) / radius - normalizedHeight);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }
    assert.ok(bestDistance < 0.05, `the dome has a vertex band near height ${normalizedHeight}`);
    return new THREE.Color(colors.getX(bestIndex), colors.getY(bestIndex), colors.getZ(bestIndex));
}

function assertColorMatchesHex(actual, expectedHex, message) {
    const expected = new THREE.Color().setHex(expectedHex);
    const delta = Math.max(
        Math.abs(actual.r - expected.r),
        Math.abs(actual.g - expected.g),
        Math.abs(actual.b - expected.b),
    );
    assert.ok(delta < 0.02, `${message} (delta ${delta.toFixed(4)})`);
}

// three includes fog_fragment after tonemapping_fragment and colorspace_fragment, and uploads
// fogColor in the output colour space. A fully fogged surface therefore displays the authored fog
// colour unchanged by ACES, and only an untone-mapped sky displays its authored colours the same
// way. Switching this on would darken the sky alone and reopen the seam the haze band closes.
test('the visible sky stays out of tone mapping, like the fog it has to meet', () => {
    const rig = createRig();
    assert.equal(rig.skyDome.material.toneMapped, false);
});

// By default the distance takes the sky's horizon colour rather than the authored fog colour: a fog
// darker than the sky turns the far field into a black plate instead of into depth.
test('distant surfaces fade into the sky, not into the authored fog colour', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    const rig = new SceneLightingRig({ scene, renderer: { toneMappingExposure: 1 }, config: CONFIG });
    applyStyle(rig, 'modern');

    assert.equal(scene.fog.color.getHex(), HORIZON_COLOR, 'the scene fog took the horizon colour');
    assert.notEqual(scene.fog.color.getHex(), FOG_COLOR, 'and not the darker authored one');
    assertColorMatchesHex(sampleDomeColor(rig, 0), HORIZON_COLOR, 'the horizon band matches it');
});

// A map that deliberately wants a void behind it can still dial the blend back.
test('skyBlend 0 hands the distance back to the authored fog colour', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    const rig = new SceneLightingRig({ scene, renderer: { toneMappingExposure: 1 }, config: CONFIG });
    rig.apply({
        graphicsStyle: 'modern',
        mapLighting: { ...MAP_LIGHTING, fog: { ...MAP_LIGHTING.fog, skyBlend: 0 } },
        brightnessFactors: { exposure: 1, ambient: 1, fog: 1 },
        viewDistance: 0,
    });

    assert.equal(scene.fog.color.getHex(), FOG_COLOR);
    assertColorMatchesHex(sampleDomeColor(rig, 0), FOG_COLOR, 'the band follows the fog either way');
});

test('the haze stays at the horizon and leaves the zenith alone', () => {
    const rig = createRig();
    applyStyle(rig, 'modern');
    assertColorMatchesHex(sampleDomeColor(rig, 1), ZENITH_COLOR, 'the zenith keeps its authored colour');


    const upper = sampleDomeColor(rig, 0.5);
    const horizon = sampleDomeColor(rig, 0);
    assert.notEqual(upper.getHex(), horizon.getHex(), 'the band is a gradient, not a flat repaint');
});

// The classic style hid the dome entirely and cleared to a fixed background colour, so a map with
// its own fog colour showed a seam there too - before tone mapping even entered the picture. The
// haze closes that seam without repainting the complete sky as a flat plate.
test('the classic style closes the horizon while retaining the map sky gradient', () => {
    const rig = createRig();
    applyStyle(rig, 'classic');
    assert.equal(rig.skyDome.visible, true, 'classic needs a sky to meet the fog at');
    assertColorMatchesHex(sampleDomeColor(rig, 0), HORIZON_COLOR, 'classic closes the horizon seam');
    assertColorMatchesHex(sampleDomeColor(rig, 1), ZENITH_COLOR, 'classic keeps the authored zenith');
    assert.notEqual(
        sampleDomeColor(rig, 0.5).getHex(),
        sampleDomeColor(rig, 0).getHex(),
        'classic open sky does not collapse into one flat colour'
    );
});

// The reflection is a blurred mirror; a horizon haze band is invisible in it. Letting the fog colour
// into the key would rebuild the PMREM prefilter for nothing.
test('the fog colour never triggers a reflection rebuild', () => {
    const base = resolveMapLighting(MAP_LIGHTING, undefined);
    const recoloured = resolveMapLighting({ ...MAP_LIGHTING, fog: { ...MAP_LIGHTING.fog, color: 0x00ff00 } }, undefined);
    assert.equal(resolveEnvironmentKey('modern', recoloured), resolveEnvironmentKey('modern', base));
});
