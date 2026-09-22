import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { createReactorVolume, VOLUME_HEAD_NAME, VOLUME_STEM_NAME } from '../src/entities/effects/ReactorVolumeCloud.js';
import { buildVolumeNoiseData, getVolumeNoiseTexture, VOLUME_NOISE_SIZE } from '../src/entities/effects/ReactorVolumeNoise.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

const SIZE = VOLUME_NOISE_SIZE;
const channelAt = (data, x, y, z, channel) => data[(((z % SIZE) * SIZE + (y % SIZE)) * SIZE + (x % SIZE)) * 4 + channel];

test('the noise volume is the same everywhere and wraps without a seam', () => {
    const data = buildVolumeNoiseData();
    assert.equal(data.length, SIZE ** 3 * 4);
    // Deterministic: every client rolls the same smoke, and two layers of it match one call.
    const sliced = new Uint8Array(data.length);
    buildVolumeNoiseData(SIZE, sliced, 0, 2);
    buildVolumeNoiseData(SIZE, sliced, 2, SIZE - 2);
    assert.deepEqual(sliced, data);
    // A seam would show as a jump across the wrap that inner neighbours never have.
    for (const channel of [0, 1, 2, 3]) {
        let seam = 0, inner = 0, samples = 0;
        for (let y = 0; y < SIZE; y += 3) {
            for (let z = 0; z < SIZE; z += 3) {
                seam += Math.abs(channelAt(data, 0, y, z, channel) - channelAt(data, SIZE - 1, y, z, channel));
                inner += Math.abs(channelAt(data, 20, y, z, channel) - channelAt(data, 19, y, z, channel));
                samples += 1;
            }
        }
        assert.ok(seam / samples < inner / samples * 2 + 4, `channel ${channel} wraps: ${(seam / samples).toFixed(1)} against ${(inner / samples).toFixed(1)}`);
    }
});

test('the noise texture is shared, filled and set to repeat in all three directions', () => {
    const texture = getVolumeNoiseTexture();
    assert.equal(texture, getVolumeNoiseTexture(), 'one volume for every cloud of the session');
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.wrapR, THREE.RepeatWrapping);
    assert.equal(texture.image.width, SIZE);
    // Without frames (Node) the volume is filled at once; in a browser it arrives over half a second.
    assert.ok(texture.image.data.some((value) => value > 0), 'the volume holds noise');
});

function poseState(overrides = {}) {
    return {
        x: 10, z: -20, ringY: 400, radius: 170, rimWidth: 70, rimHeight: 50, dome: 80,
        top: 520, base: 0, stemTop: 420, stemRadiusLow: 60, stemRadiusHigh: 45,
        windX: 0, windZ: 0, flowTurns: 0.5, riseTravel: 1.5, density: 1, heat: 0,
        albedo: new THREE.Color(0.5, 0.4, 0.3), sunDirection: new THREE.Vector3(0, 1, 0),
        sunColor: new THREE.Color(1, 1, 1), ...overrides,
    };
}

test('the proxies enclose the cloud, stay unit-sized and follow the wind', () => {
    const root = new THREE.Object3D();
    const volume = createReactorVolume(root);
    volume.update(poseState());
    const head = volume.head.material.uniforms, stem = volume.stem.material.uniforms;
    // The head's cylinder holds ring, rim and dome; the stem's reaches from the ground into it.
    assert.ok(head.bounds.value.x >= 170 + 70, `head radius ${head.bounds.value.x}`);
    assert.ok(head.bounds.value.y <= 400 - 50 && head.bounds.value.z >= 520);
    assert.ok(stem.bounds.value.x >= 60 && stem.bounds.value.y <= 0 && stem.bounds.value.z > 400);
    assert.equal(head.bounds.value.w, 0);
    assert.equal(stem.bounds.value.w, 1);
    for (const mesh of [volume.head, volume.stem]) {
        // The proxy is placed in the vertex shader; its object may not grow the measured cloud.
        mesh.geometry.computeBoundingBox();
        assert.ok(mesh.geometry.boundingBox.getSize(new THREE.Vector3()).length() < 3.1, 'unit proxy');
        assert.match(mesh.name, /_nocol_noshadow$/);
    }
    // Wind: the head's axis is carried downwind, the shape itself stays put and is sheared.
    volume.update(poseState({ windX: 120, windZ: -40 }));
    assert.ok(head.proxyAxis.value.x > 10 + 40, `drifted axis ${head.proxyAxis.value.x}`);
    assert.equal(head.ringCenter.value.x, 10);
    assert.deepEqual([...head.wind.value.toArray()], [120, -40, 0, 520]);
});

test('a camera inside the proxy switches it to its back faces', () => {
    const volume = createReactorVolume(new THREE.Object3D());
    volume.update(poseState());
    const outside = new THREE.PerspectiveCamera(); outside.position.set(2000, 400, 0);
    const inside = new THREE.PerspectiveCamera(); inside.position.set(10, 400, -20);
    volume.faceCamera(volume.head, outside);
    assert.equal(volume.head.material.uniforms.insideProxy.value, 0);
    volume.faceCamera(volume.head, inside);
    assert.equal(volume.head.material.uniforms.insideProxy.value, 1);
});

test('the shader marches the ring, rolls its noise and fades out with the dissolve', async () => {
    const source = readFileSync(new URL('../src/entities/effects/ReactorVolumeCloud.js', import.meta.url), 'utf8');
    assert.match(source, /precision highp sampler3D/, 'a 3D noise texture needs its precision');
    assert.match(source, /roll = atan\(q\.y, r - R\) \/ TAU \+ flowTurns/, 'the noise rolls round the tube');
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    await attachReactorSmoke(gltf.scene, action, { loadTexture: async () => new THREE.Texture(), volume: true });
    const head = gltf.scene.getObjectByName(VOLUME_HEAD_NAME);
    const stem = gltf.scene.getObjectByName(VOLUME_STEM_NAME);
    assert.ok(head && stem, 'both volumes are attached');
    const camera = new THREE.PerspectiveCamera(); camera.position.set(900, 500, 1000); camera.lookAt(0, 400, 0); camera.updateMatrixWorld();
    const pose = (seconds, after = 0) => {
        action.time = seconds; mixer.update(0); gltf.scene.updateMatrixWorld(true);
        gltf.scene.userData.clipOverrunSeconds = after;
        head.onBeforeRender(null, new THREE.Scene(), camera);
        stem.onBeforeRender(null, new THREE.Scene(), camera);
        // Copied out: the uniforms are one live object that the next pose overwrites.
        const u = head.material.uniforms;
        return { ringY: u.ringCenter.value.y, radius: u.ringShape.value.x, dome: u.ringShape.value.w,
            turns: u.flowTurns.value, density: u.smokeDensity.value, stemTop: stem.material.uniforms.bounds.value.z };
    };
    // The ring follows the exported rig: its centre is the roll's own height.
    const early = pose(12);
    action.time = 12; mixer.update(0); gltf.scene.updateMatrixWorld(true);
    const rollY = gltf.scene.getObjectByName('roll').getWorldPosition(new THREE.Vector3()).y;
    assert.ok(Math.abs(early.ringY - rollY) < 1e-6, 'the ring sits at the exported roll rig');
    assert.ok(early.stemTop > early.ringY, 'the stem reaches into the head');
    const late = pose(48);
    assert.ok(late.radius > early.radius, 'the head grows');
    assert.ok(late.ringY > early.ringY, 'and rises');
    assert.ok(late.turns > early.turns, 'and keeps rolling');
    // Seven minutes on: thinner, wider and flatter, and then still.
    const rest = pose(48, 420);
    assert.ok(rest.density < 0.2 && rest.density > 0, `rest at ${rest.density}`);
    assert.ok(rest.radius > late.radius * 1.3, 'spread out');
    assert.ok(rest.dome < late.dome, 'flattened');
    assert.equal(pose(48, 900).turns, rest.turns, 'the rest stands still');
    let released = 0;
    for (const resource of [head.geometry, head.material, stem.geometry, stem.material]) {
        resource.addEventListener('dispose', () => released++);
    }
    disposeObject3DResources(gltf.scene);
    assert.equal(released, 4);
});
