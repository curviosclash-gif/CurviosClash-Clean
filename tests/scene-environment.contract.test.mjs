import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    applySkyGradientColors,
    resolveEnvironmentKey,
} from '../src/core/renderer/SceneEnvironmentFactory.js';
import {
    createSkyDomeMaterial,
    SKY_DOME_SHADER_SOURCES,
    updateSkyDomeMaterial,
} from '../src/core/renderer/SkyDomeMaterial.js';
import { resolveMapLighting } from '../src/shared/contracts/MapLightingContract.js';

const SKY = Object.freeze({
    zenithColor: 0x000000,
    horizonColor: 0xff0000,
    nadirColor: 0x0000ff,
});

test('the sky gradient reaches its three authored colours at top, horizon and bottom', () => {
    const radius = 10;
    const geometry = new THREE.SphereGeometry(radius, 8, 6);
    const colors = applySkyGradientColors(geometry, SKY, radius);
    const positions = geometry.getAttribute('position');
    const sample = new THREE.Color();

    let checkedTop = false;
    let checkedHorizon = false;
    let checkedBottom = false;
    for (let i = 0; i < positions.count; i += 1) {
        const y = positions.getY(i) / radius;
        sample.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
        if (y > 0.999) {
            assert.ok(sample.r < 0.01 && sample.b < 0.01, 'the zenith stays the authored zenith');
            checkedTop = true;
        } else if (Math.abs(y) < 0.001) {
            assert.ok(sample.r > 0.99, 'the horizon stays the authored horizon');
            checkedHorizon = true;
        } else if (y < -0.999) {
            assert.ok(sample.b > 0.99 && sample.r < 0.01, 'the nadir stays the authored nadir');
            checkedBottom = true;
        }
    }
    assert.ok(checkedTop && checkedHorizon && checkedBottom, 'all three bands were sampled');
});

test('the gradient reuses an existing colour attribute instead of growing the geometry', () => {
    const radius = 10;
    const geometry = new THREE.SphereGeometry(radius, 8, 6);
    const first = applySkyGradientColors(geometry, SKY, radius);
    const second = applySkyGradientColors(geometry, {
        zenithColor: 0x00ff00,
        horizonColor: 0x00ff00,
        nadirColor: 0x00ff00,
    }, radius);

    assert.equal(first, second, 'a second pass writes into the same buffer');
    assert.ok(second.getY(0) > 0.99, 'the repaint actually took');
});

test('the visible sky evaluates its normalized direction per fragment with the shared haze curve', () => {
    const material = createSkyDomeMaterial();

    assert.equal(material.isShaderMaterial, true);
    assert.equal(material.side, THREE.BackSide);
    assert.equal(material.depthWrite, false);
    assert.equal(material.fog, false);
    assert.equal(material.toneMapped, false);
    assert.match(SKY_DOME_SHADER_SOURCES.vertex, /normalize\( position \)/);
    assert.match(SKY_DOME_SHADER_SOURCES.fragment, /normalize\( vSkyDirection \)/);
    assert.match(SKY_DOME_SHADER_SOURCES.fragment, /pow\( elevation, 0\.62 \)/);
    assert.match(SKY_DOME_SHADER_SOURCES.fragment, /pow\( -elevation, 0\.70 \)/);
    assert.match(SKY_DOME_SHADER_SOURCES.fragment, /smoothstep\( 0\.0, 1\.0, hazeNearness \)/);
    assert.match(SKY_DOME_SHADER_SOURCES.fragment, /#include <colorspace_fragment>/);
});

test('the visible sky mutates existing uniform colours across map changes', () => {
    const material = createSkyDomeMaterial();
    const uniforms = material.uniforms;
    const zenith = uniforms.zenithColor.value;
    const haze = uniforms.hazeColor.value;

    updateSkyDomeMaterial(material, SKY, 0x112233);
    updateSkyDomeMaterial(material, {
        zenithColor: 0x00ff00,
        horizonColor: 0x00ffff,
        nadirColor: 0x000000,
    }, 0x445566);

    assert.equal(material.uniforms, uniforms);
    assert.equal(uniforms.zenithColor.value, zenith);
    assert.equal(uniforms.hazeColor.value, haze);
    assert.equal(uniforms.zenithColor.value.getHex(), 0x00ff00);
    assert.equal(uniforms.hazeColor.value.getHex(), 0x445566);
});

test('the classic style keeps the neutral room reflection', () => {
    const lighting = resolveMapLighting(undefined, undefined);
    assert.equal(resolveEnvironmentKey('classic', lighting), 'room');
});

test('a map lighting profile produces its own reflection', () => {
    const base = resolveMapLighting(undefined, undefined);
    const warm = resolveMapLighting({
        skyDome: { zenithColor: 0x120800, horizonColor: 0xff9944, nadirColor: 0x050303 },
    }, undefined);

    const baseKey = resolveEnvironmentKey('modern', base);
    const warmKey = resolveEnvironmentKey('modern', warm);

    assert.ok(baseKey.startsWith('sky|'), 'the modern style reflects the scene sky');
    assert.notEqual(warmKey, baseKey, 'a different sky must not reuse the previous reflection');
});

// A PMREM prefilter is far too expensive to run whenever a slider moves. The reflection only shows
// sky and key light, so nothing else may enter the key.
test('brightness and view distance never trigger a reflection rebuild', () => {
    const lighting = resolveMapLighting({
        skyDome: { zenithColor: 0x010203, horizonColor: 0x040506, nadirColor: 0x070809 },
        key: { color: 0xffeedd, intensity: 1.25, direction: [10, 20, 30] },
    }, undefined);
    const key = resolveEnvironmentKey('modern', lighting);

    // Same lighting resolved again - as _applySceneAppearance does on every brightness change.
    const repeated = resolveEnvironmentKey('modern', resolveMapLighting({
        skyDome: { zenithColor: 0x010203, horizonColor: 0x040506, nadirColor: 0x070809 },
        key: { color: 0xffeedd, intensity: 1.25, direction: [10, 20, 30] },
    }, undefined));

    assert.equal(repeated, key);
});
