import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { REACTOR_SITE_MAPS } from '../src/core/config/maps/presets/reactor_site/index.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { MapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { createReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import {
    applyMapDestructibleDamage, applyMapDestructibleNetworkState, createMapDestructibleState,
    normalizeMapDestructibles, resolveMapDestructibleSceneTimeline, serializeMapDestructibleState,
} from '../src/shared/contracts/MapDestructibleContract.js';

const map = REACTOR_SITE_MAPS.reactor_site;
const definition = normalizeMapDestructibles(map.destructibles);
const TWO_PI = Math.PI * 2;

function tiny(wind) {
    return normalizeMapDestructibles({
        segments: [{ id: 'core', kind: 'leg_lower', hp: 10, meshPrefixes: ['core'], anchor: [0, 0, 0] }],
        breakScenes: [{ id: 'cloud', trigger: { segmentId: 'core' }, modelId: 'cloud', ...(wind === undefined ? {} : { wind }) }],
    });
}

test('only a scene that asks for wind gets a host-rolled heading, bounded to one turn', () => {
    assert.equal(tiny().breakScenes[0].wind, false);
    assert.equal(tiny('yes').breakScenes[0].wind, false, 'only true switches it on');
    assert.equal(tiny(true).breakScenes[0].wind, true);
    assert.equal(definition.breakScenes.find((scene) => scene.id === 'mushroom_cloud').wind, true, 'the reactor cloud drifts');

    const still = tiny(false);
    const calm = applyMapDestructibleDamage(createMapDestructibleState(still), still, 'core', 99, { chooseWind: () => 1 });
    assert.equal('windYaw' in calm.event, false);

    const windy = tiny(true);
    for (const [rolled, expected] of [[1, 1], [7, 7 - TWO_PI], [-1, TWO_PI - 1], [NaN, 0], [undefined, 0]]) {
        const result = applyMapDestructibleDamage(createMapDestructibleState(windy), windy, 'core', 99, { chooseWind: () => rolled });
        assert.ok(Math.abs(result.event.windYaw - expected) < 1e-9, `rolled ${rolled}`);
    }
});

test('the heading survives the network and reaches the scene timeline', () => {
    const windy = tiny(true);
    const host = createMapDestructibleState(windy);
    applyMapDestructibleDamage(host, windy, 'core', 99, { chooseWind: () => 2.5 });
    const replica = createMapDestructibleState(windy);
    applyMapDestructibleNetworkState(replica, JSON.parse(JSON.stringify(serializeMapDestructibleState(host))));
    assert.equal(replica.events[0].windYaw, 2.5);
    assert.equal(resolveMapDestructibleSceneTimeline(windy, replica.events)[0].windYaw, 2.5);
    for (const windYaw of ['bad', Infinity, 9]) {
        const state = createMapDestructibleState(windy);
        applyMapDestructibleNetworkState(state, { events: [{ segmentId: 'core', kind: 'leg_lower', atSeconds: 1, yaw: 0, windYaw }] });
        const heading = state.events[0].windYaw;
        assert.ok(heading >= 0 && heading < TWO_PI, `bounded for ${windYaw}`);
    }
    const legacy = createMapDestructibleState(windy);
    applyMapDestructibleNetworkState(legacy, { events: [{ segmentId: 'core', kind: 'leg_lower', atSeconds: 1, yaw: 0 }] });
    assert.equal('windYaw' in legacy.events[0], false, 'an old snapshot stays windless');
    assert.equal('windYaw' in resolveMapDestructibleSceneTimeline(windy, legacy.events)[0], false);
});

test('the reactor host rolls the wind from the match rng; replicas never roll', () => {
    const rolls = [];
    const owner = { arena: { currentMapDefinition: map, glbAnimationElapsedSeconds: 3 },
        gameModeStrategy: { modeType: 'HUNT' },
        runtimeRng: { int(count) { rolls.push(count); return count === 4 ? 1 : count / 4; } } };
    const host = new MapDestructibleSystem(owner);
    host.startRound();
    const result = host.applySegmentHit('reactor_dome', 900);
    assert.ok(Math.abs(result.event.windYaw - Math.PI / 2) < 1e-6, 'a quarter of the roll range is a quarter turn');
    assert.deepEqual(rolls.sort((a, b) => a - b), [4, 3600]);
    host.startRound(); host.setNetworkReplica(true);
    host.applySegmentHit('reactor_dome', 900);
    assert.equal(rolls.length, 2);
});

test('the scene controller hands the heading to the cloud and a restart takes it back', () => {
    const root = new THREE.Group();
    for (const model of map.glbModels) {
        const slot = new THREE.Group();
        slot.name = `glb-slot-${model.id}`;
        slot.userData.glbModelId = model.id;
        root.add(slot);
    }
    const controller = new MapBreakSceneController({ currentMapDefinition: map, _glbScene: root, obstacles: [] }, [], { setTrackStart() {} });
    controller.applyEvents([{ segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 2, yaw: 0, variantIndex: 1, windYaw: 1.25 }]);
    const cloud = root.getObjectByName(`glb-slot-${definition.breakScenes.find((s) => s.id === 'mushroom_cloud').modelVariants[1]}`);
    assert.equal(cloud.userData.windYaw, 1.25);
    controller.reset();
    assert.equal(cloud.userData.windYaw, undefined);
});

test('smoke leans downwind with height: the top drifts, the foot stays', async () => {
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const slot = new THREE.Group(); slot.add(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const layer = createReactorSmoke(gltf.scene, action, new THREE.Texture());
    const camera = new THREE.PerspectiveCamera(); camera.position.set(900, 500, 1000); camera.lookAt(0, 400, 0); camera.updateMatrixWorld();
    const centroid = (windYaw, time, after = 0) => {
        if (windYaw === null) delete slot.userData.windYaw; else slot.userData.windYaw = windYaw;
        gltf.scene.userData.clipOverrunSeconds = after;
        action.time = time; mixer.update(0); slot.updateMatrixWorld(true);
        layer.onBeforeRender(null, null, camera);
        const data = layer.material.uniforms.smokeData.value.image.data;
        const bands = { low: [0, 0, 0], high: [0, 0, 0] };
        const ys = [];
        for (let row = 0; row < layer.geometry.instanceCount; row += 1) ys.push(data[row * 16 + 1]);
        const top = Math.max(...ys), bottom = Math.min(...ys);
        for (let row = 0; row < layer.geometry.instanceCount; row += 1) {
            const o = row * 16;
            const band = data[o + 1] > bottom + (top - bottom) * 0.75 ? bands.high : data[o + 1] < bottom + (top - bottom) * 0.2 ? bands.low : null;
            if (band) { band[0] += data[o]; band[1] += data[o + 2]; band[2] += 1; }
        }
        return { high: [bands.high[0] / bands.high[2], bands.high[1] / bands.high[2]], low: [bands.low[0] / bands.low[2], bands.low[1] / bands.low[2]] };
    };
    const calm = centroid(null, 40);
    const east = centroid(0, 40);
    const south = centroid(Math.PI / 2, 40);
    const shiftEast = east.high[0] - calm.high[0];
    assert.ok(shiftEast > 40, `the cap drifts along +x: ${shiftEast.toFixed(1)}`);
    assert.ok(Math.abs(east.high[1] - calm.high[1]) < shiftEast * 0.1, 'and not sideways');
    assert.ok(south.high[1] - calm.high[1] > 40, 'a quarter turn drifts along +z');
    assert.ok(Math.abs(east.low[0] - calm.low[0]) < shiftEast * 0.25, 'the foot barely moves');
    const early = centroid(0, 10).high[0] - centroid(null, 10).high[0];
    const later = centroid(0, 48, 200).high[0] - centroid(null, 48, 200).high[0];
    assert.ok(early < shiftEast && shiftEast < later, 'the drift grows with time, also while it thins out');
    disposeObject3DResources(gltf.scene);
});
