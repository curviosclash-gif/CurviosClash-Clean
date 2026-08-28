import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    DEFAULT_MAP_LIGHT_SOURCE,
    MAP_LIGHT_SOURCE_LIMIT,
    normalizeMapLightSource,
    normalizeMapLightSources,
} from '../src/shared/contracts/MapLightSourcesContract.js';
import { AuthoredMapLightRig } from '../src/entities/arena/AuthoredMapLightRig.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

function createRendererStub() {
    const scene = [];
    return {
        scene,
        addToScene: (object) => scene.push(object),
        removeFromScene: (object) => {
            const index = scene.indexOf(object);
            if (index >= 0) scene.splice(index, 1);
        },
    };
}

test('a light source is filled in from the defaults and hostile values are clamped', () => {
    assert.deepEqual(normalizeMapLightSource(undefined), DEFAULT_MAP_LIGHT_SOURCE);

    const normalized = normalizeMapLightSource({
        id: '  nave  ',
        x: 10, y: 'high', z: -1e9,
        color: '#ff8000',
        intensity: -50,
        // A distance of zero means "never falls off" in three, which would let one interior lamp
        // light the entire map.
        distance: 0,
        decay: 99,
    });
    assert.equal(normalized.id, 'nave');
    assert.equal(normalized.x, 10);
    assert.equal(normalized.y, DEFAULT_MAP_LIGHT_SOURCE.y, 'an unusable number falls back');
    assert.equal(normalized.z, -4000);
    assert.equal(normalized.color, 0xff8000);
    assert.equal(normalized.intensity, 0);
    assert.ok(normalized.distance > 0, 'the range can never be unlimited');
    assert.equal(normalized.decay, 4);
});

// Every point light costs shader work on every lit surface, so the count cannot be left to whoever
// authors a map.
test('the number of lights per map is capped', () => {
    const many = Array.from({ length: MAP_LIGHT_SOURCE_LIMIT + 6 }, (_, i) => ({ id: `l${i}` }));
    assert.equal(normalizeMapLightSources(many).length, MAP_LIGHT_SOURCE_LIMIT);
    assert.deepEqual(normalizeMapLightSources('nonsense'), []);
    assert.deepEqual(normalizeMapLightSources([null, 3, 'x']), []);
});

test('the rig places a light per source and scales anchors like the other authored ones', () => {
    const renderer = createRendererStub();
    const rig = new AuthoredMapLightRig(renderer);
    const map = {
        scaleAuthoredAnchors: true,
        lights: [{ id: 'nave', x: 10, y: 20, z: -5, color: 0xff8000, intensity: 500, distance: 40 }],
    };

    rig.build(map, 3);
    assert.equal(rig.getLightCount(), 1);
    const light = renderer.scene[0];
    assert.ok(light.isPointLight);
    assert.deepEqual(light.position.toArray(), [30, 60, -15]);
    assert.equal(light.distance, 120, 'the range is scaled with the map too');
    assert.equal(light.intensity, 500, 'but the intensity is absolute');
    // A shadow-casting point light would stop at the first wall, and the whole point is that some of
    // this reaches the outside.
    assert.equal(light.castShadow, false);

    // A map without lamps must not inherit the previous map's.
    rig.build({}, 3);
    assert.equal(rig.getLightCount(), 0);
    assert.equal(renderer.scene.length, 0);
});

test('an unscaled map keeps its authored light anchors', () => {
    const renderer = createRendererStub();
    const rig = new AuthoredMapLightRig(renderer);
    rig.build({ lights: [{ x: 10, y: 20, z: -5, distance: 40 }] }, 3);
    assert.deepEqual(renderer.scene[0].position.toArray(), [10, 20, -5]);
    assert.equal(renderer.scene[0].distance, 40);
});

test('Notre-Dame lights its interior and every preset stays inside the cap', () => {
    for (const [mapKey, map] of Object.entries(MAP_PRESET_CATALOG)) {
        if (!Array.isArray(map?.lights)) continue;
        assert.ok(
            map.lights.length <= MAP_LIGHT_SOURCE_LIMIT,
            `${mapKey} states more lights than the cap allows`
        );
        assert.deepEqual(
            normalizeMapLightSources(map.lights).map((entry) => entry.id),
            map.lights.map((entry) => entry.id),
            `${mapKey} states light sources the normalizer keeps unchanged`
        );
    }

    const nave = MAP_PRESET_CATALOG.notre_dame?.lights || [];
    assert.ok(nave.length >= 4, 'the nave is lit along its length, not by a single lamp');
    for (const light of nave) {
        const colour = new THREE.Color(light.color);
        assert.ok(colour.r > colour.b, `${light.id} is warm rather than cold`);
    }
});
