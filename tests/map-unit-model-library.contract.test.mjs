import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// The tank model library built by scripts/generate_map_unit_blender_assets.py. It is a parts list,
// not a finished vehicle: the runtime hangs turret and barrel on a pivot of its own so they can
// turn while the hull drives.
//
// Everything is authored in GROUND SPACE - the file origin is the point the tank stands on - and
// the game model faces +Z. The three numbers this file pins are the ones the runtime depends on:
// the hull sits on the floor, the turret straddles the known turret height, and the barrel points
// forward. It also pins that no node carries a transform of its own: a rotated root mesh is the
// classic way an authored model ends up lying on its side in the game.
const LIBRARY = path.resolve('assets/models/map_units/map_unit_library.glb');

const TURRET_HEIGHT = 2.1;
const MAX_TRIANGLES = 3000;
const MAX_KILOBYTES = 400;

const PARTS = Object.freeze(['tank_hull', 'tank_track_left', 'tank_track_right', 'tank_turret', 'tank_barrel', 'tank_wreck']);

function readLibrary() {
    const bytes = readFileSync(LIBRARY);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    const nodes = new Map();
    for (const node of document.nodes || []) {
        const mesh = document.meshes[node.mesh];
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let triangles = 0;
        for (const primitive of mesh.primitives) {
            const accessor = document.accessors[primitive.attributes.POSITION];
            for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], accessor.min[axis]);
                max[axis] = Math.max(max[axis], accessor.max[axis]);
            }
            triangles += document.accessors[primitive.indices].count / 3;
        }
        nodes.set(node.name, { node, min, max, triangles });
    }
    return { document, nodes };
}

test('the library carries every part the runtime asks for by name', () => {
    const { nodes } = readLibrary();
    assert.deepEqual([...nodes.keys()].sort(), [...PARTS].sort());
});

test('no part carries a transform of its own', () => {
    const { nodes } = readLibrary();
    for (const [name, part] of nodes) {
        assert.equal(part.node.rotation, undefined, `${name} must not be rotated at its root`);
        assert.equal(part.node.scale, undefined, `${name} must not be scaled at its root`);
        const translation = part.node.translation || [0, 0, 0];
        assert.deepEqual(translation.map(Number), [0, 0, 0], `${name} must sit at the file origin`);
    }
});

test('hull and tracks stand on the ground, not in it and not above it', () => {
    const { nodes } = readLibrary();
    for (const name of ['tank_hull', 'tank_track_left', 'tank_track_right', 'tank_wreck']) {
        const part = nodes.get(name);
        assert.ok(part.min[1] >= -0.05, `${name} must not sink into the floor, lowest point ${part.min[1]}`);
        assert.ok(part.min[1] <= 0.3, `${name} must touch the floor, lowest point ${part.min[1]}`);
    }
});

test('the tracks sit left and right of the hull centre', () => {
    const { nodes } = readLibrary();
    const left = nodes.get('tank_track_left');
    const right = nodes.get('tank_track_right');
    assert.ok(left.max[0] < 0, 'the left track stays on the left');
    assert.ok(right.min[0] > 0, 'the right track stays on the right');
    assert.ok(Math.abs(left.min[0] + right.max[0]) < 0.001, 'the tracks are mirrored');
});

test('the turret straddles the head pivot height', () => {
    const { nodes } = readLibrary();
    const turret = nodes.get('tank_turret');
    assert.ok(turret.min[1] < TURRET_HEIGHT, 'the turret ring reaches down to the pivot');
    assert.ok(turret.max[1] > TURRET_HEIGHT, 'and the turret body sits above it');
});

test('the barrel points forward, the way the model faces', () => {
    const { nodes } = readLibrary();
    const barrel = nodes.get('tank_barrel');
    assert.ok(barrel.min[2] > 0, 'the whole barrel is in front of the turret centre');
    assert.ok(barrel.max[2] > 4, `the muzzle reaches past the hull nose, reached ${barrel.max[2]}`);
    assert.ok(barrel.max[2] - barrel.min[2] > barrel.max[0] - barrel.min[0], 'and it is longer than it is wide');
});

test('the library stays cheap enough for sixteen units on a map', () => {
    const { nodes } = readLibrary();
    const triangles = [...nodes.values()].reduce((sum, part) => sum + part.triangles, 0);
    assert.ok(triangles <= MAX_TRIANGLES, `the whole library is ${triangles} triangles`);
    const kilobytes = statSync(LIBRARY).size / 1024;
    assert.ok(kilobytes <= MAX_KILOBYTES, `the library file is ${Math.round(kilobytes)} KB`);
});
