import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readPngRgba } from './helpers/png-rgba.mjs';
import { createReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { resolveSmokeTile, SMOKE_FRAGMENT, SMOKE_TILE_FAMILY } from '../src/entities/effects/ReactorSmokeGeometry.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

// Shapes are measured on the alpha of the first six-way light atlas; both carry the same.
const atlas = readPngRgba(fileURLToPath(new URL('../assets/vfx/torus-explosions/smoke/smoke-light-a.png', import.meta.url)));
const GRID = 4;
const TILE = atlas.width / GRID;

// Tile t sits in column t % 4 and row t // 4 counted from the bottom, as the UVs read it.
function tileAlpha(tile) {
    const column = tile % GRID;
    const row = GRID - 1 - Math.floor(tile / GRID);
    const alpha = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) {
            alpha[y * TILE + x] = atlas.data[((row * TILE + y) * atlas.width + column * TILE + x) * 4 + 3] / 255;
        }
    }
    return alpha;
}

function measure(alpha) {
    let weight = 0, sx = 0, sy = 0, minX = TILE, maxX = -1, minY = TILE, maxY = -1;
    for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) {
            const value = alpha[y * TILE + x];
            weight += value; sx += value * x; sy += value * y;
            if (value > 0.3) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        }
    }
    const mx = sx / weight, my = sy / weight;
    let sxx = 0, syy = 0, inside = 0, holes = 0;
    const solid = [];
    for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) {
            const value = alpha[y * TILE + x];
            sxx += value * (x - mx) ** 2; syy += value * (y - my) ** 2;
            if (value > 0.05) solid.push(value);
            const dx = (x - mx) / ((maxX - minX) / 2), dy = (y - my) / ((maxY - minY) / 2);
            if (dx * dx + dy * dy < 0.5) { inside += 1; if (value < 0.1) holes += 1; }
        }
    }
    solid.sort((a, b) => a - b);
    return { aspect: Math.sqrt(syy / sxx), holes: holes / inside, p90: solid[Math.floor(solid.length * 0.9)] };
}

test('the atlas holds sixteen separate smoke tiles with soft edges', () => {
    assert.equal(atlas.width, 1024);
    assert.equal(atlas.height, 1024);
    for (let tile = 0; tile < GRID * GRID; tile += 1) {
        const alpha = tileAlpha(tile);
        for (let i = 0; i < TILE; i += 1) {
            for (const index of [i, (TILE - 1) * TILE + i, i * TILE, i * TILE + TILE - 1]) {
                assert.ok(alpha[index] <= 1 / 255, `tile ${tile} touches its border, mipmaps would bleed`);
            }
        }
        assert.ok(alpha.filter((value) => value > 0.02 && value < 0.94).length > 1000, `tile ${tile} has graded edges`);
        assert.ok(measure(alpha).p90 > 0.7, `tile ${tile} is dense enough to read as smoke`);
    }
});

test('each family has its own shape, and no two tiles of a family repeat', () => {
    const shapes = Array.from({ length: GRID * GRID }, (_, tile) => measure(tileAlpha(tile)));
    const family = (id) => shapes.slice(id * GRID, id * GRID + GRID);
    for (const shape of family(SMOKE_TILE_FAMILY.billow)) {
        assert.ok(shape.aspect > 0.8 && shape.aspect < 1.25, 'billows are roughly round');
        assert.ok(shape.holes < 0.02, 'billows are closed');
    }
    for (const shape of family(SMOKE_TILE_FAMILY.column)) assert.ok(shape.aspect > 1.5, 'column parts stand upright');
    for (const shape of family(SMOKE_TILE_FAMILY.wisp)) assert.ok(shape.aspect < 0.6, 'wisps are drawn out sideways');
    for (const shape of family(SMOKE_TILE_FAMILY.holed)) assert.ok(shape.holes > 0.08, 'holed billows let the sky through');
    for (let first = 0; first < GRID * GRID; first += 1) {
        for (let second = first + 1; second < (Math.floor(first / GRID) + 1) * GRID; second += 1) {
            const a = tileAlpha(first), b = tileAlpha(second);
            let difference = 0;
            for (let i = 0; i < a.length; i += 1) difference += Math.abs(a[i] - b[i]);
            assert.ok(difference / a.length > 0.02, `tiles ${first} and ${second} differ`);
        }
    }
});

test('cards pick a tile by role and spread over the four shapes of it', () => {
    const tiles = (card) => new Set(Array.from({ length: 8 }, (_, index) => resolveSmokeTile({ ...card, index })));
    const within = (set, id) => [...set].every((tile) => tile >= id * GRID && tile < id * GRID + GRID);
    assert.ok(within(tiles({ lobe: { column: false }, detail: 0 }), SMOKE_TILE_FAMILY.billow));
    assert.ok(within(tiles({ lobe: { column: true }, detail: 0 }), SMOKE_TILE_FAMILY.column));
    assert.ok(within(tiles({ lobe: { column: true }, detail: 1 }), SMOKE_TILE_FAMILY.column));
    assert.ok(within(tiles({ lobe: { column: false }, detail: 1 }), SMOKE_TILE_FAMILY.holed));
    for (const flow of ['stream', 'shed', 'entrain']) {
        assert.ok(within(tiles({ lobe: { column: false }, detail: 1, flow }), SMOKE_TILE_FAMILY.wisp));
    }
    assert.equal(tiles({ lobe: { column: false }, detail: 0 }).size, 4);
    assert.match(SMOKE_FRAGMENT, /mod\(tile,\s*4\.0\)/, 'the shader reads a 4x4 grid');
});

test('the live cloud uses every family, lays wisps along their long side and breaks up the stem', async () => {
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const layer = createReactorSmoke(gltf.scene, action, new THREE.Texture());
    const camera = new THREE.PerspectiveCamera(); camera.position.set(450, 400, 500); camera.lookAt(0, 280, 0); camera.updateMatrixWorld();
    action.time = 20; mixer.update(0); gltf.scene.updateMatrixWorld(true);
    layer.onBeforeRender(null, null, camera);
    const data = layer.material.uniforms.smokeData.value.image.data;
    const families = new Set();
    const columnWidths = [];
    for (let row = 0; row < layer.geometry.instanceCount; row += 1) {
        const offset = row * 16;
        const tile = Math.floor(data[offset + 7]);
        const id = Math.floor(tile / GRID);
        families.add(id);
        if (id === SMOKE_TILE_FAMILY.wisp) assert.ok(data[offset + 4] >= data[offset + 5], 'a wisp card is wider than tall');
        if (id === SMOKE_TILE_FAMILY.column) columnWidths.push(data[offset + 4]);
    }
    assert.equal(families.size, 4);
    const rounded = new Set(columnWidths.map((width) => width.toFixed(1)));
    assert.ok(rounded.size > columnWidths.length * 0.6, 'stem cards are not a row of equal beads');
    disposeObject3DResources(gltf.scene);
});

test('the top of the cloud is an uneven skyline, not a crown of equal lumps', async () => {
    for (let variant = 1; variant <= 4; variant += 1) {
        const buffer = readFileSync(new URL(`../assets/maps/reactor_site/glb/torus_cloud_${variant}.glb`, import.meta.url));
        const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]); action.play();
        const layer = createReactorSmoke(gltf.scene, action, new THREE.Texture());
        const camera = new THREE.PerspectiveCamera(); camera.position.set(900, 500, 1000); camera.lookAt(0, 400, 0); camera.updateMatrixWorld();
        action.time = 48; mixer.update(0); gltf.scene.updateMatrixWorld(true);
        layer.onBeforeRender(null, null, camera);
        const data = layer.material.uniforms.smokeData.value.image.data;
        const tops = [];
        for (let row = 0; row < layer.geometry.instanceCount; row += 1) {
            const offset = row * 16;
            if (Math.floor(data[offset + 7] / GRID) !== SMOKE_TILE_FAMILY.billow) continue;
            tops.push({ top: data[offset + 1] + data[offset + 5] / 2, width: data[offset + 4] });
        }
        // The twenty highest billows. Under one flat fitted ceiling their tops spread only
        // 0.049-0.054 card widths (a crown of teeth); per-card ceilings give 0.098-0.145.
        const crown = tops.sort((a, b) => b.top - a.top).slice(0, 20);
        const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
        const heights = crown.map((entry) => entry.top);
        const spread = Math.sqrt(mean(heights.map((value) => (value - mean(heights)) ** 2)));
        assert.ok(spread / mean(crown.map((entry) => entry.width)) > 0.08,
            `variant ${variant}: crown tops spread ${(spread / mean(crown.map((entry) => entry.width))).toFixed(3)} card widths`);
        disposeObject3DResources(gltf.scene);
    }
});
