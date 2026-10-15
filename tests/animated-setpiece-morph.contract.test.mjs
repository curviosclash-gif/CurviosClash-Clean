import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { scanMotion } from './helpers/animated-setpiece-scan.mjs';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

async function loadPoppy() {
    return geometryOnlyGlbLoader.loadAsync(new URL('../assets/models/meadow_plants/Poppy/glb/Poppy.glb', import.meta.url));
}

function createModel(gltf, clip) {
    const scene = gltf.scene || gltf.scenes[0];
    scene.updateWorldMatrix(true, true);
    const meshes = [];
    scene.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry.computeBoundingBox();
        meshes.push(node);
    });
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip).play();
    const model = {
        glb: { scene, meshes },
        clip,
        pose(time) {
            action.time = time;
            mixer.update(0);
            scene.updateWorldMatrix(true, true);
        },
    };
    return { gltf, mixer, model };
}

function holdMorphWeights(clip) {
    const tracks = clip.tracks.map((track) => {
        const values = track.values.slice();
        const valueSize = track.getValueSize();
        for (let frame = 1; frame < track.times.length; frame += 1) {
            for (let component = 0; component < valueSize; component += 1) {
                values[frame * valueSize + component] = values[component];
            }
        }
        return new track.constructor(track.name, track.times.slice(), values, track.getInterpolation());
    });
    return new THREE.AnimationClip(`${clip.name}-static-morph`, clip.duration, tracks);
}

function findingsFor(cacheKey, model) {
    const findings = [];
    scanMotion(cacheKey, model, { animationClock: { mode: 'loop' } }, 'morph-fixture', (key, detail) => {
        findings.push({ key, detail });
    });
    return findings;
}

test('animated-setpiece scan recognizes changing morph weights as motion', async () => {
    const gltf = await loadPoppy();
    const { mixer, model } = createModel(gltf, gltf.animations[0]);
    try {
        const findings = findingsFor('poppy-morph-motion', model);
        assert.ok(!findings.some(({ key }) => key.endsWith('|clip-static')));
    } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(model.glb.scene);
        disposeObject3DResources(model.glb.scene);
    }
});

test('animated-setpiece scan still flags an unchanged morph clip as static', async () => {
    const gltf = await loadPoppy();
    const clip = holdMorphWeights(gltf.animations[0]);
    const { mixer, model } = createModel(gltf, clip);
    try {
        const findings = findingsFor('poppy-morph-static', model);
        assert.ok(findings.some(({ key }) => key.endsWith('|clip-static')));
    } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(model.glb.scene);
        disposeObject3DResources(model.glb.scene);
    }
});
