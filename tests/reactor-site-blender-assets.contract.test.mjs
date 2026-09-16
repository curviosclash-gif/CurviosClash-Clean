import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

// The Blender pack of the reactor site: five standing parts, four baked collapses and one keyed
// mushroom cloud. This file reads the GLBs directly rather than through the map catalog; it is
// the half of the contract between scripts/generate_reactor_site_assets.py and the preset that
// the preset depends on: which pieces a scene contains, which clip the runtime addresses by name,
// that frame 1 of every scene is the structure standing exactly where the intact part stands,
// and that what comes down really comes down - falls rather than jumps, stops rather than
// slides, lies on the apron rather than in it, and never ends standing on its own foot.
//
// Every number in here is either read off the files or comes out of the generator's report,
// and says so.
const ASSET_ROOT = path.resolve('assets/maps/reactor_site');

// The five scenes, with the pieces each one drops and the underside the intact part it replaces
// reports (`base_y` in the generator's report). Those heights are what the preset places by.
const SCENES = Object.freeze({
    '20_topple_tower_west': {
        clip: 'ToppleTowerWestOnce',
        pieces: ['tower_w_shell', 'tower_w_debris'],
        intact: '04_cooling_tower',
        baseMetres: -0.36,   // the splayed inlet columns overhang their feet
        simulated: ['tower_w_shell'],
        keyed: ['tower_w_debris'],
    },
    '21_topple_tower_east': {
        clip: 'ToppleTowerEastOnce',
        pieces: ['tower_e_shell', 'tower_e_debris'],
        intact: '04_cooling_tower',
        baseMetres: -0.36,
        simulated: ['tower_e_shell'],
        keyed: ['tower_e_debris'],
    },
    '22_topple_stack': {
        clip: 'ToppleStackOnce',
        pieces: ['stack_lower', 'stack_upper'],
        intact: '05_vent_stack',
        baseMetres: 0.0,
        simulated: ['stack_lower', 'stack_upper'],
        keyed: [],
    },
    '23_collapse_hall': {
        clip: 'CollapseHallOnce',
        pieces: ['hall_roof', 'hall_wall_n', 'hall_wall_s', 'hall_gable_w', 'hall_gable_e'],
        intact: '02_turbine_hall',
        baseMetres: 0.0,
        simulated: ['hall_roof', 'hall_wall_n', 'hall_wall_s', 'hall_gable_w', 'hall_gable_e'],
        keyed: [],
    },
});
const CLOUD = Object.freeze({
    stem: '30_mushroom_cloud',
    clip: 'MushroomCloudOnce',
    piece: 'reactor',
    intact: '03_reactor_block',
    baseMetres: 0.0,
    // The rigs under piece_reactor, and whether their meshes may collide.
    rigs: Object.freeze({ ruin: true, fire: false, cap: false, stem: false, ring: false }),
    // Out of the generator: CLOUD_SECONDS + CLOUD_HOLD_SECONDS, CLOUD_CAP_RADIUS, CLOUD_CAP_TOP.
    seconds: 49,
    capRadius: 115,
    capTop: 300,
    fireballGoneSeconds: 4.4,
});
const STATIC_PARTS = Object.freeze(['01_site', '02_turbine_hall', '03_reactor_block', '04_cooling_tower', '05_vent_stack']);

// Where the towers stand and how far the site's grass reaches, out of the generator.
const TOWER_OFFSET_METRES = 105;
// The furthest any piece settles from its structure's axis: the tower shell, as the generator
// reports it. The preset sizes the field off this number; here it is measured off the file.
const REPORTED_TOWER_REACH_METRES = 115.2;

// The most any one piece may turn over a whole clip. A hall wall turns a right angle, the stack's
// top a little more; nothing rolls away across the apron.
const TUMBLE_LIMIT_DEGREES = 200;
// The two ways a clip stops being a fall and starts being a teleport, measured between one frame
// and the next. The tallest structure here is 100 m; its rim hits at under 45 m/s.
const MAX_STEP_METRES = 3.0;
const MAX_STEP_DEGREES = 6.0;
// Rest: per frame, and how long it has to hold before the clip may end.
const REST_STEP_METRES = 0.05;
const REST_STEP_DEGREES = 0.5;
const REST_FRAMES = 30;
// Everything that falls has to end well off upright...
const UPRIGHT_MARGIN_DEGREES = 45;
// ...except the hall's roof, which drops and pancakes: level, on the floor.
const ROOF = Object.freeze({ scene: '23_collapse_hall', piece: 'hall_roof', levelDegrees: 3 });
// How far below the apron a piece may be drawn once it has come to rest. The proxies are hulls
// of the drawn geometry minus the footing the hit took away, so a wall lying on its cut footing
// has that wedge under the apron; the hall's is 3 m deep and the stack's cut 6 m.
const BURIAL_LIMIT_METRES = 4.0;
// The hall walls and the stack land on ground the site draws; the tower shell keels well outside
// the basin. Nothing may come to rest inside the intact structure it fell from: the stack's stump
// stays clear of its own foot's silhouette, the hall's roof of its walls.
// A scene is drawn from the same buffers as the part it replaces, one mesh per material per
// piece: the hall's five pieces in three materials are the most nodes any scene needs.
const TRIANGLE_BUDGET = 8_000;
const NODE_BUDGET = 24;
const TOTAL_GLB_BUDGET_BYTES = 2.5 * 1024 * 1024;

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
    return { document, binary: bytes.subarray(20 + jsonLength + 8) };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

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

/** Names of every mesh a keyframed transform moves; a rig empty moves the meshes below it. */
function animatedMeshNodeNames(document) {
    const nodes = document.nodes || [];
    const names = new Set();
    const collect = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(node.name);
        for (const child of node.children || []) collect(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (!['translation', 'rotation', 'scale'].includes(channel.target?.path)) continue;
            collect(channel.target.node);
        }
    }
    return names;
}

function meshNodeNames(document) {
    return (document.nodes || []).filter((node) => node.mesh !== undefined).map((node) => String(node.name || ''));
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

function rootNodeNames(document) {
    return (document.scenes[document.scene || 0].nodes || []).map((index) => String(document.nodes[index].name || ''));
}

/** Every node's sampler tracks, keyed by name: { node, translation?, rotation?, scale? }. */
function nodeTracks({ document }) {
    const tracks = new Map();
    const [animation] = document.animations;
    for (const channel of animation.channels) {
        const node = document.nodes[channel.target.node];
        if (!tracks.has(node.name)) tracks.set(node.name, { node });
        tracks.get(node.name)[channel.target.path] = animation.samplers[channel.sampler];
    }
    return tracks;
}

function frameCount({ document }) {
    const [animation] = document.animations;
    return document.accessors[animation.samplers[animation.channels[0].sampler].input].count;
}

/** The node's local pose at one keyframe, falling back to its rest transform. */
function poseAt(glb, track, frame) {
    const translation = track.translation
        ? readAccessorElement(glb, track.translation.output, frame)
        : (track.node.translation || [0, 0, 0]);
    const rotation = track.rotation
        ? readAccessorElement(glb, track.rotation.output, frame)
        : (track.node.rotation || [0, 0, 0, 1]);
    const scale = track.scale
        ? readAccessorElement(glb, track.scale.output, frame)
        : (track.node.scale || [1, 1, 1]);
    return { translation, rotation, scale };
}

function poseMatrix(pose) {
    return new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(pose.translation),
        new THREE.Quaternion().fromArray(pose.rotation).normalize(),
        new THREE.Vector3().fromArray(pose.scale),
    );
}

/** Every vertex under a node, in the node's own frame (children's transforms applied). */
function subtreeVertices({ document, binary }, node) {
    const points = [];
    const visit = (index, parentMatrix) => {
        const child = document.nodes[index];
        const local = new THREE.Matrix4().compose(
            new THREE.Vector3().fromArray(child.translation || [0, 0, 0]),
            new THREE.Quaternion().fromArray(child.rotation || [0, 0, 0, 1]),
            new THREE.Vector3().fromArray(child.scale || [1, 1, 1]),
        );
        const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
        if (child.mesh !== undefined) {
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

/** One rig's clip, read out of the samplers: per-frame steps, total turn, final pose, rest vertices. */
function pieceMotion(glb, track) {
    const frames = frameCount(glb);
    const steps = [];
    let swept = 0;
    let previousPosition = null;
    let previousRotation = null;
    let lastMovingFrame = 0;
    for (let frame = 0; frame < frames; frame += 1) {
        const pose = poseAt(glb, track, frame);
        const position = new THREE.Vector3().fromArray(pose.translation);
        const rotation = new THREE.Quaternion().fromArray(pose.rotation).normalize();
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
    const last = poseMatrix(poseAt(glb, track, frames - 1));
    const rest = subtreeVertices(glb, track.node).map((point) => point.applyMatrix4(last));
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

const MOTION_CACHE = new Map();
function sceneMotion(fileStem) {
    if (!MOTION_CACHE.has(fileStem)) {
        const glb = readGlb(fileStem);
        const roots = new Set(rootNodeNames(glb.document));
        MOTION_CACHE.set(fileStem, new Map(
            [...nodeTracks(glb)].filter(([name]) => roots.has(name)).map(([name, track]) => [name, pieceMotion(glb, track)]),
        ));
    }
    return MOTION_CACHE.get(fileStem);
}

function towerReachMetres() {
    let reach = 0;
    for (const point of sceneMotion('20_topple_tower_west').get('piece_tower_w_shell').rest) {
        reach = Math.max(reach, Math.hypot(point.x, point.z));
    }
    return reach;
}

test('every part of the pack keeps an editable Blender source and a non-empty GLB', () => {
    let total = 0;
    for (const fileStem of [...STATIC_PARTS, ...Object.keys(SCENES), CLOUD.stem]) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${fileStem}.blend`);
        assert.ok(statSync(blendPath).size > 100_000, `${fileStem} keeps an editable Blender source`);
        const bytes = statSync(glbPath(fileStem)).size;
        assert.ok(bytes > 2_000, `${fileStem} exports a non-empty GLB`);
        total += bytes;
    }
    assert.ok(total <= TOTAL_GLB_BUDGET_BYTES, `the reactor pack totals ${(total / 1024 / 1024).toFixed(2)} MB, over budget`);
});

test('the site is static ground that reaches past the furthest wreck', () => {
    const { document } = readGlb('01_site');
    assert.equal(document.animations?.length ?? 0, 0, 'the site is static ground');
    assert.ok(triangleCount(document) <= 18_000, `the site spends ${triangleCount(document)} triangles`);
    const bounds = restBounds(document);
    const centre = bounds.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(centre.x) < 0.05 && Math.abs(centre.z) < 0.05, 'the site centres on the map origin');
    // The reach is measured off the tower clip rather than written down here: a constant that
    // drifted away from the file would size the grass, and through the preset the whole field,
    // for a collapse that no longer happens.
    const reach = TOWER_OFFSET_METRES + towerReachMetres();
    assert.ok(
        Math.min(-bounds.min.x, bounds.max.x) > reach,
        `the grass reaches ${bounds.max.x.toFixed(0)} m, short of the tower wreck at ${reach.toFixed(1)} m`,
    );

    const wallNode = (document.nodes || []).find((node) => node.name === 'site_blastwall');
    assert.ok(wallNode?.mesh !== undefined, 'the static site includes its irregular blast-wall compounds');
    const wallTriangles = (document.meshes?.[wallNode.mesh]?.primitives || []).reduce((total, primitive) => {
        const indices = document.accessors?.[primitive.indices];
        return total + (indices ? Math.trunc(indices.count / 3) : 0);
    }, 0);
    assert.ok(wallTriangles >= 250, `the compounds provide real cover, not one token wall (${wallTriangles} triangles)`);
});

test('the tower wreck reaches what the generator reported, and the preset states', () => {
    const reach = towerReachMetres();
    assert.ok(
        Math.abs(reach - REPORTED_TOWER_REACH_METRES) < 0.5,
        `the tower shell settles ${reach.toFixed(1)} m from its axis, the generator reported ${REPORTED_TOWER_REACH_METRES}`,
    );
});

test('each scene is one named one-shot clip of a plausible length', () => {
    for (const [fileStem, expected] of Object.entries({ ...SCENES, [CLOUD.stem]: { clip: CLOUD.clip } })) {
        const { document } = readGlb(fileStem);
        assert.equal(document.animations?.length, 1, `${fileStem} has exactly one clip`);
        const [animation] = document.animations;
        assert.equal(animation.name, expected.clip, `${fileStem} carries the clip the map addresses`);
        const duration = animationDurationSeconds(document, animation);
        assert.ok(duration >= 5 && duration <= 60, `${fileStem} runs ${duration.toFixed(1)}s, outside 5..60s`);
    }
    const cloud = readGlb(CLOUD.stem).document;
    assert.ok(
        Math.abs(animationDurationSeconds(cloud, cloud.animations[0]) - CLOUD.seconds) < 0.05,
        'the cloud runs for the keyed seconds plus the held second',
    );
});

test('every mesh of a collapse belongs to a piece and is moved by the clip', () => {
    // The runtime gives a dynamic collider to any mesh an animation moves, and a mesh the clip
    // leaves alone would keep a baked collider standing in the air after its structure has gone.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const { document } = readGlb(fileStem);
        const meshes = meshNodeNames(document);
        assert.ok(meshes.length > 0, `${fileStem} draws something`);
        const moved = animatedMeshNodeNames(document);
        for (const name of meshes) {
            assert.ok(
                expected.pieces.some((piece) => name.startsWith(`piece_${piece}_`)),
                `${name} in ${fileStem} belongs to a piece`,
            );
            assert.ok(moved.has(name), `${name} is moved by the clip, so it can carry a collider`);
        }
        assert.deepEqual(
            [...rootNodeNames(document)].sort(),
            expected.pieces.map((piece) => `piece_${piece}`).sort(),
            `${fileStem} drops exactly its own pieces`,
        );
    }
});

test('a scene stays inside the triangle and node budgets of the part it replaces', () => {
    for (const fileStem of [...Object.keys(SCENES), CLOUD.stem]) {
        const { document } = readGlb(fileStem);
        assert.ok(triangleCount(document) <= TRIANGLE_BUDGET, `${fileStem} spends ${triangleCount(document)} triangles`);
        assert.ok((document.nodes || []).length <= NODE_BUDGET, `${fileStem} exports ${document.nodes.length} nodes`);
    }
});

test('frame 1 of every collapse is the structure standing, and the clip opens on that pose', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const glb = readGlb(fileStem);
        const nodesByName = new Map((glb.document.nodes || []).map((node) => [node.name, node]));
        for (const piece of expected.pieces) {
            const node = nodesByName.get(`piece_${piece}`);
            assert.ok(node, `${fileStem} has a rig for ${piece}`);
            // A rig stands at its piece's centre of mass, unturned: the preset applies the fall
            // direction by turning the whole slot, so any lean authored here would be added to it.
            assert.deepEqual(node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1], `piece_${piece} starts unturned in ${fileStem}`);
            assert.deepEqual(node.scale ?? [1, 1, 1], [1, 1, 1], `piece_${piece} starts unscaled in ${fileStem}`);
        }
        const tracks = nodeTracks(glb);
        for (const piece of expected.pieces) {
            const track = tracks.get(`piece_${piece}`);
            assert.ok(track, `piece_${piece} is keyed in ${fileStem}`);
            const first = poseAt(glb, track, 0);
            const node = nodesByName.get(`piece_${piece}`);
            for (const [key, rest] of [['translation', node.translation || [0, 0, 0]], ['rotation', node.rotation || [0, 0, 0, 1]], ['scale', node.scale || [1, 1, 1]]]) {
                for (let index = 0; index < rest.length; index += 1) {
                    assert.ok(Math.abs(first[key][index] - rest[index]) < 1e-3, `${piece} ${key} in ${fileStem} starts at the rest pose`);
                }
            }
        }
    }
});

test('a collapse moves by falling, never by jumping', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const motions = sceneMotion(fileStem);
        for (const piece of expected.simulated) {
            const motion = motions.get(`piece_${piece}`);
            const worstMove = motion.steps.reduce((a, b) => (a.moved > b.moved ? a : b));
            const worstTurn = motion.steps.reduce((a, b) => (a.turned > b.turned ? a : b));
            assert.ok(worstMove.moved <= MAX_STEP_METRES, `${piece} in ${fileStem} crosses ${worstMove.moved.toFixed(2)} m in one frame at ${worstMove.frame}`);
            assert.ok(worstTurn.turned <= MAX_STEP_DEGREES, `${piece} in ${fileStem} turns ${worstTurn.turned.toFixed(2)} deg in one frame at ${worstTurn.frame}`);
            assert.ok(motion.swept <= TUMBLE_LIMIT_DEGREES, `${piece} in ${fileStem} turns ${motion.swept.toFixed(0)} deg over its clip`);
        }
    }
});

test('every collapse comes to a real stop, and is held there before it ends', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        for (const piece of expected.simulated) {
            const motion = sceneMotion(fileStem).get(`piece_${piece}`);
            for (const step of motion.steps.slice(-REST_FRAMES)) {
                assert.ok(step.moved <= REST_STEP_METRES && step.turned <= REST_STEP_DEGREES,
                    `${piece} in ${fileStem} still moves at frame ${step.frame}`);
            }
            assert.ok(motion.lastMovingFrame <= motion.frames - 1 - REST_FRAMES,
                `${piece} in ${fileStem} last moves at frame ${motion.lastMovingFrame} of ${motion.frames}, too close to the end`);
        }
    }
});

test('no piece finishes standing on its own foot, and the hall roof pancakes level', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        for (const piece of expected.simulated) {
            const motion = sceneMotion(fileStem).get(`piece_${piece}`);
            if (fileStem === ROOF.scene && piece === ROOF.piece) {
                assert.ok(motion.upright < ROOF.levelDegrees, `the roof ends ${motion.upright.toFixed(1)} deg off level`);
                const lowest = motion.rest.reduce((low, point) => Math.min(low, point.y), Infinity);
                assert.ok(Math.abs(lowest) < 0.3, `the roof lies at ${lowest.toFixed(2)} m, expected the floor`);
                continue;
            }
            assert.ok(motion.upright > UPRIGHT_MARGIN_DEGREES,
                `${piece} in ${fileStem} ends ${motion.upright.toFixed(1)} deg off upright, standing`);
        }
    }
});

test('a landed piece lies on the apron rather than in it', () => {
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        for (const piece of expected.simulated) {
            const motion = sceneMotion(fileStem).get(`piece_${piece}`);
            const lowest = motion.rest.reduce((low, point) => Math.min(low, point.y), Infinity);
            assert.ok(lowest >= -BURIAL_LIMIT_METRES, `${piece} in ${fileStem} ends ${(-lowest).toFixed(2)} m under the apron`);
        }
    }
});

test('the torn tower flank crumbles to the ground instead of falling', () => {
    // The debris is keyed, not simulated: it never moves off its spot, it only sinks. Its scale
    // in Y has to fall monotonically to a low band and hold; X and Z stay at one so the rubble
    // keeps the footprint the flank had.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        for (const piece of expected.keyed) {
            const glb = readGlb(fileStem);
            const track = nodeTracks(glb).get(`piece_${piece}`);
            assert.ok(track?.scale, `${piece} in ${fileStem} is keyed in scale`);
            assert.equal(track.translation, undefined, `${piece} in ${fileStem} does not travel`);
            const frames = frameCount(glb);
            let previous = Infinity;
            for (let frame = 0; frame < frames; frame += 1) {
                const [x, y, z] = readAccessorElement(glb, track.scale.output, frame);
                assert.ok(Math.abs(x - 1) < 1e-4 && Math.abs(z - 1) < 1e-4, `${piece} keeps its footprint at frame ${frame}`);
                assert.ok(y <= previous + 1e-6, `${piece} grows again at frame ${frame}`);
                previous = y;
            }
            const [, first] = readAccessorElement(glb, track.scale.output, 0);
            assert.ok(Math.abs(first - 1) < 1e-4, `${piece} starts at full height`);
            assert.ok(previous > 0.02 && previous < 0.1, `${piece} ends ${previous.toFixed(3)} of its height`);
        }
    }
});

test('a collapse measures exactly like the intact part it is swapped for', () => {
    // The loader places a model by its own bounding box, so a scene that measured differently
    // from the part would appear offset at the one moment the player looks straight at it. The
    // collapses are drawn from the very same builders as the parts, so their whole box matches.
    for (const [fileStem, expected] of Object.entries(SCENES)) {
        const bounds = restBounds(readGlb(fileStem).document);
        const intact = restBounds(readGlb(expected.intact).document);
        for (const axis of ['x', 'y', 'z']) {
            assert.ok(Math.abs(bounds.min[axis] - intact.min[axis]) < 0.05 && Math.abs(bounds.max[axis] - intact.max[axis]) < 0.05,
                `${fileStem} spans ${bounds.min[axis].toFixed(2)}..${bounds.max[axis].toFixed(2)} in ${axis}, the part ${intact.min[axis].toFixed(2)}..${intact.max[axis].toFixed(2)}`);
        }
        assert.ok(Math.abs(bounds.min.y - expected.baseMetres) < 0.05, `${fileStem} sits at ${bounds.min.y.toFixed(2)} m, expected ${expected.baseMetres}`);
    }
});

test('the mushroom cloud rises over a ruin that centres and sits like the reactor block', () => {
    const glb = readGlb(CLOUD.stem);
    const { document } = glb;
    assert.deepEqual(rootNodeNames(document), [`piece_${CLOUD.piece}`], 'one rig carries the whole scene');
    const root = document.nodes.find((node) => node.name === `piece_${CLOUD.piece}`);
    const rigNames = (root.children || []).map((index) => document.nodes[index].name).sort();
    assert.deepEqual(rigNames, Object.keys(CLOUD.rigs).sort(), 'the ruin and the four parts of the cloud hang under it');

    // The rest pose is the ruin: the cloud parts are keyed away to nothing, so the box the loader
    // places by is the ruin's, centred like the intact block and on its underside.
    const bounds = restBounds(document);
    const intact = restBounds(readGlb(CLOUD.intact).document);
    const centre = bounds.getCenter(new THREE.Vector3());
    const intactCentre = intact.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(centre.x - intactCentre.x) < 0.05 && Math.abs(centre.z - intactCentre.z) < 0.05,
        `the ruin centres at (${centre.x.toFixed(2)}, ${centre.z.toFixed(2)}), the block at (${intactCentre.x.toFixed(2)}, ${intactCentre.z.toFixed(2)})`);
    assert.ok(Math.abs(bounds.min.y - CLOUD.baseMetres) < 0.05, `the ruin sits at ${bounds.min.y.toFixed(2)} m`);
    assert.ok(Math.abs(intact.min.y - CLOUD.baseMetres) < 0.05, `the block sits at ${intact.min.y.toFixed(2)} m`);

    // Nothing in the cloud may collide; everything in the ruin does and is moved by the clip.
    const moved = animatedMeshNodeNames(document);
    for (const [rig, collides] of Object.entries(CLOUD.rigs)) {
        const rigNode = document.nodes.find((node) => node.name === rig);
        const meshes = (rigNode.children || []).map((index) => document.nodes[index]).filter((node) => node.mesh !== undefined);
        assert.ok(meshes.length > 0, `${rig} draws something`);
        for (const mesh of meshes) {
            assert.ok(mesh.name.startsWith(`piece_${CLOUD.piece}_${rig}_`), `${mesh.name} is named for its rig`);
            assert.equal(mesh.name.includes('_nocol'), !collides, `${mesh.name} ${collides ? 'collides' : 'is decor'}`);
            assert.ok(moved.has(mesh.name), `${mesh.name} is moved by the clip`);
        }
    }
});

test('the cloud is keyed from curves: it grows, climbs, holds, and the fireball is gone inside it', () => {
    const glb = readGlb(CLOUD.stem);
    const tracks = nodeTracks(glb);
    const frames = frameCount(glb);
    const fps = (frames - 1) / CLOUD.seconds;
    const scaleAt = (rig, frame) => readAccessorElement(glb, tracks.get(rig).scale.output, frame);
    const heightAt = (rig, frame) => readAccessorElement(glb, tracks.get(rig).translation.output, frame)[1];

    // The cap and the stem grow monotonically and the cap climbs monotonically, then everything
    // holds for the last second.
    for (const rig of ['cap', 'stem', 'ring']) {
        let previous = 0;
        for (let frame = 0; frame < frames; frame += 1) {
            const radius = scaleAt(rig, frame)[0];
            assert.ok(radius >= previous - 1e-6, `${rig} shrinks at frame ${frame}`);
            previous = radius;
        }
    }
    let previousHeight = 0;
    for (let frame = 0; frame < frames; frame += 1) {
        const height = heightAt('cap', frame);
        assert.ok(height >= previousHeight - 1e-6, `the cap sinks at frame ${frame}`);
        previousHeight = height;
    }
    const held = Math.round(fps);
    for (let frame = frames - held; frame < frames; frame += 1) {
        assert.deepEqual(scaleAt('cap', frame), scaleAt('cap', frames - 1), `the cap is held at frame ${frame}`);
    }
    // ...to the size and the height the generator states.
    const [capRadius] = scaleAt('cap', frames - 1);
    assert.ok(Math.abs(capRadius - CLOUD.capRadius) < 2, `the cap ends at radius ${capRadius.toFixed(1)} m`);
    assert.ok(Math.abs(heightAt('cap', frames - 1) + 0.55 * capRadius - CLOUD.capTop) < 2,
        `the cap tops out at ${(heightAt('cap', frames - 1) + 0.55 * capRadius).toFixed(1)} m`);
    // The fireball is there at the start, at its size at 1.4 s, and gone by 4.4 s.
    const [fireStart] = scaleAt('fire', 0);
    const [firePeak] = scaleAt('fire', Math.round(1.4 * fps));
    const [fireGone] = scaleAt('fire', Math.round(CLOUD.fireballGoneSeconds * fps) + 1);
    assert.ok(fireStart < 0.01, 'the fireball starts at nothing');
    assert.ok(firePeak > 50, `the fireball peaks at ${firePeak.toFixed(1)} m`);
    assert.ok(fireGone < 0.01, `the fireball is still ${fireGone.toFixed(1)} m at ${CLOUD.fireballGoneSeconds} s`);
    // The ruin only settles; it never grows and never moves.
    const [, ruinStart] = scaleAt('ruin', 0);
    const [, ruinEnd] = scaleAt('ruin', frames - 1);
    assert.ok(Math.abs(ruinStart - 1) < 1e-4 && ruinEnd < ruinStart && ruinEnd > 0.5, `the ruin settles to ${ruinEnd.toFixed(2)}`);
    assert.equal(tracks.get('ruin').translation, undefined, 'the ruin stays where the block stood');
});
