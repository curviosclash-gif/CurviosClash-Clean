import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_VIEW_DISTANCE,
    isAutomaticViewDistance,
    normalizeViewDistance,
    resolveFogRange,
    resolveViewDistanceLabel,
    VIEW_DISTANCE_AUTO,
    VIEW_DISTANCE_MAX,
    VIEW_DISTANCE_MIN,
} from '../src/shared/contracts/ViewDistanceContract.js';
import { resolveMapBrightnessFactors } from '../src/shared/contracts/MapBrightnessContract.js';

// Basiswerte des Grafikstils 'Neu'.
const BASE_NEAR = 55;
const BASE_FAR = 190;

test('view distance defaults to automatic', () => {
    assert.equal(DEFAULT_VIEW_DISTANCE, VIEW_DISTANCE_AUTO);
    assert.equal(VIEW_DISTANCE_AUTO, 0);
    assert.equal(isAutomaticViewDistance(DEFAULT_VIEW_DISTANCE), true);
    assert.equal(isAutomaticViewDistance(120), false);
});

test('view distance normalization snaps to steps and clamps to the usable range', () => {
    assert.equal(normalizeViewDistance(120), 120);
    assert.equal(normalizeViewDistance(123), 120);
    assert.equal(normalizeViewDistance(126), 130);

    assert.equal(normalizeViewDistance(5), VIEW_DISTANCE_MIN);
    assert.equal(normalizeViewDistance(9999), VIEW_DISTANCE_MAX);

    // Alles <= 0 ist 'Automatisch', kaputte Eingaben fallen auf den Default zurueck.
    assert.equal(normalizeViewDistance(0), VIEW_DISTANCE_AUTO);
    assert.equal(normalizeViewDistance(-40), VIEW_DISTANCE_AUTO);
    assert.equal(normalizeViewDistance('nope'), DEFAULT_VIEW_DISTANCE);
    assert.equal(normalizeViewDistance(null), DEFAULT_VIEW_DISTANCE);
    assert.equal(normalizeViewDistance(undefined), DEFAULT_VIEW_DISTANCE);
    assert.equal(normalizeViewDistance(Number.NaN), DEFAULT_VIEW_DISTANCE);
});

test('automatic view distance is independent of the map brightness', () => {
    const auto = (brightness) => resolveFogRange({
        viewDistance: VIEW_DISTANCE_AUTO,
        brightnessFogFactor: resolveMapBrightnessFactors(brightness).fog,
        baseNear: BASE_NEAR,
        baseFar: BASE_FAR,
    });

    for (const brightness of ['dunkel', 'mittel', 'hell']) {
        assert.deepEqual(auto(brightness), { near: 55, far: 190 });
    }
});

test('an explicit view distance overrides the brightness for every level', () => {
    for (const brightness of ['dunkel', 'mittel', 'hell']) {
        const range = resolveFogRange({
            viewDistance: 140,
            brightnessFogFactor: resolveMapBrightnessFactors(brightness).fog,
            baseNear: BASE_NEAR,
            baseFar: BASE_FAR,
        });
        assert.equal(range.far, 140, `Sichtweite muss bei '${brightness}' gewinnen`);
    }
});

test('fog onset scales with the range so the gradient keeps its shape', () => {
    const baseRatio = BASE_NEAR / BASE_FAR;
    for (const distance of [20, 60, 140, 190]) {
        const range = resolveFogRange({
            viewDistance: distance,
            baseNear: BASE_NEAR,
            baseFar: BASE_FAR,
        });
        assert.equal(range.far, distance);
        assert.ok(Math.abs(range.near / range.far - baseRatio) < 1e-9);
        assert.ok(range.near < range.far);
    }
});

test('fog range survives a degenerate base without dividing by zero', () => {
    const range = resolveFogRange({ viewDistance: 100, baseNear: 0, baseFar: 0 });
    assert.equal(range.far, 100);
    assert.equal(range.near, 0);
    assert.ok(Number.isFinite(range.near));
});

test('view distance label reads as Automatisch only at zero', () => {
    assert.equal(resolveViewDistanceLabel(0), 'Automatisch');
    assert.equal(resolveViewDistanceLabel(-5), 'Automatisch');
    assert.equal(resolveViewDistanceLabel(120), '120');
    assert.equal(resolveViewDistanceLabel(9999), String(VIEW_DISTANCE_MAX));
});
