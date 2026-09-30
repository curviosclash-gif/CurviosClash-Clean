import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import { ORBITAL_SHIPYARD_MAPS } from '../src/core/config/maps/presets/orbital_shipyard/index.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const ASSET_ROOT = path.resolve('assets/maps/orbital_shipyard');
const LAYOUT_SOURCE = path.resolve('scripts/orbital_shipyard_layout.py');

// The eight static architecture parts (scripts/generate_orbital_shipyard_assets.py, ARCHITECTURE).
const STATIC_PARTS = [
    '01_station_deck', '02_launch_bay', '03_scaffold_yard', '04_hull_spine',
    '05_airlock_hall', '06_drydock_tower', '07_fuel_canyon', '08_backdrop',
];

// The five animated setpieces, with the clip name and loop length the generator's SETPIECES tuple
// states (scripts/generate_orbital_shipyard_assets.py). scripts/orbital_shipyard_layout.py holds
// the loop_seconds for each of these in the CRANE/GANTRY/AIRLOCK/ROTOR/PISTONS section dicts.
const SETPIECE_PARTS = Object.freeze({
    '10_crane_sweep': { clipName: 'CraneSweepLoop', seconds: 24 },
    '11_weld_gantry': { clipName: 'WeldGantryLoop', seconds: 16 },
    '12_airlock_doors': { clipName: 'AirlockCycleLoop', seconds: 12 },
    '13_tower_rotor': { clipName: 'TowerRotorLoop', seconds: 16 },
    '14_fuel_pistons': { clipName: 'FuelPistonLoop', seconds: 8 },
});

const ALL_PARTS = [...STATIC_PARTS, ...Object.keys(SETPIECE_PARTS)];

const RING_MARGIN = 3.0; // scripts/orbital_shipyard_layout.py RING_MARGIN
const UNDECODABLE = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression',
    'KHR_meshopt_compression', 'KHR_texture_basisu']);

function blendPath(name) {
    return path.join(ASSET_ROOT, 'blender', `${name}.blend`);
}
function glbPath(name) {
    return path.join(ASSET_ROOT, 'glb', `${name}.glb`);
}

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

// Mirrors the runtime rule: a keyframed transform moves every mesh in its subtree, so a rig empty
// makes the meshes parented below it collidable.
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

function triangleCount(document) {
    const accessors = document.accessors || [];
    let total = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            if (primitive.indices === undefined) continue;
            total += Math.floor(Number(accessors[primitive.indices]?.count || 0) / 3);
        }
    }
    return total;
}

function modelsByFile(map) {
    const byFile = new Map();
    for (const model of map.glbModels) {
        const stem = path.basename(model.url, '.glb');
        if (!byFile.has(stem)) byFile.set(stem, []);
        byFile.get(stem).push(model);
    }
    return byFile;
}

test('every Orbital Shipyard part keeps an editable Blender source and a non-empty GLB', () => {
    for (const name of ALL_PARTS) {
        assert.ok(statSync(blendPath(name)).size > 100_000, `${name} keeps an editable Blender source`);
        assert.ok(statSync(glbPath(name)).size > 2_000, `${name} exports a non-empty GLB`);
    }
});

test('no Orbital Shipyard GLB exceeds the file-size budget', () => {
    for (const name of ALL_PARTS) {
        const kib = statSync(glbPath(name)).size / 1024;
        assert.ok(kib <= 1_200, `${name} is ${kib.toFixed(1)} KiB, over the 1200 KiB budget`);
    }
});

test('no Orbital Shipyard GLB uses an extension the runtime cannot decode', () => {
    for (const name of ALL_PARTS) {
        const document = readGlbJson(glbPath(name));
        for (const extension of document.extensionsUsed || []) {
            assert.ok(!UNDECODABLE.has(extension), `${name} uses ${extension}, which the game registers no decoder for`);
        }
    }
});

test('the static architecture parts carry no animation and stay inside the triangle/node budget', () => {
    for (const name of STATIC_PARTS) {
        const document = readGlbJson(glbPath(name));
        assert.equal(document.animations?.length ?? 0, 0, `${name} is static architecture`);
        assert.ok(triangleCount(document) <= 18_000, `${name} stays inside the static budget`);
        assert.ok((document.nodes || []).length <= 12, `${name} exports as joined meshes`);
    }
});

test('the five setpieces expose exactly one correctly timed loop each', () => {
    for (const [name, expected] of Object.entries(SETPIECE_PARTS)) {
        const document = readGlbJson(glbPath(name));
        assert.equal(document.animations?.length, 1, `${name} has exactly one loader-compatible clip`);
        const [animation] = document.animations;
        assert.equal(animation.name, expected.clipName, `${name} names the clip the generator registered`);
        assert.ok(animation.channels.length > 0, `${name} clip animates scene nodes`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, animation) - expected.seconds) <= (1 / 30),
            `${name} keeps its authored loop duration`,
        );
        assert.ok(
            animatedMeshNodeNames(document).length > 0,
            `${name} drives at least one mesh, so it can carry a dynamic collider`,
        );
        assert.ok(triangleCount(document) <= 8_000, `${name} stays inside the setpiece budget`);
    }
});

test('the preset places every part exactly once, at scale 1, on the bounding box the GLB itself reports', async () => {
    const map = ORBITAL_SHIPYARD_MAPS.orbital_shipyard;
    const byFile = modelsByFile(map);

    for (const name of ALL_PARTS) {
        const placed = byFile.get(name);
        assert.ok(placed?.length, `${name} is placed in the map`);
        assert.equal(placed.length, 1, `${name} is placed exactly once`);
        const [model] = placed;
        assert.equal(model.scale, 1, `${name} keeps the shared frame's scale of 1`);
        assert.deepEqual(model.rotation, [0, 0, 0], `${name} keeps the shared frame's rotation`);

        const gltf = await geometryOnlyGlbLoader.loadAsync(glbPath(name));
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        const centerZ = (bounds.min.z + bounds.max.z) / 2;
        assert.ok(Math.abs(model.position[0] - centerX) <= 0.05, `${name} sits on its own X centre`);
        assert.ok(Math.abs(model.position[1] - bounds.min.y) <= 0.05, `${name} sits on its own Y base`);
        assert.ok(Math.abs(model.position[2] - centerZ) <= 0.05, `${name} sits on its own Z centre`);

        if (SETPIECE_PARTS[name]) {
            assert.equal(model.animationClock?.clipName, SETPIECE_PARTS[name].clipName,
                `${name} addresses the clip its GLB actually contains`);
            assert.equal(model.animationClock?.phaseOffsetBeats, 0, `${name} runs on the shared beat`);
        }
    }
    assert.equal(map.glbAnimationClock?.beatSeconds, 4, 'the map states the shared 4 s beat');
});

// --- The route: preset vs. the single source of truth in scripts/orbital_shipyard_layout.py -----

function parsePythonTuple3(text) {
    return text.split(',').map((value) => Number(value.trim()));
}

function parseLayoutCheckpoints() {
    const source = readFileSync(LAYOUT_SOURCE, 'utf8');
    const entryPattern = /\(\s*"([A-Z0-9_]+)"\s*,\s*"(\w+)"\s*,\s*\(([^)]+)\)\s*,\s*([\d.]+)\s*,\s*\(([^)]+)\)\s*,\s*\(([^)]*)\)\s*,\s*"([^"]+)"\s*\)/gs;
    const checkpoints = [];
    const checkpointsBlock = source.slice(source.indexOf('CHECKPOINTS = ('), source.indexOf('\nFINISH ='));
    for (const match of checkpointsBlock.matchAll(entryPattern)) {
        const [, id, type, pos, radius, forward, nextIdsRaw, label] = match;
        checkpoints.push({
            id, type,
            pos: parsePythonTuple3(pos),
            radius: Number(radius),
            forward: parsePythonTuple3(forward),
            nextIds: [...nextIdsRaw.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]),
            label,
        });
    }
    const finishMatch = /FINISH = \(\s*"FINISH"\s*,\s*"finish"\s*,\s*\(([^)]+)\)\s*,\s*([\d.]+)\s*,\s*\(([^)]+)\)\s*,\s*\(\)\s*,\s*"([^"]+)"\s*\)/s
        .exec(source);
    const finish = {
        id: 'FINISH', pos: parsePythonTuple3(finishMatch[1]), radius: Number(finishMatch[2]),
        forward: parsePythonTuple3(finishMatch[3]), label: finishMatch[4],
    };
    return { checkpoints, finish };
}

// Reproduces the parcours runtime's own fallback (ParcoursProgressUtils.js): a checkpoint that
// does not declare nextIds hands the run to the next entry in the array.
function resolvedNextIds(entries, index) {
    const declared = entries[index].nextIds;
    if (Array.isArray(declared) && declared.length > 0) return declared;
    const next = entries[index + 1];
    return next ? [next.id] : [];
}

test('the route matches scripts/orbital_shipyard_layout.py checkpoint for checkpoint', () => {
    const { checkpoints: layoutCheckpoints, finish: layoutFinish } = parseLayoutCheckpoints();
    const { checkpoints: presetCheckpoints, finish: presetFinish } = ORBITAL_SHIPYARD_MAPS.orbital_shipyard.parcours;

    assert.equal(presetCheckpoints.length, layoutCheckpoints.length, 'same number of checkpoints');
    assert.deepEqual(presetCheckpoints.map((c) => c.id), layoutCheckpoints.map((c) => c.id), 'same ids in the same order');

    // Mirrors scripts/orbital_shipyard_layout.py's all_checkpoints(): the finish is the last stop
    // after the last checkpoint, so the fallback for CP18 -> FINISH only resolves with it appended.
    const presetRoute = [...presetCheckpoints, presetFinish];

    layoutCheckpoints.forEach((layoutEntry, index) => {
        const presetEntry = presetCheckpoints[index];
        assert.deepEqual(presetEntry.pos, layoutEntry.pos, `${layoutEntry.id} position matches the layout`);
        assert.equal(presetEntry.radius, layoutEntry.radius, `${layoutEntry.id} radius matches the layout`);
        assert.deepEqual(presetEntry.forward, layoutEntry.forward, `${layoutEntry.id} forward matches the layout`);
        assert.deepEqual(
            resolvedNextIds(presetRoute, index), layoutEntry.nextIds,
            `${layoutEntry.id} resolves to the same next checkpoint(s) as the layout`,
        );
    });

    assert.deepEqual(presetFinish.pos, layoutFinish.pos, 'finish position matches the layout');
    assert.equal(presetFinish.radius, layoutFinish.radius, 'finish radius matches the layout');
    assert.deepEqual(presetFinish.forward, layoutFinish.forward, 'finish forward matches the layout');
});

// --- Clearance: every ring stays radius + RING_MARGIN away from the static architecture ----------
//
// A bounding box cannot tell a hollow shell (a hull a player flies inside) from a solid block, so
// clearance is measured against the actual triangles the collider compiles from, exactly like the
// runtime's scene collider does. A cheap per-triangle bounding-sphere reject keeps this fast: most
// triangles sit nowhere near a given ring and are skipped without the full closest-point test.

const closestPointScratch = new THREE.Vector3();

function triangleClearsPoint(triangle, point, required) {
    triangle.getMidpoint(closestPointScratch);
    const spread = Math.max(
        closestPointScratch.distanceTo(triangle.a),
        closestPointScratch.distanceTo(triangle.b),
        closestPointScratch.distanceTo(triangle.c),
    );
    if (closestPointScratch.distanceTo(point) - spread >= required) return true; // safe reject
    triangle.closestPointToPoint(point, closestPointScratch);
    return closestPointScratch.distanceTo(point) >= required;
}

test('every ring centre keeps its clearance from the static architecture', async () => {
    const map = ORBITAL_SHIPYARD_MAPS.orbital_shipyard;
    const rings = [...map.parcours.checkpoints, map.parcours.finish];
    const byFile = modelsByFile(map);

    for (const name of STATIC_PARTS) {
        const [model] = byFile.get(name);
        const gltf = await geometryOnlyGlbLoader.loadAsync(glbPath(name));
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        const centerZ = (bounds.min.z + bounds.max.z) / 2;
        // scale 1, rotation [0,0,0]: the world transform is the file's own local transforms
        // (baked into each node's matrixWorld) plus this one recentring translation.
        const offset = new THREE.Vector3(model.position[0] - centerX, model.position[1] - bounds.min.y, model.position[2] - centerZ);

        const meshes = [];
        gltf.scene.traverse((node) => {
            if (!node.isMesh) return;
            if (String(node.name || '').toLowerCase().includes('_nocol')) return;
            meshes.push(node);
        });

        for (const ring of rings) {
            if (ring.centerObstructionAllowed) continue;
            const point = new THREE.Vector3(ring.pos[0], ring.pos[1], ring.pos[2]).sub(offset);
            const required = ring.radius + RING_MARGIN;

            for (const node of meshes) {
                node.updateWorldMatrix(true, false);
                const position = node.geometry.attributes.position;
                const index = node.geometry.index;
                const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
                const triangle = new THREE.Triangle(a, b, c);
                const triangleCount = index ? index.count / 3 : position.count / 3;
                for (let t = 0; t < triangleCount; t += 1) {
                    const i0 = index ? index.getX(t * 3) : t * 3;
                    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
                    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
                    a.fromBufferAttribute(position, i0).applyMatrix4(node.matrixWorld);
                    b.fromBufferAttribute(position, i1).applyMatrix4(node.matrixWorld);
                    c.fromBufferAttribute(position, i2).applyMatrix4(node.matrixWorld);
                    if (!triangleClearsPoint(triangle, point, required)) {
                        triangle.closestPointToPoint(point, closestPointScratch);
                        assert.fail(`${ring.id} keeps ${required} clearance from ${name}'s "${node.name}" `
                            + `(got ${closestPointScratch.distanceTo(point).toFixed(2)})`);
                    }
                }
            }
        }
    }
});
