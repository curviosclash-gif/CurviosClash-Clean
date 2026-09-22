import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { resolveVortexProfile } from '../src/entities/effects/ReactorVortexFlow.js';
import {
    createHeadCards, createHeadOutline, HEAD_CARDS, headTravel, sampleHeadOutline, updateHeadOutline,
} from '../src/entities/effects/ReactorVortexHead.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

const head = { x: 0, y: 0, z: 0, radius: 170, rimWidth: 70, rimHeight: 50, dome: 90, stemRadius: 40, turbulence: 0.1 };

test('gas runs out over the top, down the outside and in along the underside', () => {
    const outline = updateHeadOutline(createHeadOutline(), head);
    const at = (q) => sampleHeadOutline({}, outline, q);
    let q = 0;
    while (at(q).r < head.radius * 0.5) q += 0.005;
    assert.ok(at(q).dr > 0.8 && at(q).y > head.rimHeight, 'on the dome it flows outwards');
    while (at(q).r < head.radius + head.rimWidth * 0.99) q += 0.005;
    assert.ok(at(q).dy < -0.8, 'at the outer rim it sinks');
    while (at(q).y > -head.rimHeight * 0.7) q += 0.005;
    assert.ok(at(0.97).dr < -0.8 && at(0.97).r < head.radius, 'under the head it turns inwards to the stem');
    assert.ok(at(0).y === head.dome && at(1).r === head.stemRadius, 'from the top centre to the stem mouth');
});

test('the cards cover the skin evenly by area and round the axis, not along a spiral', () => {
    const cards = createHeadCards({ center: new THREE.Vector3() }, 0);
    assert.equal(cards.length, HEAD_CARDS);
    const sectors = new Array(8).fill(0);
    const cells = new Map();
    for (const card of cards) {
        const turn = ((card.azimuth / (Math.PI * 2)) % 1 + 1) % 1;
        sectors[Math.floor(turn * 8)] += 1;
        const cell = `${Math.floor(card.start * 4)}:${Math.floor(turn * 4)}`;
        cells.set(cell, (cells.get(cell) || 0) + 1);
    }
    for (const count of sectors) assert.ok(Math.abs(count - HEAD_CARDS / 8) < 5, `sector holds ${count}`);
    // With a golden-ratio start and the golden angle, whole bands of the skin stayed empty.
    assert.equal(cells.size, 16, 'every band of the skin meets every side of the head');
    for (const count of cells.values()) assert.ok(Math.abs(count - HEAD_CARDS / 16) < 6, `cell holds ${count}`);
});

test('the ring rolls fast while the fireball drives it and still turns minutes later', () => {
    for (let variant = 1; variant <= 4; variant += 1) {
        const profile = resolveVortexProfile(variant);
        const early = headTravel(6, profile) - headTravel(5, profile);
        const late = headTravel(401, profile) - headTravel(400, profile);
        assert.ok(early > late * 3, 'buoyancy fades');
        assert.ok(late > 0.005, `still ${late.toFixed(4)} turns per second after the clip`);
        assert.equal(headTravel(-3, profile), 0);
    }
});

async function cloud(variant) {
    const buffer = readFileSync(new URL(`../assets/maps/reactor_site/glb/torus_cloud_${variant}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const layer = createReactorSmoke(gltf.scene, action, new THREE.Texture());
    return { gltf, mixer, action, layer };
}

/**
 * Share of the head's side view that is open sky enclosed by smoke: cards are splatted as their
 * dense cores onto a grid over the head, and an open cell counts when smoke lies above, below,
 * left and right of it. Gaps between separate lumps are such cells; the sky around the head is not.
 */
function enclosedGaps(layer, root, camera) {
    const data = layer.material.uniforms.smokeData.value.image.data;
    const roll = root.getObjectByName('roll');
    const centre = roll.getWorldPosition(new THREE.Vector3());
    const scale = roll.getWorldScale(new THREE.Vector3());
    const halfWidth = scale.x * 1.8, bottom = centre.y - scale.y * 0.8, top = layer.material.uniforms.cloudTop.value;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const columns = 64, rows = 24;
    const opacity = new Float32Array(columns * rows);
    for (let row = 0; row < layer.geometry.instanceCount; row += 1) {
        const o = row * 16;
        const alpha = data[o + 7] - Math.floor(data[o + 7]);
        const u = (data[o] - centre.x) * right.x + (data[o + 2] - centre.z) * right.z;
        const radius = 0.3 * Math.min(data[o + 4], data[o + 5]);
        for (let cy = 0; cy < rows; cy += 1) {
            for (let cx = 0; cx < columns; cx += 1) {
                const x = -halfWidth + (cx + 0.5) / columns * 2 * halfWidth;
                const y = bottom + (cy + 0.5) / rows * (top - bottom);
                if (Math.hypot(x - u, y - data[o + 1]) < radius) {
                    const cell = cy * columns + cx;
                    opacity[cell] = 1 - (1 - opacity[cell]) * (1 - alpha);
                }
            }
        }
    }
    const solid = (cx, cy) => opacity[cy * columns + cx] >= 0.5;
    const reaches = (cx, cy, dx, dy) => {
        for (let x = cx + dx, y = cy + dy; x >= 0 && x < columns && y >= 0 && y < rows; x += dx, y += dy) {
            if (solid(x, y)) return true;
        }
        return false;
    };
    let smoke = 0, gaps = 0;
    for (let cy = 0; cy < rows; cy += 1) {
        for (let cx = 0; cx < columns; cx += 1) {
            if (solid(cx, cy)) smoke += 1;
            else if (reaches(cx, cy, 1, 0) && reaches(cx, cy, -1, 0) && reaches(cx, cy, 0, 1) && reaches(cx, cy, 0, -1)) gaps += 1;
        }
    }
    if (process.env.HEAD_MAP) {
        for (let cy = rows - 1; cy >= 0; cy -= 1) {
            console.log(Array.from({ length: columns }, (_, cx) => (solid(cx, cy) ? '#' : opacity[cy * columns + cx] > 0.1 ? '.' : ' ')).join(''));
        }
    }
    return gaps / (smoke + gaps);
}

test('the grown head is one closed mass, not a heap of separate lumps', async () => {
    for (let variant = 1; variant <= 4; variant += 1) {
        const { gltf, mixer, action, layer } = await cloud(variant);
        const camera = new THREE.PerspectiveCamera(); camera.position.set(1050, 520, 1150); camera.lookAt(0, 490, 0); camera.updateMatrixWorld();
        for (const seconds of [25, 48]) {
            action.time = seconds; mixer.update(0); gltf.scene.updateMatrixWorld(true);
            layer.onBeforeRender(null, null, camera);
            const share = enclosedGaps(layer, gltf.scene, camera);
            // One card per Blender cap lobe left 0.8-2.9 percent of the grown head as sky
            // between the lumps at 48 s; the rolled skin closes it.
            assert.ok(share < 0.005, `variant ${variant} at ${seconds} s: ${(share * 100).toFixed(1)} % of the head open`);
        }
        disposeObject3DResources(gltf.scene);
    }
});
