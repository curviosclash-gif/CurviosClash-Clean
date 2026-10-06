import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from 'three';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { TREE_SCALE } from '../src/core/config/maps/presets/giant_forest/GiantForestTrees.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// A model drawn far behind the fog costs draw time for nothing, and one culled inside it winks out.
// The fog closes completely at its far distance (AtmosphericFogShaderPatch mixes to 1.0 at the clip
// distance whatever the height) and the camera far plane is that same distance, so nothing is
// visible beyond it, above the canopy deck included. The cull test of a LOD measures to the model's
// origin, which sits at the foot of the tree, so the distance that is safe is the fog's far plus
// the farthest point of the model from that origin: any visible fragment is then still inside.
// Cull distances are authored units, the fog is world units (not scaled with the map).

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
// Whole authored units: rounding a cull distance up can add at most one of them.
const ROUNDING = 1;

function checkMapFog(mapKey) {
    const map = MAP_PRESET_CATALOG[mapKey];
    const far = map.lighting.fog.far;
    // The camera's far plane is max(CONFIG.CAMERA.FAR, fog far) unless the map asks for more.
    assert.equal(map.cameraFar, undefined, `${mapKey} extends the camera past its fog`);
    assert.ok(far >= CONFIG.CAMERA.FAR, `${mapKey}: the fog far (${far}) is the camera far plane`);
    return { map, farAuthored: far / MAP_SCALE };
}

async function crownReach(url, scale) {
    const gltf = await geometryOnlyGlbLoader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const point = new Vector3();
    let reach = 0;
    gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        const position = node.geometry.attributes.position;
        for (let index = 0; index < position.count; index += 1) {
            point.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld);
            reach = Math.max(reach, point.length() * scale);
        }
    });
    return reach;
}

test('giant_forest culls its crowns and undergrowth where its fog has closed', async () => {
    const { map, farAuthored } = checkMapFog('giant_forest');
    const crowns = map.glbModels.filter((model) => model.id.includes('-crown-'));
    const undergrowth = map.glbModels.filter((model) => model.id.includes('-fern-')
        || model.id.includes('-root-') || model.id.includes('-vine-'));
    assert.ok(crowns.length > 0 && undergrowth.length > 0);

    const reachByUrl = new Map();
    for (const url of new Set(crowns.map((crown) => crown.url))) reachByUrl.set(url, await crownReach(url, TREE_SCALE));
    const widest = Math.max(...reachByUrl.values());
    for (const crown of crowns) {
        const needed = farAuthored + reachByUrl.get(crown.url);
        assert.ok(crown.maxRenderDistance >= needed, `${crown.id} winks out at ${crown.maxRenderDistance}, needs ${needed.toFixed(1)}`);
        assert.ok(crown.maxRenderDistance <= farAuthored + widest + ROUNDING,
            `${crown.id} is drawn to ${crown.maxRenderDistance} authored units, fog and tree end by ${(farAuthored + widest).toFixed(1)}`);
    }

    // A model fitted to targetSize fits a box of that size at the foot: its farthest corner is
    // sqrt(0.5^2 + 0.5^2 + 1) = 1.225 of it.
    for (const model of undergrowth) {
        const needed = farAuthored + model.targetSize * 1.225;
        assert.ok(model.maxRenderDistance >= needed, `${model.id} winks out at ${model.maxRenderDistance}, needs ${needed.toFixed(1)}`);
        assert.ok(model.maxRenderDistance <= needed + ROUNDING + 1,
            `${model.id} is drawn to ${model.maxRenderDistance}, fog and plant end by ${needed.toFixed(1)}`);
    }
});

test('cherry_grove culls its trees where its fog has closed and loads at most four files at once', () => {
    const { map, farAuthored } = checkMapFog('cherry_grove');
    const qa = JSON.parse(readFileSync(new URL('../assets/maps/cherry_grove/cherry_grove_asset_qa.json', import.meta.url), 'utf8'));
    // bounds_m is width, depth, height of the exported tree; its origin is the centre of the foot.
    const reachByFile = new Map();
    for (const family of Object.values(qa.families)) {
        for (const variant of family.variants) {
            const [width, depth, height] = variant.bounds_m;
            reachByFile.set(variant.file, Math.hypot(width / 2, depth / 2, height));
        }
    }
    const widest = Math.max(...reachByFile.values());
    const renders = map.glbModels.filter((model) => model.collision === false);
    assert.equal(renders.length, 10);
    for (const model of renders) {
        const reach = reachByFile.get(model.url.split('/').pop());
        assert.ok(reach > 0, `${model.id} has no measured size in the QA file`);
        assert.ok(model.maxRenderDistance >= farAuthored + reach,
            `${model.id} winks out at ${model.maxRenderDistance}, needs ${(farAuthored + reach).toFixed(1)}`);
        assert.ok(model.maxRenderDistance <= farAuthored + widest + ROUNDING,
            `${model.id} is drawn to ${model.maxRenderDistance} authored units, fog and tree end by ${(farAuthored + widest).toFixed(1)}`);
    }
    assert.ok(map.glbLoadConcurrency >= 3 && map.glbLoadConcurrency <= 4,
        `two files of 40 MB and more load together: concurrency ${map.glbLoadConcurrency}`);
});
