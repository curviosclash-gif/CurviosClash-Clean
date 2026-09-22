import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { REACTOR_SITE_MAPS } from '../src/core/config/maps/presets/reactor_site/index.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { MapDestructibleBlastSystem } from '../src/entities/systems/MapDestructibleBlastSystem.js';
import { MapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { RocketBlastEffect } from '../src/entities/effects/RocketBlastEffect.js';
import { AudioManager } from '../src/core/Audio.js';
import { normalizeMapDestructibles, createMapDestructibleState, applyMapDestructibleDamage,
    serializeMapDestructibleState, applyMapDestructibleNetworkState,
    resolveMapDestructibleSceneTimeline } from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapDestructibleFireballSphere } from '../src/shared/contracts/MapDestructibleHazardContract.js';

const map = REACTOR_SITE_MAPS.reactor_site;
const definition = normalizeMapDestructibles(map.destructibles);
const scene = definition.breakScenes.find((entry) => entry.id === 'mushroom_cloud');

async function load(url) {
    const data = readFileSync(url);
    return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
}

// Intersect the actual mesh edges with a horizontal section. Frozen dimensions
// are from 681aa7f8, before the requested lower x3 / upper x2 deformation.
function sectionWidth(geometry, height, axis) {
    const p=geometry.attributes.position, index=geometry.index;
    let low=Infinity, high=-Infinity;
    for(let i=0;i<index.count;i+=3) for(let edge=0;edge<3;edge++) {
        const a=index.getX(i+edge), b=index.getX(i+(edge+1)%3);
        const ay=p.getY(a), by=p.getY(b);
        if((ay-height)*(by-height)>0 || ay===by) continue;
        const t=(height-ay)/(by-ay);
        const value=p.getComponent(a,axis)+(p.getComponent(b,axis)-p.getComponent(a,axis))*t;
        low=Math.min(low,value); high=Math.max(high,value);
    }
    return high-low;
}

test('all exported stems have triple lower and double upper sections and pressure-timed flat dust', async () => {
    for(const id of scene.modelVariants) {
        const gltf=await load(map.glbModels.find((entry)=>entry.id===id).url);
        const stem=gltf.scene.getObjectByName('stem');
        const geometry=stem.children.find((node)=>node.isMesh).geometry;
        for(const [height, baseline, multiplier] of [[.1,[1.4617303749,1.3850613434],3],[.9,[2.3761902236,2.4174444408],2]]) {
            for(const [i,axis] of [0,2].entries()) assert.ok(Math.abs(sectionWidth(geometry,height,axis)/baseline[i]-multiplier)<.02,`${id} section ${height}`);
        }
        const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();
        const front=gltf.scene.getObjectByName('front');
        mixer.setTime(.2);assert.ok(front.scale.x<.01,'no dust before pressure');
        mixer.setTime(.35);assert.ok(front.scale.x>20,'front starts with pressure');
        mixer.setTime(48);assert.ok(front.scale.y<15,'dust stays close to ground');
        mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
    }
});

test('host selects all four variants only on destruction and replicas keep the choice', () => {
    for (let index = 0; index < 4; index += 1) {
        // The breach rolls twice: the variant out of four and the wind heading out of 3600 steps.
        const draws = [];
        const owner = { arena: { currentMapDefinition: map, glbAnimationElapsedSeconds: 7 },
            gameModeStrategy: { modeType: 'HUNT' },
            runtimeRng: { int(count) { draws.push(count); return count === 4 ? index : 0; } } };
        const host = new MapDestructibleSystem(owner);
        host.startRound();
        host.applySegmentHit('reactor_dome', 1);
        assert.equal(draws.length, 0);
        const result = host.applySegmentHit('reactor_dome', 899);
        assert.equal(result.event.variantIndex, index);
        assert.deepEqual(draws, [4, 3600]);
        host.applySegmentHit('reactor_dome', 900);
        assert.equal(draws.length, 2);
        const replica = createMapDestructibleState(definition);
        applyMapDestructibleNetworkState(replica, host.serializeNetworkState());
        const timeline = resolveMapDestructibleSceneTimeline(definition, replica.events);
        assert.equal(timeline[0].modelId, scene.modelVariants[index]);
        assert.deepEqual(serializeMapDestructibleState(replica), host.serializeNetworkState());
        host.startRound();
        host.setNetworkReplica(true);
        assert.equal(host.applySegmentHit('reactor_dome', 900), null);
        assert.equal(draws.length, 2, 'replicas never roll');
    }
});

test('legacy and malformed network variants have a bounded deterministic fallback', () => {
    for (const variantIndex of [undefined, NaN, -2, Infinity, 'bad', 200]) {
        const state = createMapDestructibleState(definition);
        applyMapDestructibleNetworkState(state, { events: [{ segmentId: 'reactor_dome',
            kind: 'leg_lower', atSeconds: 1, yaw: 0, variantIndex }] });
        assert.equal(resolveMapDestructibleSceneTimeline(definition, state.events)[0].modelId, scene.modelId);
    }
});

test('one variant is visible, corrected snapshots switch it, and restart hides all four', () => {
    const root = new THREE.Group();
    for (const model of map.glbModels) {
        const slot = new THREE.Group();
        slot.name = `glb-slot-${model.id}`;
        slot.userData.glbModelId = model.id;
        slot.userData.glbHiddenUntilTriggered = model.hiddenUntilTriggered === true;
        root.add(slot);
    }
    const arena = { currentMapDefinition: map, _glbScene: root, obstacles: [] };
    const starts = [];
    const controller = new MapBreakSceneController(arena, [], { setTrackStart: (...args) => starts.push(args) });
    const event = { segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 2, yaw: 0, variantIndex: 2 };
    controller.applyEvents([event]);
    controller.applyEvents([event]);
    const visible = () => scene.modelVariants.filter((id) => root.getObjectByName(`glb-slot-${id}`).visible);
    assert.deepEqual(visible(), [scene.modelVariants[2]]);
    assert.equal(starts.filter((entry) => entry[1] === 2).length, 1);
    controller.applyEvents([{ ...event, variantIndex: 3 }]);
    assert.deepEqual(visible(), [scene.modelVariants[3]]);
    controller.reset();
    assert.deepEqual(visible(), []);
    assert.equal(root.getObjectByName('glb-slot-reactor-block').visible, true);
});

test('all game exports reach 15 percent above the enlarged map and preserve fireball parity', async () => {
    assert.equal(map.size[1], 220 * 1.3);
    const original = await load('assets/maps/reactor_site/glb/30_mushroom_cloud.glb');
    const oldMixer = new THREE.AnimationMixer(original.scene);
    oldMixer.clipAction(original.animations[0]).play();
    oldMixer.setTime(48);
    original.scene.updateMatrixWorld(true);
    const oldBounds = new THREE.Box3().setFromObject(original.scene.getObjectByName('front'), true);
    const palettes = new Set();
    const previousHeadWidths = [214.84335157, 242.00480807, 222.89467786, 224.82520095];
    for (const modelId of scene.modelVariants) {
        const model = map.glbModels.find((entry) => entry.id === modelId);
        assert.equal(model.hiddenUntilTriggered, true);
        const gltf = await load(model.url);
        assert.equal(gltf.animations.length, 1);
        assert.equal(gltf.animations[0].name, 'MushroomCloudOnce');
        assert.equal(gltf.animations[0].duration, 49);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
        let triangleCount = 0;
        gltf.scene.traverse((node) => {
            if (!node.isMesh) return;
            triangleCount += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
            if (node.name.includes('torus')) assert.match(node.name, /_nocol/);
            if (node.material.name === 'Cloud') palettes.add(node.material.color.getHexString());
        });
        assert.ok(triangleCount < 35000, `${modelId} mesh budget ${triangleCount}`);
        for (const t of [0, .1, .35, .9, 1.4, 2.1, 3.5, 4.4, 12, 40, 48, 49]) {
            mixer.setTime(t); gltf.scene.updateMatrixWorld(true);
            const fire = gltf.scene.getObjectByName('fire');
            const sphere = resolveMapDestructibleFireballSphere(scene.fireball, t, 1);
            const center = fire.getWorldPosition(new THREE.Vector3()).multiplyScalar(model.scale);
            center.y += model.position[1];
            assert.ok(Math.abs(center.y - sphere.y) < .001);
            const fireBounds = new THREE.Box3().setFromObject(fire, true);
            const radius = fireBounds.getSize(new THREE.Vector3()).x * model.scale / 2;
            assert.ok(Math.abs(radius - sphere.radius) < .002, `${modelId} fire at ${t}`);
        }
        const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
        const variant = scene.modelVariants.indexOf(modelId);
        const capSize = new THREE.Box3().setFromObject(gltf.scene.getObjectByName('cap'), true).getSize(new THREE.Vector3());
        assert.ok(Math.abs(Math.max(capSize.x, capSize.z) / (previousHeadWidths[variant]*1.35) - 1.30) < .001, 'head ends 30 percent wider than 681aa7f8');
        assert.ok(Math.abs(gltf.scene.getObjectByName('stem').scale.x / 23.976076126 - 1.5) < .001, 'stem ends 50 percent wider');
        assert.equal(gltf.scene.getObjectByName('roll').userData.vortexProfile, variant + 1);
        assert.ok(Math.abs(bounds.max.y * model.scale + model.position[1] - map.size[1] * 1.15) < .02);
        assert.ok(Math.abs(bounds.min.y) < .002);
        const dustBounds = new THREE.Box3().setFromObject(gltf.scene.getObjectByName('front'), true);
        for (const axis of ['x', 'z']) {
            assert.ok(Math.abs(dustBounds.max[axis] - oldBounds.max[axis]) < 1, 'ground dust footprint stays unchanged');
            assert.ok(Math.abs(dustBounds.min[axis] - oldBounds.min[axis]) < 1);
        }
        const flow = gltf.scene.getObjectByName('torus_flow_00');
        assert.ok(flow, 'real cross-section roll is exported');
        action.reset().play();
        mixer.setTime(8); const before = flow.quaternion.clone();
        mixer.setTime(9); assert.ok(before.angleTo(flow.quaternion) > .01);
        mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    }
    assert.equal(palettes.size, 4, 'four source palettes survive export');
});

test('the actual reactor fireball burns once for at most 20 and leaves smoke harmless', () => {
    const state = createMapDestructibleState(definition);
    const result = applyMapDestructibleDamage(state, definition, 'reactor_dome', 900, { atSeconds: 0 });
    let time = 1.4;
    const sphere = resolveMapDestructibleFireballSphere(scene.fireball, time, 1);
    const hits = [];
    const owner = { players: [{ index: 0, alive: true, position: { x: sphere.x, y: sphere.y, z: sphere.z } }],
        _mapDestructibleSystem: { anchorScale: 1, getDefinition: () => definition, getElapsedSeconds: () => time },
        _applyModeDamage: (_target, damage) => hits.push(damage) };
    const blast = new MapDestructibleBlastSystem(owner);
    blast.schedulePendingBlast(result.event);
    blast.update(); blast.update();
    assert.deepEqual(hits, [20]);
    time = 5;
    owner.players.push({ index: 1, alive: true, position: owner.players[0].position });
    blast.update(); assert.deepEqual(hits, [20]);
    blast.startRound(); assert.equal(blast._fireballs.length, 0);
});

test('reactor flash reuses the pooled light and returns to darkness', () => {
    const effect = new RocketBlastEffect({ addToScene() {}, removeFromScene() {} });
    effect.spawn(new THREE.Vector3(0, 40, 0), 'REACTOR_BREACH', 0xffe6bb, 3);
    effect.update(.01);
    assert.ok(effect.light.intensity > 1000);
    effect.update(.16); assert.equal(effect.light.intensity, 0);
    effect.dispose();
});

test('reactor audio selects the deep recording once without sharing a weapon cooldown', () => {
    const recordings = [];
    const audio = { enabled: true, ctx: { state: 'running' }, lastPlayTime: { ROCKET_IMPACT: 9999 },
        cooldowns: { REACTOR_BREACH: 1000 }, buffers: { explosion: {} },
        _resolveTime: () => 10000, _recordDebugEvent() {}, _duckMusic() {},
        _intensity: () => 1, _distanceAttenuation: () => 1, _playTone() {},
        _playRecordedSample: (key) => { recordings.push(key); return true; } };
    AudioManager.prototype.play.call(audio, 'REACTOR_BREACH', {});
    AudioManager.prototype.play.call(audio, 'REACTOR_BREACH', {});
    assert.deepEqual(recordings, ['rocketExplosion']);
});

test('pressure expands without a second flash and keeps its mode when the pool compacts', () => {
    let shakes = 0;
    const effect = new RocketBlastEffect({ addToScene() {}, removeFromScene() {},
        cameras: [{ position: new THREE.Vector3() }], triggerCameraShake() { shakes++; } });
    effect.spawn(new THREE.Vector3(), 'REACTOR_BREACH', 0xffe6bb, 3);
    assert.equal(shakes, 0, 'the light flash must not deliver the pressure impulse');
    effect.update(.28);
    effect.spawn(new THREE.Vector3(), 'REACTOR_PRESSURE', 0xffe6bb);
    effect.update(.01);
    assert.equal(effect.light.intensity, 0, 'pressure does not produce a second flash');
    const matrix = new THREE.Matrix4();
    effect.waveMesh.getMatrixAt(1, matrix);
    const firstScale = matrix.elements[0];
    effect.update(.4);
    assert.equal(effect.count, 1);
    assert.equal(effect.modes[0], 2);
    effect.waveMesh.getMatrixAt(0, matrix);
    assert.ok(matrix.elements[0] > firstScale);
    effect.coreMesh.getMatrixAt(0, matrix);
    assert.equal(matrix.elements[0], 0, 'pressure has no second fireball');
    effect.clear(); assert.equal(effect.count, 0);
    effect.dispose();
});
