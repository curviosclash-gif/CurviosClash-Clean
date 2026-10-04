import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { AnimationMixer, Box3, Vector3 } from 'three';

import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// The Nova Lance is the sci-fi space fighter of the vehicle family. It is a hero model with eight
// clips, one per moving system, because gear, canopy, airbrake, control surfaces, nozzles, burner
// and wheels move on independent systems. The game does not load this file yet, so the reference
// loader is three's GLTFLoader with the materials stripped - the same seam the other authored
// models are probed through. Runtime contracts read the checked-in GLB without Blender and pin
// its measured values at 30 fps. An additional source roundtrip runs when Blender is installed.
const ASSET_ROOT = path.resolve('assets/models/scifi_fighter');
const BLEND_PATH = path.join(ASSET_ROOT, 'blender', 'nova_lance.blend');
const GLB_PATH = path.join(ASSET_ROOT, 'glb', '01_scifi_fighter.glb');
const MODEL_URL = 'assets/models/scifi_fighter/glb/01_scifi_fighter.glb';

const BLENDER = process.env.BLENDER_EXECUTABLE
    || 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe';
test('Nova Lance source and runtime have the same evaluated world geometry', {
    skip: !existsSync(BLENDER),
}, () => {
    const inspect = String.raw`
import bpy, os
from pathlib import Path
from mathutils.kdtree import KDTree
root = Path(os.environ['NOVA_ASSET_ROOT'])
bpy.ops.wm.open_mainfile(filepath=str(root / 'blender/nova_lance.blend'))
bpy.context.scene.frame_set(0)
def geometry():
    rows = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH': continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        rows[obj.name] = ([evaluated.matrix_world @ v.co for v in mesh.vertices],
                         sum(len(p.vertices)-2 for p in mesh.polygons),
                         {m.name for m in mesh.materials})
        evaluated.to_mesh_clear()
    return rows
source = geometry()
for image in bpy.data.images:
    assert image.source != 'FILE' or image.packed_file, 'source texture must be portable'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'glb/01_scifi_fighter.glb'))
bpy.context.scene.frame_set(0)
runtime = geometry()
assert source.keys() == runtime.keys(), (source.keys(),runtime.keys())
for name, (points, triangles, materials) in source.items():
    imported, imported_triangles, imported_materials = runtime[name]
    assert triangles == imported_triangles and materials == imported_materials, (name, triangles, imported_triangles, materials, imported_materials)
    # UV seams split exported vertices; compare actual positions in both directions.
    for a,b in ((points,imported),(imported,points)):
        tree = KDTree(len(a))
        for i,p in enumerate(a): tree.insert(p,i)
        tree.balance()
        distance = max(tree.find(p)[2] for p in b)
        assert distance < .0001, (name, distance)
print('NOVA_SOURCE_ROUNDTRIP_PASS', len(source), sum(row[1] for row in source.values()))
`;
    const result = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1',
        '--python-expr', inspect], { encoding: 'utf8', windowsHide: true, timeout: 120_000,
        env: { ...process.env, NOVA_ASSET_ROOT: ASSET_ROOT } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /NOVA_SOURCE_ROUNDTRIP_PASS/);
});

// Clip name -> authored length in seconds (30 fps, the exporter bakes per frame).
const EXPECTED_CLIPS = Object.freeze({
    flight_controls: 4.0,
    canopy_open: 1.2,
    gear_down: 3.0,
    gear_up: 3.0,
    wheel_roll: 1.0,
    nozzle_iris: 1.5,
    afterburner: 2.0,
    airbrake_open: 0.8,
});

// Parts a runtime drives on its own node. Every one keeps its object origin on its hinge, so a
// clip that writes rotation_euler.x (or y) deflects the surface about that hinge.
const MOVING_PARTS = Object.freeze([
    'canopy', 'canard_left', 'canard_right',
    'elevon_left', 'elevon_right', 'rudder_left', 'rudder_right',
    'gear_nose', 'gear_left', 'gear_right',
    'door_nose', 'door_left', 'door_right',
    'wheel_nose', 'wheel_left', 'wheel_right',
    'nozzle_petals_left', 'nozzle_petals_right',
    'airbrake_left', 'airbrake_right',
    'afterburner_left_noshadow_nocol', 'afterburner_right_noshadow_nocol',
]);

// Trim: visible, but it must never cost a shadow or a collision triangle.
const DECORATION_ONLY = Object.freeze([
    'nova_details_noshadow_nocol',
    'nova_cockpit_interior_noshadow_nocol',
    'nova_paint_noshadow_nocol',
    'afterburner_left_noshadow_nocol',
    'afterburner_right_noshadow_nocol',
]);

// Measured through the loader with no clip playing: the parked fighter on its wheels (ground line
// -1.95), the canted fin tips as its highest and widest points and the pitot as its longest reach.
// Nose towards -z, the game's forward axis for player vehicles. The span reads a little narrower
// here than in Blender's own report, because the loader adds up the boxes of the single-material
// primitives while Blender boxes the whole part.
const PARKED_BOUNDS = Object.freeze({
    min: [-5.97, -1.95, -7.861],
    max: [5.97, 2.289, 6.35],
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

function round(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function worldPosition(node) {
    return node.getWorldPosition(new Vector3());
}

// One clip at a time on a fresh mixer: `action.time` then `mixer.update(0)` writes the pose at
// that time without advancing it, the same seam a runtime animation driver uses.
function sampleClip(scene, animations, clipName, nodeNames, times, readNode) {
    const clip = animations.find((entry) => entry.name === clipName);
    assert.ok(clip, `clip ${clipName} exists`);
    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    const nodes = Object.fromEntries(nodeNames.map((name) => {
        const node = scene.getObjectByName(name);
        assert.ok(node, `${name} is a named node in the rig`);
        return [name, node];
    }));
    const samples = times.map((time) => {
        action.time = time;
        mixer.update(0);
        scene.updateMatrixWorld(true);
        return Object.fromEntries(nodeNames.map((name) => [name, readNode(nodes[name])]));
    });
    action.stop();
    mixer.uncacheRoot(scene);
    return samples;
}

function degrees(radians) {
    return round((radians * 180) / Math.PI);
}

test('the sci-fi fighter keeps an editable source and eight timed clips inside the budget', () => {
    assert.ok(statSync(BLEND_PATH).size > 100_000, 'the editable Blender source is checked in');
    assert.ok(statSync(GLB_PATH).size > 10_000, 'the GLB is not empty');
    assert.ok(statSync(GLB_PATH).size <= 600 * 1024, 'the GLB stays below the 600 KiB budget');

    const document = readGlbJson(GLB_PATH);
    assert.deepEqual((document.extensionsUsed || []).filter((extension) => /draco|meshopt|basisu/i
        .test(extension)), [], 'the game registers no Draco, Meshopt or KTX2 decoder');

    const clips = new Map((document.animations || []).map((animation) => [animation.name, animation]));
    assert.deepEqual([...clips.keys()].sort(), Object.keys(EXPECTED_CLIPS).sort(),
        'the file carries exactly the authored clips');
    for (const [name, seconds] of Object.entries(EXPECTED_CLIPS)) {
        const animation = clips.get(name);
        assert.ok(animation.channels.length > 0, `${name} drives at least one node`);
        assert.ok(Math.abs(animationDurationSeconds(document, animation) - seconds) <= (1 / 30),
            `${name} keeps its authored length`);
    }

    const primitives = (document.meshes || []).flatMap((mesh) => mesh.primitives);
    const triangles = primitives.reduce((sum, primitive) => (
        sum + document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3
    ), 0);
    assert.ok(triangles <= 30_000, `${triangles} triangles stay inside the model budget`);
    assert.ok(primitives.length <= 64, `${primitives.length} primitives stay inside the draw budget`);
    assert.ok(!primitives.some((primitive) => primitive.attributes.COLOR_0 !== undefined),
        'no vertex colours, so no wrapped 16-bit tint can darken the paint');

    const baseColorTextures = (document.materials || []).filter((material) => (
        material.pbrMetallicRoughness?.baseColorTexture !== undefined
    ));
    assert.ok((document.images || []).length >= 1, 'the skin map is embedded in the file');
    assert.ok(baseColorTextures.length >= 1, 'the hull reads its panel lines from that map');
});

test('the sci-fi fighter names its moving parts and keeps trim out of collision and shadows', () => {
    const document = readGlbJson(GLB_PATH);
    const names = (document.nodes || []).map((node) => String(node.name || ''));
    assert.ok(!names.includes('tail_plate_noshadow_nocol'), 'the approved Nova Lance has no tail plate');
    // three.js sanitises node names; a dot or a space would break a lookup by name.
    for (const name of names) {
        assert.equal(name.replace(/\s/g, '_').replace(/[^\w-]/g, ''), name,
            `${name} survives three.js PropertyBinding.sanitizeNodeName`);
    }
    for (const part of MOVING_PARTS) {
        assert.ok(names.includes(part), `${part} is a named node the runtime can drive`);
    }
    for (const name of DECORATION_ONLY) {
        assert.ok(names.includes(name), `${name} exists`);
        assert.match(name, /_noshadow_nocol$/, `${name} is marked as trim`);
    }
    const solidTrim = names.filter((name) => /^nova_(details|cockpit_interior)/.test(name)
        && !/_noshadow_nocol/.test(name));
    assert.deepEqual(solidTrim, [], 'trim meshes never become collision surfaces');
});

test('iris, glow and burner geometry are centred on their actual nozzle hinges', () => {
    const document = readGlbJson(GLB_PATH);
    for (const side of ['left', 'right']) {
        for (const name of [`nozzle_petals_${side}`, `nozzle_glow_${side}`,
            `afterburner_${side}_noshadow_nocol`]) {
            const node = document.nodes.find((entry) => entry.name === name);
            assert.ok(node && Number.isInteger(node.mesh), `${name} has actual mesh geometry`);
            const bounds = document.meshes[node.mesh].primitives.map((primitive) => (
                document.accessors[primitive.attributes.POSITION]
            ));
            for (const accessor of bounds) {
                for (const axis of [0, 1]) {
                    assert.ok(Math.abs(accessor.min[axis] + accessor.max[axis]) < .001,
                        `${name} stays radially centred on its nozzle hinge`);
                }
                assert.ok(accessor.min[2] >= -.061 && accessor.max[2] <= 1.551,
                    `${name} extends aft from its nozzle instead of reaching into the fuselage`);
            }
        }
    }
});

test('the parked fighter sits on its wheels with the nose towards the game forward axis', async () => {
    const gltf = await geometryOnlyGlbLoader.loadAsync(MODEL_URL);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    const box = new Vector3();
    let lowest = Infinity;
    let highest = -Infinity;
    let widest = 0;
    let longest = 0;
    const measure = (node) => {
        if (!node.isMesh || !node.geometry) return;
        node.geometry.computeBoundingBox();
        const local = node.geometry.boundingBox;
        for (const corner of [
            new Vector3(local.min.x, local.min.y, local.min.z), new Vector3(local.max.x, local.min.y, local.min.z),
            new Vector3(local.min.x, local.max.y, local.min.z), new Vector3(local.max.x, local.max.y, local.min.z),
            new Vector3(local.min.x, local.min.y, local.max.z), new Vector3(local.max.x, local.min.y, local.max.z),
            new Vector3(local.min.x, local.max.y, local.max.z), new Vector3(local.max.x, local.max.y, local.max.z),
        ]) {
            const world = corner.applyMatrix4(node.matrixWorld);
            lowest = Math.min(lowest, world.y);
            highest = Math.max(highest, world.y);
            widest = Math.max(widest, Math.abs(world.x));
            longest = Math.max(longest, Math.abs(world.z));
        }
    };
    scene.traverse(measure);
    assert.ok(Number.isFinite(lowest), 'the model has measurable geometry');
    void box;

    assert.equal(round(lowest), PARKED_BOUNDS.min[1], 'the wheels define the ground line');
    assert.equal(round(highest), PARKED_BOUNDS.max[1], 'the fins define the top');
    // The model stands on the game's forward axis -z: the nose is further forward than the tail.
    const nose = scene.getObjectByName('nose_tip_noshadow_nocol');
    const tail = scene.getObjectByName('engine_pods');
    assert.ok(nose && tail, 'nose and rear engine geometry exist');
    assert.ok(worldPosition(nose).z < -0.35, `the nose points towards -z, got ${round(worldPosition(nose).z)}`);
    assert.ok(new Box3().setFromObject(tail).max.z > 0.35, 'the actual engine geometry reaches aft');
    assert.ok(Math.abs(round(widest) - PARKED_BOUNDS.max[0]) <= 0.05,
        `the span is symmetric, got ${round(widest)}`);
    assert.ok(Math.abs(round(longest) - Math.abs(PARKED_BOUNDS.min[2])) <= 0.6,
        `the length reaches the tail, got ${round(longest)}`);
});

test('every moving part travels through its clip and returns to the parked pose', async () => {
    const gltf = await geometryOnlyGlbLoader.loadAsync(MODEL_URL);
    const scene = gltf.scene;
    const animations = gltf.animations;

    // Rest pose: no clip playing is the parked fighter with the gear down and the canopy shut.
    scene.updateMatrixWorld(true);
    assert.equal(round(scene.getObjectByName('canopy').rotation.x), 0, 'the canopy starts shut');
    assert.equal(round(scene.getObjectByName('afterburner_left_noshadow_nocol').scale.x), 0.278,
        'the burner starts as a stub across the span');
    assert.equal(round(scene.getObjectByName('afterburner_left_noshadow_nocol').scale.z), 0.05,
        'the burner starts as a stub along the thrust axis');
    assert.equal(round(scene.getObjectByName('airbrake_left').rotation.y), 0, 'the airbrake starts shut');

    // Landing gear: the doors open first, the legs swing, the wheels ride along on their parent.
    const gear = sampleClip(scene, animations, 'gear_up',
        ['gear_nose', 'wheel_nose', 'door_left'], [0, 1.0, 2.2, 3.0],
        (node) => ({ rotation: round(node.rotation.x), position: worldPosition(node).toArray().map(round) }));
    assert.ok(Math.abs(gear[0].gear_nose.rotation) < 0.01, 'the nose leg starts down');
    assert.ok(Math.abs(gear[2].gear_nose.rotation) > 1.4, `the nose leg swings up, got ${gear[2].gear_nose.rotation}`);
    assert.ok(gear[2].wheel_nose.position[1] > gear[0].wheel_nose.position[1] + 0.6,
        'the wheel rides up with the retracting leg');
    const doorLeft = sampleClip(scene, animations, 'gear_up', ['door_left'], [0, 0.6, 3.0],
        (node) => degrees(node.rotation.z));
    assert.ok(Math.abs(doorLeft[1].door_left) > 60, 'the door swings open before the leg travels');
    assert.equal(doorLeft[2].door_left, 0, 'the door shuts again on the retracted leg');
    // gear_down is the same travel backwards and ends exactly on the parked pose.
    const gearDown = sampleClip(scene, animations, 'gear_down', ['wheel_nose'], [0, 3.0],
        (node) => worldPosition(node).toArray().map(round));
    assert.ok(gearDown[0].wheel_nose[1] > gear[0].wheel_nose.position[1] + 0.6, 'gear_down starts retracted');
    assert.deepEqual(gearDown[1].wheel_nose, gear[0].wheel_nose.position, 'gear_down ends on the parked pose');

    // Flight controls: pitch plus a roll input, so the two elevons must not move together, and the
    // loop has to end where it started. Blender's fore-aft axis is the game's -z, so a surface
    // hinged along the span reads back as rotation.x, and the fins' yaw as rotation.y.
    const controlReader = (node) => degrees(node.name.startsWith('rudder')
        ? node.rotation.y : node.rotation.x);
    const controls = sampleClip(scene, animations, 'flight_controls',
        ['elevon_left', 'elevon_right', 'canard_left', 'rudder_left'],
        [0, 0.8, 1.6, 2.4, 4.0], controlReader);
    assert.ok(Math.abs(controls[2].elevon_left - controls[2].elevon_right) > 8,
        'the roll input deflects the elevons differentially');
    assert.ok(Math.abs(controls[1].canard_left - controls[0].canard_left) > 3, 'the canards follow pitch');
    assert.ok(Math.abs(controls[3].rudder_left) > 8, 'the wingtip rudders yaw');
    for (const part of ['elevon_left', 'elevon_right', 'canard_left', 'rudder_left']) {
        assert.ok(Math.abs(controls[4][part]) < 0.01, `${part} returns to neutral at the end of the loop`);
    }

    // Canopy and airbrake: one hinge each, opening and closing.
    const canopy = sampleClip(scene, animations, 'canopy_open', ['canopy'], [0, 1.2], (node) => degrees(node.rotation.x));
    assert.equal(canopy[0].canopy, 0);
    assert.ok(canopy[1].canopy > 29 && canopy[1].canopy < 35, `the canopy lifts 32 degrees, got ${canopy[1].canopy}`);
    const brake = sampleClip(scene, animations, 'airbrake_open', ['airbrake_left', 'airbrake_right'], [0, 0.8],
        (node) => degrees(node.rotation.z));
    assert.ok(Math.abs(brake[1].airbrake_left) > 45,
        `the airbrake opens 52 degrees, got ${brake[1].airbrake_left}`);
    assert.ok(Math.sign(brake[1].airbrake_left) === -Math.sign(brake[1].airbrake_right),
        'the two plates open away from each other');

    // Nozzles and burner: the iris closes and flares, the flame grows out of the nozzle.
    const iris = sampleClip(scene, animations, 'nozzle_iris', ['nozzle_petals_left'],
        [0, 0.4, 1.0, 1.5], (node) => round(node.scale.x));
    assert.ok(iris[2].nozzle_petals_left - iris[1].nozzle_petals_left > 0.1,
        'the iris opens from closed to flared');
    assert.equal(iris[0].nozzle_petals_left, iris[3].nozzle_petals_left, 'the iris returns to cruise');
    // Blender scales the plume on its fore-aft axis, which is the game's z.
    const burner = sampleClip(scene, animations, 'afterburner',
        ['afterburner_left_noshadow_nocol'], [0, 1.0, 2.0], (node) => round(node.scale.z));
    assert.ok(burner[1].afterburner_left_noshadow_nocol > 0.6,
        `the flame grows out of the nozzle, got ${burner[1].afterburner_left_noshadow_nocol}`);
    assert.ok(burner[2].afterburner_left_noshadow_nocol < 0.15, 'the flame is a stub again at the end');

    // Wheels: one revolution per second, linear, so the runtime can retime it freely. glTF stores
    // rotations as quaternions, so a full turn is the rest pose again - the quarter and the half
    // turn are what can be measured.
    const wheel = sampleClip(scene, animations, 'wheel_roll', ['wheel_left'], [0, 0.25, 0.5],
        (node) => round(node.rotation.x));
    assert.equal(wheel[0].wheel_left, 0);
    assert.ok(Math.abs(Math.abs(wheel[1].wheel_left) - (Math.PI / 2)) < 0.05,
        `a quarter turn after 0.25 s, got ${wheel[1].wheel_left}`);
    assert.ok(Math.abs(Math.abs(wheel[2].wheel_left) - Math.PI) < 0.05,
        `a half turn after 0.5 s, got ${wheel[2].wheel_left}`);
});
