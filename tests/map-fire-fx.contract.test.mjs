import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_FIRE_FX } from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireFx.js';
import { MapFireFxController } from '../src/entities/arena/MapFireFxController.js';
import {
    MAP_FIRE_FX_LIMITS,
    normalizeMapFireFx,
} from '../src/shared/contracts/MapFireFxContract.js';

test('map fire FX accepts a bounded deterministic presentation profile', () => {
    const normalized = normalizeMapFireFx(NOTRE_DAME_FIRE_FX);
    assert.ok(normalized);
    assert.equal(normalized.emitters.length, 3);
    assert.ok(normalized.smoke.count > 0);
    assert.ok(normalized.embers.count > 0);
    assert.ok(normalized.ash.count > 0);
    assert.ok(normalized.flicker.length > 0);
    assert.ok(normalized.smoke.count <= MAP_FIRE_FX_LIMITS.maxParticlesPerLayer);
    assert.equal(Object.isFrozen(normalized), true);

    const capped = normalizeMapFireFx({
        emitters: Array.from({ length: 20 }, () => ({ position: [0, 0, 0] })),
        smoke: { count: 10000 },
        embers: { count: -4 },
        flicker: Array.from({ length: 20 }, (_, index) => ({
            lightId: `light-${index}`,
            amplitude: 8,
        })),
    });
    assert.equal(capped.emitters.length, MAP_FIRE_FX_LIMITS.maxEmitters);
    assert.equal(capped.smoke.count, MAP_FIRE_FX_LIMITS.maxParticlesPerLayer);
    assert.equal(capped.embers.count, 0);
    assert.equal(capped.flicker.length, MAP_FIRE_FX_LIMITS.maxFlickerLights);
    assert.ok(capped.flicker.every((entry) => entry.amplitude <= 0.25));
    assert.equal(normalizeMapFireFx(null), null);
    assert.equal(normalizeMapFireFx({ emitters: [] }), null);
});

test('fire FX follows absolute match time, flickers authored lights and disposes once', () => {
    const added = [];
    const removed = [];
    const renderer = {
        addToScene(object) { added.push(object); },
        removeFromScene(object) { removed.push(object); },
    };
    const light = new THREE.PointLight(0xff7a24, 4200, 100);
    light.userData.authoredLightId = 'ndf_crossing_breach';
    const controller = new MapFireFxController(renderer);
    const map = {
        scaleAuthoredAnchors: true,
        fireFx: {
            ...NOTRE_DAME_FIRE_FX,
            flicker: [{
                lightId: 'ndf_crossing_breach',
                amplitude: 0.12,
                frequency: 1.3,
                phase: 0.4,
            }],
        },
    };

    const group = controller.build(map, 3, [light]);
    assert.equal(added.length, 1);
    assert.equal(group.name, 'map-fire-fx');
    assert.equal(group.children.length, 3);
    assert.equal(controller.layers.smoke.positions.length, NOTRE_DAME_FIRE_FX.smoke.count * 3);

    controller.update(3.25);
    const firstSmoke = [...controller.layers.smoke.positions];
    const firstEmbers = [...controller.layers.embers.positions];
    const firstIntensity = light.intensity;
    controller.update(9.5);
    controller.update(3.25);
    assert.deepEqual([...controller.layers.smoke.positions], firstSmoke);
    assert.deepEqual([...controller.layers.embers.positions], firstEmbers);
    assert.equal(light.intensity, firstIntensity);
    assert.notEqual(light.intensity, 4200);
    assert.equal(added.length, 1, 'updates reuse the original GPU objects');

    controller.dispose();
    assert.equal(removed.length, 1);
    assert.equal(removed[0], group);
    assert.equal(light.intensity, 4200);
    assert.equal(controller.group, null);
    controller.dispose();
    assert.equal(removed.length, 1, 'dispose is idempotent');
});
