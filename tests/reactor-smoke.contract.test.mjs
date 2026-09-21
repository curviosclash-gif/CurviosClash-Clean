import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachReactorSmoke, createReactorSmoke, MAX_SMOKE_CARDS } from '../src/entities/effects/ReactorSmokeEffect.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

async function fixture(variant = 1) {
    const buffer = readFileSync(new URL(`../assets/maps/reactor_site/glb/torus_cloud_${variant}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const camera = new THREE.PerspectiveCamera(); camera.position.set(450,400,500); camera.lookAt(0,280,0); camera.updateMatrixWorld();
    const texture = new THREE.Texture();
    const layer = createReactorSmoke(gltf.scene, action, texture);
    const pose = (time) => {
        action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true);
        layer.onBeforeRender(null, null, camera);
        return layer.material.uniforms.smokeData.value.image.data;
    };
    return { ...gltf, mixer, action, camera, texture, layer, pose };
}

test('all four smoke layers follow the exported rig and stay bounded through seeks', async () => {
    for (let variant = 1; variant <= 4; variant++) {
        const f = await fixture(variant);
        assert.ok(f.layer.geometry.instanceCount > 100);
        assert.ok(f.layer.geometry.instanceCount <= MAX_SMOKE_CARDS);
        assert.equal(f.layer.material.depthWrite, false);
        assert.equal(f.action.time, 0, 'ceiling measurement restores the initial pose');
        assert.equal(f.layer.geometry.boundingBox.getSize(new THREE.Vector3()).length(),0);
        f.scene.traverse((node) => {
            if (node.material?.name === 'Dust') assert.equal(node.material.visible,true,'flat ground dust retains its geometry');
        });
        const fire = f.scene.getObjectByName('fire');
        const fireMesh = fire.children.find((node) => node.isMesh);
        assert.equal(fireMesh.material.visible, true, 'fireball remains unchanged');
        for (const time of [0, .5, 2, 8, 12, 48, 0, 12]) {
            const data = f.pose(time);
            assert.ok(data.every(Number.isFinite));
            let lastDepth = -Infinity;
            const view = f.camera.matrixWorldInverse.elements;
            for (let i = 0; i < data.length; i += 16) {
                const depth = view[2]*data[i]+view[6]*data[i+1]+view[10]*data[i+2]+view[14];
                assert.ok(depth >= lastDepth - .001, 'back-to-front sorting'); lastDepth = depth;
                assert.ok(data[i+4] >= 0 && data[i+5] >= 0);
            }
            if (time === 0) assert.ok(data.every((v,i) => i%16 !== 7 || Number.isInteger(v)), 'reset starts transparent');
        }
        const atEight = new Float32Array(f.pose(8));
        assert.notDeepEqual(f.pose(9), atEight, 'rolling smoke changes with the authored clock');
        f.pose(48); assert.ok(f.layer.material.uniforms.heat.value < .001);
        f.pose(.5); assert.ok(f.layer.material.uniforms.heat.value > .5);
        const first = new Float32Array(f.pose(12));
        f.pose(20); assert.deepEqual(f.pose(12),first,'seeking is deterministic');
        disposeObject3DResources(f.scene); f.mixer.stopAllAction(); f.mixer.uncacheRoot(f.scene);
    }
});

test('each split-screen camera gets freshly sorted data and disposal releases both textures', async () => {
    const f = await fixture();
    const first = new Float32Array(f.pose(12));
    f.camera.position.set(-450,400,-500); f.camera.lookAt(0,280,0); f.camera.updateMatrixWorld();
    assert.notDeepEqual(f.pose(12), first);
    let disposed = 0;
    for (const resource of [f.texture, f.layer.material.uniforms.smokeData.value, f.layer.geometry, f.layer.material]) {
        resource.addEventListener('dispose', () => disposed++);
    }
    disposeObject3DResources(f.scene);
    assert.equal(disposed, 4);
});

test('unrelated assets never request smoke and a failed atlas leaves original surfaces intact', async () => {
    let requests = 0;
    assert.equal(await attachReactorSmoke(new THREE.Group(), {}, { loadTexture: () => { requests++; } }), null);
    assert.equal(requests, 0);
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const { scene } = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
    await assert.rejects(attachReactorSmoke(scene, { time: 0 }, { loadTexture: async () => { throw new Error('missing'); } }), /missing/);
    scene.traverse((node) => { if (node.material) assert.equal(node.material.visible,true); });
    disposeObject3DResources(scene);
});
