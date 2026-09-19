import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { STORM_BRIDGE_SIEGE_MAPS } from '../src/core/config/maps/presets/storm_bridge_siege/index.js';
import { STORM_LIGHTHOUSE_SIEGE_MAPS } from '../src/core/config/maps/presets/storm_lighthouse_siege/index.js';
import { STORM_DAM_SIEGE_MAPS } from '../src/core/config/maps/presets/storm_dam_siege/index.js';
import { loadGLBMap } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const CASES = Object.freeze([
    Object.freeze({
        map: STORM_BRIDGE_SIEGE_MAPS.storm_bridge_siege,
        asset: 'storm_bridge_siege',
        file: '30_bridge_train',
        id: 'storm-bridge-train',
        clip: 'BridgeTrainLoop',
        duration: 12,
    }),
    Object.freeze({
        map: STORM_LIGHTHOUSE_SIEGE_MAPS.storm_lighthouse_siege,
        asset: 'storm_lighthouse_siege',
        file: '30_lighthouse_lift',
        id: 'storm-lighthouse-lift',
        clip: 'LighthouseLiftLoop',
        duration: 10,
    }),
    Object.freeze({
        map: STORM_DAM_SIEGE_MAPS.storm_dam_siege,
        asset: 'storm_dam_siege',
        file: '30_dam_gate',
        id: 'storm-dam-gate',
        clip: 'DamGateLoop',
        duration: 8,
    }),
]);

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function clipDuration(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

function animatedMeshNames(document) {
    const names = new Set();
    const visit = (nodeIndex) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        if (node.mesh !== undefined) names.add(node.name);
        for (const child of node.children || []) visit(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) visit(channel.target.node);
    }
    return [...names];
}

test('Wave 6 maps place three looping moving obstacles on dynamic scene collision', () => {
    for (const entry of CASES) {
        assert.equal(entry.map.glbColliderMode, 'scene');
        const model = entry.map.glbModels.find((candidate) => candidate.id === entry.id);
        assert.ok(model, `${entry.id} is placed`);
        assert.equal(model.animationClock?.mode, 'loop');
        assert.equal(model.animationClock?.clipName, entry.clip);
        assert.ok(entry.map.destructibles.breakScenes[0].hideModelIds.includes(entry.id));
    }
});

test('moving obstacle GLBs keep editable sources, one timed clip and collidable animated meshes', () => {
    for (const entry of CASES) {
        const root = path.resolve('assets/maps', entry.asset);
        const blendPath = path.join(root, 'blender', `${entry.file}.blend`);
        const glbPath = path.join(root, 'glb', `${entry.file}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${entry.file} keeps an editable source`);
        assert.ok(statSync(glbPath).size > 2_000, `${entry.file} exports runtime geometry`);
        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1);
        assert.equal(document.animations[0].name, entry.clip);
        assert.ok(Math.abs(clipDuration(document, document.animations[0]) - entry.duration) <= (1 / 30));
        assert.ok(animatedMeshNames(document).length > 0, `${entry.file} moves collidable meshes`);
        assert.equal((document.nodes || []).some((node) => /_nocol/i.test(String(node.name || ''))), false);
    }
});

test('the runtime loader builds dynamic colliders for every Wave 6 obstacle', async () => {
    for (const entry of CASES) {
        const url = `assets/maps/${entry.asset}/glb/${entry.file}.glb`;
        const result = await loadGLBMap(url, { loader: geometryOnlyGlbLoader, colliderMode: 'scene' });
        try {
            assert.equal(result.animationTracks.length, 1, `${entry.id} exposes one runtime track`);
            assert.ok(result.colliders.length > 0, `${entry.id} exposes collision geometry`);
            assert.ok(result.colliders.every((collider) => collider.dynamic === true), `${entry.id} colliders follow the clip`);
        } finally {
            disposeObject3DResources(result.scene);
        }
    }
});
