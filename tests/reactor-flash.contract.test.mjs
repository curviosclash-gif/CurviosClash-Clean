import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachReactorFlash, REACTOR_FLASH_NAME, reactorFlashStrength } from '../src/entities/effects/ReactorFlashOverlay.js';
import { emitMapDestructibleBreakFeedback } from '../src/entities/effects/MapDestructibleBreakFeedback.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

const near = { distance: 200, facing: 1, reduced: false };

test('the flash whites out first, then fades within a second', () => {
    assert.ok(reactorFlashStrength(0.03, near).white > 0.95);
    assert.ok(reactorFlashStrength(0.3, near).white < reactorFlashStrength(0.1, near).white);
    assert.ok(reactorFlashStrength(1.0, near).white < 0.03);
    assert.deepEqual(reactorFlashStrength(3, near), { white: 0, glow: 0 });
    assert.deepEqual(reactorFlashStrength(0, near), { white: 0, glow: 0 }, 'nothing before the breach');
});

test('looking away, standing far off and reduced motion each soften it', () => {
    const base = reactorFlashStrength(0.03, near).white;
    assert.ok(reactorFlashStrength(0.03, { ...near, facing: -1 }).white < base * 0.5);
    assert.ok(reactorFlashStrength(0.03, { ...near, facing: -1 }).white > 0, 'the whole sky still lights up');
    assert.ok(reactorFlashStrength(0.03, { ...near, distance: 1400 }).white < base);
    assert.ok(reactorFlashStrength(0.03, { ...near, reduced: true }).white <= 0.3);
    assert.equal(reactorFlashStrength(0.4, { ...near, facing: -1 }).glow, 0, 'no after-image of what you did not see');
    assert.ok(reactorFlashStrength(0.4, near).glow > 0.3, 'an after-image where the fireball was');
});

test('the overlay draws per camera, last, and collapses when idle', async () => {
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const seek = (time) => { action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true); };
    const overlay = attachReactorFlash(gltf.scene, action);
    assert.equal(overlay.name, REACTOR_FLASH_NAME);
    assert.equal(overlay.material.depthTest, false);
    assert.ok(overlay.renderOrder >= 1e6, 'drawn after everything else');
    overlay.geometry.computeBoundingBox();
    assert.ok(overlay.geometry.boundingBox.getSize(new THREE.Vector3()).length() < 0.01, 'never widens the model');
    assert.match(overlay.material.vertexShader, /position\.xy/, 'the shader reads its position attribute');

    const camera = new THREE.PerspectiveCamera(60, 1.6, 1, 5000);
    const fire = gltf.scene.getObjectByName('fire');
    seek(0.03);
    camera.position.set(200, 60, 0); camera.lookAt(fire.getWorldPosition(new THREE.Vector3())); camera.updateMatrixWorld();
    overlay.onBeforeRender(null, null, camera);
    assert.equal(overlay.material.uniforms.flashActive.value, 1);
    assert.ok(overlay.material.uniforms.flashWhite.value <= 0.3, 'reduced motion until told otherwise');
    overlay.userData.reduceMotion = false;
    overlay.onBeforeRender(null, null, camera);
    assert.ok(overlay.material.uniforms.flashWhite.value > 0.9);
    const spot = overlay.material.uniforms.flashSpot.value;
    assert.ok(Math.abs(spot.x) < 0.1 && Math.abs(spot.y) < 0.1, 'the after-image sits on the fireball');

    seek(5);
    overlay.onBeforeRender(null, null, camera);
    assert.equal(overlay.material.uniforms.flashActive.value, 0);

    let released = 0;
    for (const resource of [overlay.geometry, overlay.material]) resource.addEventListener('dispose', () => released++);
    disposeObject3DResources(gltf.scene);
    assert.equal(released, 2);
});

test('no reactor shader names anything with a reserved GLSL word', async () => {
    // A uniform called "active" compiled in Node but made the GPU reject the whole program.
    const reserved = ['active', 'asm', 'cast', 'class', 'common', 'enum', 'extern', 'external', 'filter',
        'fixed', 'goto', 'half', 'inline', 'input', 'interface', 'long', 'namespace', 'noinline', 'output',
        'partition', 'public', 'resource', 'sample', 'short', 'sizeof', 'static', 'superp', 'template',
        'this', 'typedef', 'union', 'unsigned', 'using', 'volatile'];
    const sources = ['ReactorFlashOverlay.js', 'ReactorFireballEffect.js', 'ReactorSmokeGeometry.js', 'ReactorDebrisEffect.js',
        'ReactorVolumeCloud.js']
        .map((file) => readFileSync(new URL(`../src/entities/effects/${file}`, import.meta.url), 'utf8'));
    for (const source of sources) {
        for (const shader of source.match(/\/\* glsl \*\/`[\s\S]*?`/g) || []) {
            for (const [, name] of shader.matchAll(/\b(?:uniform|varying|attribute)\s+\w+\s+(\w+)/g)) {
                assert.ok(!reserved.includes(name), `${name} is reserved in GLSL`);
            }
        }
    }
});

test('the breach hands the reduced-motion choice to every flash overlay', () => {
    for (const reduceMotion of [false, true]) {
        const scene = new THREE.Scene();
        const overlay = new THREE.Object3D(); overlay.name = REACTOR_FLASH_NAME; overlay.userData.reduceMotion = !reduceMotion;
        scene.add(overlay);
        const owner = {
            arena: { currentMapKey: 'reactor_site' },
            _mapDestructibleSystem: { anchorScale: 3, getDefinition: () => ({ segments: [{ id: 'reactor_dome', anchor: [0, 28, 0] }] }) },
            particles: { spawn() {}, rocketBlastEffect: { spawn() {} } },
            renderer: { scene, cameras: [], getCameraPerspectiveSettings: () => ({ reduceMotion }) },
        };
        emitMapDestructibleBreakFeedback(owner, { segmentId: 'reactor_dome' });
        assert.equal(overlay.userData.reduceMotion, reduceMotion);
    }
});
