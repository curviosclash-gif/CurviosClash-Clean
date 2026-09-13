import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Vector3 } from 'three';

import { CHRONO_FORGE_NEXUS_MAP } from '../src/core/config/maps/presets/chrono_forge_nexus.js';
import { loadGLBMap } from '../src/entities/GLBMapLoader.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { refreshDynamicMeshCollider, sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const ASSET_ROOT = path.resolve('assets/maps/chrono_forge');
const EXPECTED_SETPIECES = Object.freeze({
    '01_hangar_crane': 12,
    '02_machine_core': 8,
    '03_crystal_shards': 6,
    '04_chronometer': 16,
    '05_temple_gates': 10,
    '06_airship': 14,
    '07_drone_swarm': 9,
    '08_time_core': 7,
});

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

// Mirrors the runtime rule: a keyframed transform moves every mesh in its subtree, so a
// rig empty makes the meshes parented below it collidable.
function animatedMeshNodeNames(document) {
    const nodes = document.nodes || [];
    const names = new Set();
    const collectSubtreeMeshes = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(node.name);
        for (const child of node.children || []) collectSubtreeMeshes(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (!['translation', 'rotation', 'scale'].includes(channel.target?.path)) continue;
            collectSubtreeMeshes(channel.target.node);
        }
    }
    return [...names];
}

test('Chrono-Forge Blender sources and GLBs expose one correctly timed loop each', () => {
    for (const [name, expectedDuration] of Object.entries(EXPECTED_SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps an editable Blender source`);
        assert.ok(statSync(glbPath).size > 10_000, `${name} exports a non-empty GLB`);

        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1, `${name} has exactly one loader-compatible clip`);
        assert.ok(document.animations[0].channels.length > 0, `${name} clip animates scene nodes`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expectedDuration) <= (1 / 30),
            `${name} keeps its authored loop duration`,
        );

        // Only the temple's decorative overlays may opt out of collision. Its original
        // moving door bodies and every other setpiece retain the dynamic collision rule.
        const suppressedNodes = (document.nodes || [])
            .filter((node) => /_nocol/i.test(String(node.name || '')))
            .filter((node) => !(name === '05_temple_gates'
                && /^temple_(arch|gate_left|gate_right)_detail_/.test(node.name)))
            .map((node) => node.name);
        assert.deepEqual(suppressedNodes, [], `${name} keeps gameplay meshes collidable`);

        assert.ok(
            animatedMeshNodeNames(document).length > 0,
            `${name} drives at least one mesh, so it can carry a dynamic collider`,
        );
    }
});

test('Temple gate materials and batched detail stay within the asset budget', () => {
    const glbPath = path.join(ASSET_ROOT, 'glb', '05_temple_gates.glb');
    const document = readGlbJson(glbPath);
    const primitives = document.meshes.flatMap((mesh) => mesh.primitives);
    const triangles = primitives.reduce((sum, primitive) => (
        sum + document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3
    ), 0);
    assert.ok(primitives.length <= 20, 'the gate needs at most twenty material draws');
    assert.ok(triangles <= 2500, 'mechanical detail stays below 2,500 triangles');
    assert.ok(statSync(glbPath).size <= 180 * 1024, 'the gate stays below 180 KiB');
    const materials = new Map(document.materials.map((entry) => [entry.name, entry]));
    const roughness = (name) => materials.get(name).pbrMetallicRoughness.roughnessFactor;
    assert.ok(roughness('TempleBrushedBronze') + 0.15 < roughness('TempleForgedIron'));
    assert.ok(roughness('TempleForgedIron') + 0.15 < roughness('TempleCeramicInset'));
    const details = document.nodes.filter((node) => /_detail_/.test(node.name));
    assert.ok(details.length > 0);
    assert.ok(details.every((node) => /_noshadow_nocol$/.test(node.name)),
        'small trim neither casts shadows nor creates extra collision surfaces');
});

test('Temple gate polish preserves placement and the full moving collision cycle', async () => {
    const result = await loadGLBMap('assets/maps/chrono_forge/glb/05_temple_gates.glb', {
        loader: geometryOnlyGlbLoader, colliderMode: 'dynamic',
    });
    const driver = new GlbAnimationDriver();
    try {
        driver.setTracks(result.animationTracks);
        const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.0001,
            `${label}: expected ${expected}, got ${actual}`);
        closeTo(result.bounds.min.x, -5.5, 'original left placement edge');
        closeTo(result.bounds.max.x, 5.5, 'original right placement edge');
        closeTo(result.bounds.min.y, -0.4, 'original placement floor');
        closeTo(result.bounds.max.y, 7.1, 'original placement roof');
        assert.deepEqual(result.colliders.map((entry) => entry.meshCollider.mesh.name).sort(),
            ['temple_gate_left', 'temple_gate_right']);
        const center = new Vector3();
        for (let frame = 0; frame <= 300; frame++) {
            const seconds = frame / 30;
            driver.setElapsedSeconds(seconds);
            driver.advance(0);
            result.scene.updateMatrixWorld(true);
            // The existing animation eases over two seconds, holds open for six,
            // and eases shut over two; sample on the exported 30 fps timeline.
            const progress = seconds < 2 ? seconds / 2 : seconds <= 8 ? 1 : (10 - seconds) / 2;
            const offset = 2.25 + 1.75 * progress * progress * (3 - 2 * progress);
            for (const entry of result.colliders) {
                refreshDynamicMeshCollider(entry.meshCollider, entry.box);
                const sign = entry.meshCollider.mesh.name.endsWith('_left') ? -1 : 1;
                entry.box.getCenter(center);
                closeTo(center.x, sign * offset, `leaf position at ${seconds}s`);
                closeTo(entry.box.max.x - entry.box.min.x, 4.3, 'unchanged leaf width');
                closeTo(entry.box.max.y - entry.box.min.y, 5.6, 'unchanged leaf height');
                closeTo(entry.box.max.z - entry.box.min.z, 0.7, 'unchanged leaf depth');
                assert.ok(sphereIntersectsStaticMeshCollider(entry.meshCollider, center, 0.2));
            }
            if (seconds >= 2 && seconds <= 8) {
                for (let z = -2; z <= 2; z += 0.25) {
                    for (const entry of result.colliders) {
                        assert.equal(sphereIntersectsStaticMeshCollider(entry.meshCollider,
                            { x: 0, y: 3, z }, 1.1), false, `open flight corridor at ${seconds}s`);
                    }
                }
            }
        }
    } finally {
        driver.clear();
        disposeObject3DResources(result.scene);
    }
});

test('Chrono-Forge map gives its animated setpieces dynamic GLB collision', () => {
    const map = CHRONO_FORGE_NEXUS_MAP.chrono_forge_nexus;
    const placedFiles = new Set(map.glbModels.map((model) => path.basename(model.url, '.glb')));

    // 'dynamic' collides the moving parts while the static dressing keeps the authored boxes.
    assert.equal(map.glbColliderMode, 'dynamic');
    assert.ok(Array.isArray(map.obstacles) && map.obstacles.length > 0, 'authored box obstacles remain');
    for (const name of Object.keys(EXPECTED_SETPIECES)) {
        assert.ok(placedFiles.has(name), `${name} is placed in the map`);
    }
});
