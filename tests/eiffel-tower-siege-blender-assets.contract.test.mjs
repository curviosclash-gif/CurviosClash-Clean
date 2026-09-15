import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

// The break scenes of the destructible Eiffel Tower. Each one is a single one-shot clip in which
// the part of the tower above a destroyed segment topples, shears apart and lands.
//
// This file reads the GLBs directly rather than through the map catalog, because the map preset
// that places them is a later stage. What it does assert is the half of the contract the preset
// will depend on: which pieces a scene contains, which clip the runtime has to address by name,
// and above all that frame 1 of every scene is the tower standing exactly where the intact parts
// stand -- the preset places a scene by the bounding box of that rest pose and turns the slot
// about its own footprint centre, so a rest pose that already leaned would put the tower back
// together crooked.
const ASSET_ROOT = path.resolve('assets/maps/eiffel_tower_siege');

// The four scenes, with the pieces each one drops and the height the intact part it replaces
// reports as its underside. Those heights are the numbers the preset places by, so they live here
// as well as in the generator: this is the contract between the Blender source and the map.
const SCENES = Object.freeze({
    '20_topple_lower': {
        clip: 'ToppleLowerOnce',
        pieces: ['lower', 'mid', 'shaft', 'summit'],
        baseMetres: -0.66,   // the same underside as 02_legs_lower
    },
    '21_topple_mid': {
        clip: 'ToppleMidOnce',
        pieces: ['mid', 'shaft', 'summit'],
        baseMetres: 59.63,   // 05_legs_mid
    },
    '22_topple_shaft': {
        clip: 'ToppleShaftOnce',
        pieces: ['shaft', 'summit'],
        baseMetres: 117.65,  // 07_shaft
    },
    '23_topple_summit': {
        clip: 'ToppleSummitOnce',
        pieces: ['summit'],
        baseMetres: 276.1,   // 08_summit
    },
});

// The one static part: the Champ-de-Mars again, with its lawn run out far enough to catch the
// wreck. It replaces 01_champ_de_mars on this map rather than joining it.
const WIDE_ESPLANADE = '01_champ_de_mars_wide';

// The most any one piece may turn over a whole clip, summed over the rotation sampler rather than
// read off the final pose. Wreckage tumbles; it does not roll away across the Champ-de-Mars, and
// an earlier pass had the summit turning two and a half revolutions on the second gallery.
const TUMBLE_LIMIT_DEGREES = 540;

// The two ways a clip stops being a fall and starts being a teleport, measured between one frame
// and the next. Six metres a frame is 180 m/s, faster than anything that started at 330 m can be
// travelling; eight degrees a frame is 240 deg/s. An earlier pass moved a piece forty metres and
// turned it ten in a single frame, which is the defect these two numbers exist to catch.
const MAX_STEP_METRES = 6.0;
const MAX_STEP_DEGREES = 8.0;

// How still a piece has to be to count as stopped, per frame, and for how long before the clip may
// end. Both halves matter: a clip that ends the moment the last piece stops has nothing to hold on,
// and a clip whose "rest" is really a slow slide freezes mid-slide.
const REST_STEP_METRES = 0.05;
const REST_STEP_DEGREES = 0.5;
const REST_FRAMES = 30;

// How far off upright a piece has to finish. The one pose a collapse must never end in is the
// pose it started in: an earlier pass clamped pieces exactly vertical and then dropped them
// straight down to stand on their own feet, which is how a 159 m stub ended up standing 133 m from
// the axis. The stump of 20_topple_lower is the exception and is checked separately -- it is the
// part of the tower that never left the ground.
const UPRIGHT_MARGIN_DEGREES = 10;
const STUMP = Object.freeze({ scene: '20_topple_lower', piece: 'piece_lower' });

// How far below the esplanade a piece may be drawn once it has come to rest.
//
// Not zero, and the reason is worth stating. What the generator simulates is a convex hull per
// piece, and the joint that failed under it is modelled by cutting the struck quarter out of the
// bottom of that hull -- that cut is what stops a piece coming down sixty metres and standing on
// its foot. The iron in the cut corner is still drawn: every piece here is built by the intact
// tower's own builders and may not lose a vertex, or the rest pose would stop measuring like the
// part it replaces. So a piece lying on its shear face has that corner under the lawn, by about
// the depth of the cut.
const BURIAL_LIMIT_METRES = 15.0;
// The stump of 20_topple_lower is the stated exception: its struck piers are ground into the
// ground as the tower sags onto them, which is the only way a tower whose base is wider than its
// centre of mass is high can move at all.
const CRUSHED_BURIAL_LIMIT_METRES = 30.0;

// Where the legs of the standing tower are, as the generator draws them: the square the four leg
// centres stand on, and how wide each leg is there. Nothing that has fallen may end up inside one
// of the three legs the hit left standing -- that is iron the map still draws, and a piece resting
// eleven metres inside the legs is the defect this reproduces.
const FIRST_DECK_METRES = 57.63;
const SPREAD = Object.freeze([
    [0, 62.5], [10, 55], [20, 48], [30, 42.5], [40, 38], [50, 34.3], [57.63, 32.5], [70, 27.4],
    [85, 22.4], [100, 18.2], [115.73, 15], [140, 12.3], [170, 10], [196, 8.6], [230, 7],
    [276.1, 5.6], [300, 3.2], [330, 0.4],
]);
const LEG_WIDTH = Object.freeze([[0, 26], [57.63, 12], [115.73, 6], [196, 2.6], [276.1, 1.3]]);
// A couple of centimetres of slack for the float round trip through the GLB samplers.
const SILHOUETTE_SLACK_METRES = 0.05;

function interpolate(table, height) {
    if (height <= table[0][0]) return table[0][1];
    if (height >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let index = 0; index < table.length - 1; index += 1) {
        const [lowHeight, lowValue] = table[index];
        const [highHeight, highValue] = table[index + 1];
        if (height >= lowHeight && height <= highHeight) {
            const span = highHeight - lowHeight;
            const ratio = span <= 0 ? 0 : (height - lowHeight) / span;
            return lowValue + (highValue - lowValue) * ratio;
        }
    }
    return table[table.length - 1][1];
}

// Where each piece's rig empty stands in the rest pose, in tower metres above the esplanade. These
// are the joints the tower is cut at, so a piece that moved would also move its own break line.
const PIECE_FEET = Object.freeze({ lower: 0, mid: 60.03, shaft: 117.93, summit: 276.1 });

// The antenna tip, and how much of it any scene that still carries the summit has to show.
const TIP_METRES = 330.0;

// A falling tower is drawn from the same buffers as the standing one, so the whole set of parts a
// scene replaces has to fit in one file. 20_topple_lower carries seven of the eight intact parts.
const TRIANGLE_BUDGET = 40_000;
// Four rig empties plus one mesh per material the pieces use. Joined per material is the point:
// the lattice is thousands of members and must not export as thousands of draw calls.
// Two joined render-only fracture clusters per scene add two mesh nodes beneath the existing rigs.
const NODE_BUDGET = 30;
// The whole pack, so a future scene cannot quietly double the download.
// Measured pack size after the eight small animated clusters is 4,934,104 bytes; keep under 1%
// headroom rather than granting enough room for another large authored variant.
const TOTAL_GLB_BUDGET_BYTES = 4.75 * 1024 * 1024;

function glbPath(fileStem) {
    return path.join(ASSET_ROOT, 'glb', `${fileStem}.glb`);
}

function readGlb(fileStem) {
    const bytes = readFileSync(glbPath(fileStem));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${fileStem} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${fileStem} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${fileStem} starts with a JSON chunk`);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    // The binary chunk follows the JSON one, behind its own eight byte header.
    return { document, binary: bytes.subarray(20 + jsonLength + 8) };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One element of a float accessor, as a plain array. */
function readAccessorElement({ document, binary }, accessorIndex, element) {
    const accessor = document.accessors[accessorIndex];
    assert.equal(accessor.componentType, 5126, 'animation samplers are stored as floats');
    const view = document.bufferViews[accessor.bufferView];
    const size = COMPONENTS[accessor.type];
    const stride = view.byteStride || size * 4;
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + element * stride;
    return Array.from({ length: size }, (_, index) => binary.readFloatLE(offset + index * 4));
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
    return names;
}

function meshNodeNames(document) {
    return (document.nodes || [])
        .filter((node) => node.mesh !== undefined)
        .map((node) => String(node.name || ''));
}

function triangleCount(document) {
    let total = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const indices = document.accessors?.[primitive.indices];
            if (indices) total += Math.trunc(indices.count / 3);
        }
    }
    return total;
}

/** Bounding box of the rest pose, with every node transform applied. */
function restBounds(document) {
    const bounds = new THREE.Box3().makeEmpty();
    const visit = (nodeIndex, parentMatrix) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        const local = new THREE.Matrix4().compose(
            new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
            new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
            new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
        );
        const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
        if (node.mesh !== undefined) {
            for (const primitive of document.meshes?.[node.mesh]?.primitives || []) {
                const accessor = document.accessors?.[primitive.attributes?.POSITION];
                if (!accessor?.min || !accessor?.max) continue;
                bounds.union(new THREE.Box3(
                    new THREE.Vector3().fromArray(accessor.min),
                    new THREE.Vector3().fromArray(accessor.max),
                ).applyMatrix4(world));
            }
        }
        for (const child of node.children || []) visit(child, world);
    };
    for (const nodeIndex of document.scenes?.[document.scene || 0]?.nodes || []) {
        visit(nodeIndex, new THREE.Matrix4());
    }
    return bounds;
}

test('every part of the pack keeps an editable Blender source and a non-empty GLB', () => {
    let total = 0;
    for (const fileStem of [...Object.keys(SCENES), WIDE_ESPLANADE]) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${fileStem}.blend`);
        assert.ok(statSync(blendPath).size > 100_000, `${fileStem} keeps an editable Blender source`);
        const bytes = statSync(glbPath(fileStem)).size;
        assert.ok(bytes > 2_000, `${fileStem} exports a non-empty GLB`);
        total += bytes;
    }
    assert.ok(
        total <= TOTAL_GLB_BUDGET_BYTES,
        `the siege pack totals ${(total / 1024 / 1024).toFixed(2)} MB, over budget`,
    );
});

test('the widened Champ-de-Mars reaches past the furthest wreck and stays static', () => {
    const { document } = readGlb(WIDE_ESPLANADE);
    // It is ground, not a break scene: nothing about it moves, so it keeps ordinary baked
    // collision instead of the per-mesh dynamic colliders the falling pieces need.
    assert.equal(document.animations?.length ?? 0, 0, 'the esplanade is static ground');
    // The same budgets the intact static tower parts are held to.
    assert.ok(triangleCount(document) <= 18_000, `the wide esplanade spends ${triangleCount(document)} triangles`);
    assert.ok((document.nodes || []).length <= 12, 'the wide esplanade exports as joined meshes');

    const bounds = restBounds(document);
    const centre = bounds.getCenter(new THREE.Vector3());
    assert.ok(
        Math.abs(centre.x) < 0.05 && Math.abs(centre.z) < 0.05,
        'the wide esplanade centres on the tower axis',
    );
    // Same thickness as the lawn it replaces, so it is placed at the same height.
    assert.ok(
        Math.abs(bounds.min.y + 1.5) < 0.05,
        `the wide esplanade sits at ${bounds.min.y.toFixed(2)} m, expected -1.5`,
    );
    // ...and this is the whole reason the part exists. The reach is measured off the four clips
    // rather than written down here: a constant that drifted away from the assets would size the
    // lawn, and through the preset the whole field, for a collapse that no longer happens.
    const reach = wreckReachMetres();
    for (const axis of ['x', 'z']) {
        assert.ok(
            Math.min(-bounds.min[axis], bounds.max[axis]) > reach,
            `the lawn reaches ${bounds.max[axis].toFixed(0)} m in ${axis}, `
            + `short of the wreck at ${reach.toFixed(1)} m`,
        );
    }
});

test('each scene is one named one-shot clip of a plausible length', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const { document } = readGlb(fileStem);
        assert.equal(document.animations?.length, 1, `${fileStem} has exactly one clip`);
        const [animation] = document.animations;
        assert.equal(animation.name, expected.clip, `${fileStem} carries the clip the map addresses`);
        const duration = animationDurationSeconds(document, animation);
        // A tower this size cannot come down in a second, and a clip that outlasts a round is not
        // a collapse any more. Both ends of this range are a statement about the physics, not a
        // rounding tolerance.
        assert.ok(
            duration >= 8 && duration <= 60,
            `${fileStem} falls for ${duration.toFixed(1)}s, outside 8..60s`,
        );
    }
});

test('every mesh of a break scene belongs to a piece and is moved by the clip', () => {
    // This is the rule that decides whether the collapse can hit anybody. The runtime gives a
    // dynamic collider to any mesh an animation moves, and a mesh the clip leaves alone would keep
    // a baked collider standing in the air after the tower it belonged to has fallen away.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const { document } = readGlb(fileStem);
        const meshes = meshNodeNames(document);
        assert.ok(meshes.length > 0, `${fileStem} draws something`);
        const moved = animatedMeshNodeNames(document);
        for (const name of meshes) {
            assert.match(name, /^piece_(lower|mid|shaft|summit)_/, `${name} belongs to a piece`);
            assert.ok(moved.has(name), `${name} is moved by the clip`);
            if (!name.includes('_nocol')) {
                assert.ok(moved.has(name), `${name} is moved by the clip, so it can carry a collider`);
            }
        }

        const roots = (document.scenes[document.scene || 0].nodes || [])
            .map((index) => String(document.nodes[index].name || ''));
        assert.deepEqual(
            [...roots].sort(),
            expected.pieces.map((piece) => `piece_${piece}`).sort(),
            `${fileStem} drops exactly the pieces above its break`,
        );
    }
});

test('each collapse adds two deterministic visual-only fracture clusters at its initiating break', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const glb = readGlb(fileStem);
        const { document } = glb;
        const [animation] = document.animations;
        const parents = new Map();
        for (const [parentIndex, parent] of (document.nodes || []).entries()) {
            for (const child of parent.children || []) parents.set(child, parentIndex);
        }
        const clusters = (document.nodes || []).map((node, index) => ({ node, index }))
            .filter(({ node }) => /_fracture_[01]_nocol_noshadow$/i.test(String(node.name || '')));
        assert.equal(clusters.length, 2, `${fileStem} has exactly two fracture clusters`);
        const trajectories = [];
        for (const { node, index } of clusters) {
            const name = String(node.name || '');
            assert.match(name, new RegExp(`^piece_${expected.pieces[0]}_`), `${name} belongs to the initiating piece`);
            assert.equal(document.nodes[parents.get(index)]?.name, `piece_${expected.pieces[0]}`,
                `${name} stays under the root whose chained break hides it`);
            assert.ok(name.includes('_nocol') && name.includes('_noshadow'), `${name} is render-only`);
            assert.notEqual(node.mesh, undefined, `${name} has joined low-poly geometry`);
            const channels = new Map(animation.channels
                .filter((channel) => channel.target.node === index)
                .map((channel) => [channel.target.path, animation.samplers[channel.sampler]]));
            assert.deepEqual([...channels.keys()].sort(), ['rotation', 'scale', 'translation'],
                `${name} keys a complete visual transform`);
            const scale = channels.get('scale');
            const translation = channels.get('translation');
            const rotation = channels.get('rotation');
            const firstScale = readAccessorElement(glb, scale.output, 0);
            assert.deepEqual(firstScale, [0, 0, 0], `${name} begins hidden at frame 1`);
            const lastScale = readAccessorElement(glb, scale.output,
                document.accessors[scale.output].count - 1);
            assert.deepEqual(lastScale, [0, 0, 0], `${name} is hidden before the clip ends`);
            const positions = Array.from({ length: document.accessors[translation.output].count }, (_, frame) => (
                readAccessorElement(glb, translation.output, frame)
            ));
            const rotations = Array.from({ length: document.accessors[rotation.output].count }, (_, frame) => (
                readAccessorElement(glb, rotation.output, frame)
            ));
            assert.ok(positions.some((value, frame) => frame > 0
                && new THREE.Vector3().fromArray(value).distanceTo(new THREE.Vector3().fromArray(positions[0])) > 0.2),
            `${name} visibly leaves its authored break line`);
            for (let frame = 1; frame < positions.length; frame += 1) {
                assert.ok(
                    new THREE.Vector3().fromArray(positions[frame]).distanceTo(
                        new THREE.Vector3().fromArray(positions[frame - 1]),
                    ) < 1.0,
                    `${name} has a continuous analytic arc at frame ${frame}`,
                );
            }
            assert.ok(Math.abs(positions[0][2]) < 1.1, `${name} starts on the authored break line`);
            assert.ok(positions.every((value) => new THREE.Vector3().fromArray(value).length() < 16),
                `${name} remains in its small visual debris envelope`);
            assert.ok(rotations.some((value, frame) => frame > 0 && value.some(
                (component, componentIndex) => Math.abs(component - rotations[0][componentIndex]) > 1e-4,
            )), `${name} actually rotates during its arc`);
            trajectories.push({ name, positions, rotations });
        }
        const tracksDiffer = (left, right) => left.length !== right.length || left.some(
            (sample, sampleIndex) => sample.some(
                (component, componentIndex) => Math.abs(component - right[sampleIndex][componentIndex]) > 1e-4,
            ),
        );
        assert.ok(tracksDiffer(trajectories[0].positions, trajectories[1].positions),
            `${fileStem} fracture clusters have distinct translation samples`);
        assert.ok(tracksDiffer(trajectories[0].rotations, trajectories[1].rotations),
            `${fileStem} fracture clusters have distinct rotation samples`);
    }
});

test('a break scene stays inside the triangle and node budgets of the parts it replaces', () => {
    for (const fileStem of Object.keys(SCENES)) {
        const { document } = readGlb(fileStem);
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET,
            `${fileStem} spends ${triangleCount(document)} triangles`,
        );
        assert.ok(
            (document.nodes || []).length <= NODE_BUDGET,
            `${fileStem} exports ${document.nodes.length} nodes`,
        );
    }
});

test('frame 1 of every break scene is the tower standing where the intact parts stand', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const glb = readGlb(fileStem);
        const { document } = glb;
        const nodesByName = new Map((document.nodes || []).map((node) => [node.name, node]));

        // Each piece's rig empty starts at the joint it will turn on, with no rotation at all: the
        // preset applies the fall direction by turning the whole slot, so any lean authored into
        // the rest pose would be added to it.
        for (const piece of expected.pieces) {
            const node = nodesByName.get(`piece_${piece}`);
            assert.ok(node, `${fileStem} has a rig for ${piece}`);
            assert.deepEqual(
                node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1],
                `piece_${piece} starts unturned in ${fileStem}`,
            );
            const [x, height, z] = node.translation || [0, 0, 0];
            assert.ok(
                Math.abs(x) < 1e-3 && Math.abs(z) < 1e-3,
                `piece_${piece} stands on the tower axis in ${fileStem}`,
            );
            assert.ok(
                Math.abs(height - PIECE_FEET[piece]) < 0.01,
                `piece_${piece} stands at ${height.toFixed(2)} m, expected ${PIECE_FEET[piece]}`,
            );
        }

        // ...and the clip itself opens on that pose rather than jumping to it.
        const [animation] = document.animations;
        for (const channel of animation.channels) {
            const target = String(document.nodes[channel.target.node].name || '');
            if (!expected.pieces.includes(target.replace('piece_', ''))) continue;
            const sampler = animation.samplers[channel.sampler];
            const first = readAccessorElement(glb, sampler.output, 0);
            const rest = channel.target.path === 'rotation'
                ? (nodesByName.get(target).rotation ?? [0, 0, 0, 1])
                : (nodesByName.get(target).translation ?? [0, 0, 0]);
            for (let index = 0; index < first.length; index += 1) {
                assert.ok(
                    Math.abs(first[index] - rest[index]) < 1e-3,
                    `${target} ${channel.target.path} in ${fileStem} starts at the rest pose`,
                );
            }
        }
    }
});

/** Every piece rig's sampler tracks, keyed by rig name: { node, translation, rotation }. */
function pieceTracks({ document }) {
    const roots = new Set(document.scenes[document.scene || 0].nodes || []);
    const tracks = new Map();
    const [animation] = document.animations;
    for (const channel of animation.channels) {
        if (!roots.has(channel.target.node)) continue;
        const node = document.nodes[channel.target.node];
        if (!tracks.has(node.name)) tracks.set(node.name, { node });
        tracks.get(node.name)[channel.target.path] = animation.samplers[channel.sampler];
    }
    return tracks;
}

/** The rig's pose at one keyframe, falling back to the node's own rest transform. */
function poseAt(glb, track, frame) {
    const { document } = glb;
    const translation = track.translation
        ? readAccessorElement(glb, track.translation.output, frame)
        : (track.node.translation || [0, 0, 0]);
    const rotation = track.rotation
        ? readAccessorElement(glb, track.rotation.output, frame)
        : (track.node.rotation || [0, 0, 0, 1]);
    void document;
    return new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(translation),
        new THREE.Quaternion().fromArray(rotation).normalize(),
        new THREE.Vector3(1, 1, 1),
    );
}

function nodeMatrix(node) {
    return new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
    );
}

/** Every vertex under a rig, in the rig's own frame. */
function pieceVertices({ document, binary }, node) {
    const points = [];
    const visit = (index, parent) => {
        const child = document.nodes[index];
        const world = parent.clone().multiply(nodeMatrix(child));
        if (child.mesh !== undefined) {
            // A fracture chip is an animated child but never part of the physical tower.  It must
            // not inflate the wreck reach or make the tower look buried in this physical check.
            if (String(child.name || '').toLowerCase().includes('_nocol')) return;
            for (const primitive of document.meshes[child.mesh].primitives) {
                const accessor = document.accessors[primitive.attributes.POSITION];
                const view = document.bufferViews[accessor.bufferView];
                const stride = view.byteStride || 12;
                const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
                for (let i = 0; i < accessor.count; i += 1) {
                    points.push(new THREE.Vector3(
                        binary.readFloatLE(base + i * stride),
                        binary.readFloatLE(base + i * stride + 4),
                        binary.readFloatLE(base + i * stride + 8),
                    ).applyMatrix4(world));
                }
            }
        }
        for (const grandchild of child.children || []) visit(grandchild, world);
    };
    for (const child of node.children || []) visit(child, new THREE.Matrix4());
    return points;
}

/** How many keyframes the clip of a scene has. */
function frameCount({ document }) {
    const [animation] = document.animations;
    return document.accessors[animation.samplers[animation.channels[0].sampler].input].count;
}

/**
 * One piece's clip, read out of the samplers: the per-frame steps, the total turn, the final pose
 * and every authored vertex put through it.
 */
function pieceMotion(glb, track) {
    const frames = frameCount(glb);
    const steps = [];
    let swept = 0;
    let previousPosition = null;
    let previousRotation = null;
    let lastMovingFrame = 0;
    for (let frame = 0; frame < frames; frame += 1) {
        const pose = poseAt(glb, track, frame);
        const position = new THREE.Vector3().setFromMatrixPosition(pose);
        const rotation = new THREE.Quaternion().setFromRotationMatrix(pose);
        if (previousPosition) {
            const moved = position.distanceTo(previousPosition);
            const turned = THREE.MathUtils.radToDeg(previousRotation.angleTo(rotation));
            steps.push({ frame, moved, turned });
            swept += turned;
            if (moved > REST_STEP_METRES || turned > REST_STEP_DEGREES) lastMovingFrame = frame;
        }
        previousPosition = position;
        previousRotation = rotation;
    }
    const last = poseAt(glb, track, frames - 1);
    const at = new THREE.Vector3();
    const rest = pieceVertices(glb, track.node).map((point) => at.copy(point).applyMatrix4(last).clone());
    return {
        frames,
        steps,
        swept,
        lastMovingFrame,
        upright: THREE.MathUtils.radToDeg(
            new THREE.Quaternion().setFromRotationMatrix(last).angleTo(new THREE.Quaternion()),
        ),
        rest,
    };
}

/** Every piece of every scene, with its clip already measured. Read once; the files are large. */
const MOTION_CACHE = new Map();
function sceneMotion(fileStem) {
    if (!MOTION_CACHE.has(fileStem)) {
        const glb = readGlb(fileStem);
        MOTION_CACHE.set(fileStem, new Map(
            [...pieceTracks(glb)].map(([name, track]) => [name, pieceMotion(glb, track)]),
        ));
    }
    return MOTION_CACHE.get(fileStem);
}

/**
 * How far the furthest piece of any collapse settles from the tower axis, in metres, measured off
 * the files. Scenes 20 and 21 are only ever turned onto one of the four legs, so the map sees
 * their footprint square on and what counts is the largest |x| or |z|; 22 and 23 follow the shot
 * that felled them and may be yawed to any angle, so what counts there is the radius.
 */
const SQUARE_REACH_SCENES = new Set(['20_topple_lower', '21_topple_mid']);
let measuredReach = null;
function wreckReachMetres() {
    if (measuredReach === null) {
        measuredReach = 0;
        for (const fileStem of Object.keys(SCENES)) {
            const square = SQUARE_REACH_SCENES.has(fileStem);
            for (const motion of sceneMotion(fileStem).values()) {
                for (const point of motion.rest) {
                    measuredReach = Math.max(measuredReach, square
                        ? Math.max(Math.abs(point.x), Math.abs(point.z))
                        : Math.hypot(point.x, point.z));
                }
            }
        }
    }
    return measuredReach;
}

test('a collapse moves by falling, never by jumping', () => {
    // The two ways the motion stops being a fall. A piece that crosses forty metres in a frame has
    // been placed rather than integrated, and a piece that turns ten degrees in a frame is
    // snapping to a pose. Both were true of the pass this replaces; both are read straight off the
    // exported samplers here, because that is the only thing the runtime ever sees.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const motions = sceneMotion(fileStem);
        assert.equal(motions.size, expected.pieces.length, `${fileStem} keys every piece rig`);
        for (const [name, motion] of motions) {
            const worstMove = motion.steps.reduce((a, b) => (a.moved > b.moved ? a : b));
            const worstTurn = motion.steps.reduce((a, b) => (a.turned > b.turned ? a : b));
            assert.ok(
                worstMove.moved <= MAX_STEP_METRES,
                `${name} in ${fileStem} crosses ${worstMove.moved.toFixed(1)} m `
                + `in one frame at ${worstMove.frame}`,
            );
            assert.ok(
                worstTurn.turned <= MAX_STEP_DEGREES,
                `${name} in ${fileStem} turns ${worstTurn.turned.toFixed(1)} deg `
                + `in one frame at ${worstTurn.frame}`,
            );
            // Unwrapped total rotation: the angle between consecutive keys, summed. Reading it off
            // the first and last pose instead would call a piece that turned a full revolution
            // motionless.
            assert.ok(
                motion.swept <= TUMBLE_LIMIT_DEGREES,
                `${name} in ${fileStem} turns ${motion.swept.toFixed(0)} deg over its clip`,
            );
        }
    }
});

test('every collapse comes to a real stop, and is held there before it ends', () => {
    // A clip that ends the moment the last piece stops leaves a 200 m piece travelling at ten
    // metres a second in its final frame; a clip whose rest is really a slow slide freezes
    // mid-slide. So both halves are asserted: nothing moves over the last thirty frames, and the
    // last frame that did move is at least thirty frames before the end.
    for (const fileStem of Object.keys(SCENES)) {
        for (const [name, motion] of sceneMotion(fileStem)) {
            for (const step of motion.steps.slice(-REST_FRAMES)) {
                assert.ok(
                    step.moved <= REST_STEP_METRES && step.turned <= REST_STEP_DEGREES,
                    `${name} in ${fileStem} still moves ${step.moved.toFixed(3)} m / `
                    + `${step.turned.toFixed(2)} deg at frame ${step.frame}`,
                );
            }
            assert.ok(
                motion.lastMovingFrame <= motion.frames - 1 - REST_FRAMES,
                `${name} in ${fileStem} last moves at frame ${motion.lastMovingFrame} `
                + `of ${motion.frames}, too close to the end`,
            );
        }
    }
});

test('no piece finishes standing on its own foot', () => {
    // The pose a collapse must never end in is the pose it started in. Measured as the angle of
    // the final rotation quaternion from identity, so a piece that turned a full revolution and
    // came back is caught as well as one that never turned at all.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        for (const [name, motion] of sceneMotion(fileStem)) {
            if (fileStem === STUMP.scene && name === STUMP.piece) {
                // The stump never leaves the ground: it sags onto its crushed corner and stays
                // there. What it may not do is stand up straight again.
                assert.ok(
                    motion.upright > 5,
                    `the stump of ${fileStem} ends ${motion.upright.toFixed(1)} deg off upright`,
                );
                continue;
            }
            assert.ok(
                motion.upright > UPRIGHT_MARGIN_DEGREES,
                `${name} in ${fileStem} ends ${motion.upright.toFixed(1)} deg off upright, `
                + `standing on its foot`,
            );
        }
        assert.ok(expected.pieces.length > 0);
    }
});

test('a landed piece lies on the ground rather than in it', () => {
    // The exact claim: every authored vertex of the piece, put through the rig's final keyframe.
    // Not the bounding box -- the box of a rotated box hangs far below the iron it stands for, and
    // would have to be given metres of slack.
    for (const [fileStem] of Object.entries(SCENES)) {
        for (const [name, motion] of sceneMotion(fileStem)) {
            const lowest = motion.rest.reduce((low, point) => Math.min(low, point.y), Infinity);
            const limit = fileStem === STUMP.scene && name === STUMP.piece
                ? CRUSHED_BURIAL_LIMIT_METRES
                : BURIAL_LIMIT_METRES;
            assert.ok(
                lowest >= -limit,
                `${name} in ${fileStem} ends ${(-lowest).toFixed(2)} m under the esplanade`,
            );
        }
    }
});

test('nothing comes to rest inside a leg that is still standing', () => {
    // 21, 22 and 23 leave the tower below the break standing, and the map still draws it, so a
    // piece that settled inside those legs would be drawn through iron that is still there. The
    // pass this replaces finished eleven metres inside them, in every direction, because its ground
    // model was a height field that knew about galleries and nothing else.
    //
    // Three of the four legs, not four. A tower whose upper half topples off a sixty metre pedestal
    // cannot leave that pedestal's footprint clear -- the stack is as wide at its foot as the thing
    // it is standing on -- and the quarter it comes down through is exactly the quarter the hit
    // destroyed and the generator models as gone. What must stay clear is the iron that is still
    // carrying the tower: the north-east leg is rubble, the other three are not.
    //
    // "Inside a leg" rather than "inside the silhouette": on this tower the openings between the
    // members are the level, and the space between the legs is air the map already flies through.
    for (const fileStem of Object.keys(SCENES)) {
        if (fileStem === '20_topple_lower') continue;  // nothing is left standing
        for (const [name, motion] of sceneMotion(fileStem)) {
            for (const point of motion.rest) {
                if (point.y >= FIRST_DECK_METRES) continue;
                // The exported file is Y-up, so the struck north-east corner is +x / -z here.
                if (point.x >= 0 && point.z <= 0) continue;
                const height = Math.max(0, point.y);
                const centre = interpolate(SPREAD, height);
                const half = interpolate(LEG_WIDTH, height) / 2 - SILHOUETTE_SLACK_METRES;
                const insideLeg = Math.abs(Math.abs(point.x) - centre) < half
                    && Math.abs(Math.abs(point.z) - centre) < half;
                assert.ok(
                    !insideLeg,
                    `${name} in ${fileStem} rests at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, `
                    + `${point.z.toFixed(1)}), inside a leg that is still standing`,
                );
            }
        }
    }
});

test('a break scene measures exactly like the intact parts it is swapped for', () => {
    // The loader places a model by its own bounding box: the footprint centre in X and Z, the
    // underside in Y. Get these wrong and the falling tower appears offset from the standing one
    // at the moment it is triggered, which is the one moment the player is looking straight at it.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const bounds = restBounds(readGlb(fileStem).document);
        const centre = bounds.getCenter(new THREE.Vector3());
        assert.ok(
            Math.abs(centre.x) < 0.05 && Math.abs(centre.z) < 0.05,
            `${fileStem} centres on the tower axis`,
        );
        assert.ok(
            Math.abs(bounds.min.y - expected.baseMetres) < 0.05,
            `${fileStem} sits at ${bounds.min.y.toFixed(2)} m, expected ${expected.baseMetres}`,
        );
        // Every scene carries the summit, so every one of them reaches the antenna tip.
        assert.ok(
            Math.abs(bounds.max.y - TIP_METRES) < 0.2,
            `${fileStem} reaches ${bounds.max.y.toFixed(2)} m, expected the ${TIP_METRES} m tip`,
        );
    }
});
