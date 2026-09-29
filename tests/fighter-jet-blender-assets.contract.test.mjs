import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AnimationMixer, Box3, Vector3 } from 'three';

import { loadGLBMap } from '../src/entities/GLBMapLoader.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// The jet is a hero vehicle model, not a map setpiece: it carries eight clips instead of one,
// because gear, canopy, brake, probe, control surfaces, afterburner and wheels move on their own
// systems. This test reads the checked-in GLB, needs no Blender, and pins the numbers the model
// was measured with at 30 fps.
const ASSET_ROOT = path.resolve('assets/models/fighter_jet');
const BLEND_PATH = path.join(ASSET_ROOT, 'blender', '01_fighter_jet.blend');
const GLB_PATH = path.join(ASSET_ROOT, 'glb', '01_fighter_jet.glb');
const MODEL_URL = 'assets/models/fighter_jet/glb/01_fighter_jet.glb';

// Clip name -> authored length in seconds (30 fps, the exporter bakes per frame).
const EXPECTED_CLIPS = Object.freeze({
    afterburner: 2.0,
    flight_controls: 4.0,
    canopy_open: 1.2,
    gear_up: 3.0,
    gear_down: 3.0,
    wheel_roll: 1.0,
    refuel_probe_extend: 1.5,
    speed_brake_open: 0.8,
});
// Parts a runtime rotates on their own node. The mesh children of a multi-material part are
// named `<node>_mesh`, so a lookup by the part name finds the pivot, not a mesh.
const MOVING_PARTS = Object.freeze([
    'canopy', 'canard_left', 'canard_right', 'elevon_left', 'elevon_right', 'lef_left', 'lef_right',
    'rudder', 'speed_brake', 'refuel_probe', 'gear_nose', 'gear_left', 'gear_right', 'door_nose',
    'door_left', 'door_right', 'wheel_nose', 'wheel_left', 'wheel_right', 'nozzle_petals',
    'afterburner_noshadow_nocol',
]);
const DECORATION_ONLY = Object.freeze([
    'jet_cockpit_interior_noshadow_nocol', 'jet_details_noshadow_nocol',
    'afterburner_noshadow_nocol',
]);
// Measured through loadGLBMap with the gear-up clock: the parked model with its wheels on the
// ground line, its nose towards -z (the game's forward axis for player vehicles) and the stores
// as the widest part.
const PARKED_BOUNDS = Object.freeze({
    min: [-4.642, -2.065, -7.92],
    max: [4.642, 2.452, 7.03],
});

function readGlbJson(filePath) {
    return readGlb(filePath).document;
}

function readGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    assert.equal(bytes.readUInt32LE(8), bytes.length, `${filePath} declares its real length`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with a JSON chunk`);
    return {
        bytes,
        document: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd()),
        binary: bytes.subarray(28 + jsonLength),
    };
}

// Same read as the audit script: COLOR_0 multiplies the paint, so a wrapped value would show up as
// an almost black channel instead of the shading that was baked.
function minColorChannel(document, binary, accessorIndex) {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews[accessor.bufferView];
    const components = accessor.type === 'VEC4' ? 4 : 3;
    const width = accessor.componentType === 5126 ? 4 : 2;
    const scale = accessor.componentType === 5126 ? 1 : 65535;
    const stride = view.byteStride || components * width;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    let min = Infinity;
    for (let index = 0; index < accessor.count; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
            const offset = start + index * stride + channel * width;
            const raw = width === 4 ? binary.readFloatLE(offset) : binary.readUInt16LE(offset);
            min = Math.min(min, raw / scale);
        }
    }
    return min;
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

// One clip at a time on a fresh mixer: `action.time` then `mixer.update(0)` writes the pose at
// that time without advancing it, the same seam GlbAnimationDriver uses at runtime.
function sampleClip(scene, animations, clipName, nodeNames, times, readNode) {
    const clip = animations.find((entry) => entry.name === clipName);
    assert.ok(clip, `clip ${clipName} exists`);
    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    try {
        return times.map((time) => {
            action.time = Math.min(time, clip.duration);
            mixer.update(0);
            scene.updateMatrixWorld(true);
            const values = { seconds: round(time) };
            for (const name of nodeNames) {
                const node = scene.getObjectByName(name);
                assert.ok(node, `${name} is a node in the file`);
                values[name] = readNode(node);
            }
            return values;
        });
    } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(scene);
    }
}

function worldPosition(node) {
    return node.getWorldPosition(new Vector3());
}

test('fighter jet keeps an editable source and eight timed clips inside the budget', () => {
    assert.ok(statSync(BLEND_PATH).size > 100_000, 'the editable Blender source is checked in');
    assert.ok(statSync(GLB_PATH).size > 10_000, 'the GLB is not empty');
    assert.ok(statSync(GLB_PATH).size <= 700 * 1024,
        'the GLB stays below the 700 KiB budget (geometry, one painted skin, vertex shading)');

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
    assert.ok(triangles <= 20_000, `${triangles} triangles stay inside the model budget`);
    assert.ok(primitives.length <= 64, `${primitives.length} primitives stay inside the draw budget`);
});

test('fighter jet carries a painted skin and stays inside the colour range glTF can hold', () => {
    const { document, binary } = readGlb(GLB_PATH);
    const primitives = (document.meshes || []).flatMap((mesh) => mesh.primitives);

    // One embedded PNG serves the whole airframe: no external file, no decoder, no mipmap chain.
    assert.equal(document.images?.length, 1, 'the livery is one embedded image');
    const image = document.images[0];
    assert.equal(image.mimeType, 'image/png', 'the picture is a PNG, the only kind three.js reads here');
    assert.equal(image.uri, undefined, 'the picture travels inside the GLB, not beside it');
    const view = document.bufferViews[image.bufferView];
    assert.ok(view.byteLength > 4_000 && view.byteLength < 400 * 1024,
        `the embedded picture is ${Math.round(view.byteLength / 1024)} KiB`);

    const painted = (document.materials || []).filter((material) => (
        material.pbrMetallicRoughness?.baseColorTexture !== undefined));
    assert.equal(painted.length, 1, 'exactly the airframe paint is textured');
    assert.equal(painted[0].name, 'JetSkin');
    assert.equal(painted[0].pbrMetallicRoughness.baseColorTexture.index, 0);
    assert.equal(painted[0].pbrMetallicRoughness.baseColorFactor, undefined,
        'the texture is not multiplied down by a guessed factor');
    for (const material of document.materials || []) {
        assert.notEqual(material.doubleSided, true, `${material.name} is single sided`);
    }
    assert.equal(primitives.filter((primitive) => primitive.attributes.TEXCOORD_0 !== undefined).length,
        primitives.length, 'every primitive can be painted');

    // COLOR_0 holds the two-tone underside and the baked occlusion. It multiplies the paint, so it
    // may only darken, and a value below the repo's floor means the layer wrapped above 1.0.
    const colored = primitives.filter((primitive) => primitive.attributes.COLOR_0 !== undefined);
    assert.ok(colored.length >= primitives.length - 1,
        `${colored.length} of ${primitives.length} primitives carry the shading layer`);
    let darkest = 1;
    for (const primitive of colored) {
        darkest = Math.min(darkest, minColorChannel(document, binary, primitive.attributes.COLOR_0));
    }
    assert.ok(darkest >= 0.17, `darkest COLOR_0 channel is ${darkest.toFixed(3)}, above the wrap floor`);
    assert.ok(darkest < 0.6, `the baked shading actually darkens something (${darkest.toFixed(3)})`);
});

test('fighter jet names its moving parts and keeps trim out of collision and shadows', () => {
    const document = readGlbJson(GLB_PATH);
    const names = (document.nodes || []).map((node) => String(node.name || ''));
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
    const solidTrim = names.filter((name) => /^jet_(details|cockpit_interior)/.test(name)
        && !/_noshadow_nocol/.test(name));
    assert.deepEqual(solidTrim, [], 'trim meshes never become collision surfaces');
});

test('the cockpit fits inside the canopy shell instead of piercing it', async () => {
    const gltf = await geometryOnlyGlbLoader.loadAsync(MODEL_URL);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const boundsOf = (name) => {
        const node = scene.getObjectByName(name);
        assert.ok(node, `${name} exists`);
        return new Box3().setFromObject(node);
    };
    const cockpit = boundsOf('jet_cockpit_interior_noshadow_nocol');
    const canopy = boundsOf('canopy');

    // Seat back, headrest and head-up display used to stand through the glass; this is the guard.
    assert.ok(cockpit.max.y < canopy.max.y - 0.02,
        `cockpit roof ${round(cockpit.max.y)} is under the canopy roof ${round(canopy.max.y)}`);
    assert.ok(cockpit.max.x < canopy.max.x && cockpit.min.x > canopy.min.x,
        'the consoles stay inside the canopy sides');
    assert.ok(cockpit.max.z < canopy.max.z && cockpit.min.z > canopy.min.z,
        'the cockpit sits inside the canopy fore and aft');
    assert.ok(cockpit.max.y - cockpit.min.y > 0.5,
        'the cockpit has a seat and a panel, not a flat plate');

    const document = readGlbJson(GLB_PATH);
    const screens = (document.materials || []).find((material) => material.name === 'JetScreen');
    assert.ok(screens, 'the cockpit carries its own screen material');
    const strength = screens.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    const peak = Math.max(...(screens.emissiveFactor || [0, 0, 0])) * strength;
    assert.ok(peak > 0.05 && peak < 2, `the screens glow faintly (${round(peak)}), never white`);
});

test('every moving part travels through its clip and returns to the parked pose', async () => {
    const gltf = await geometryOnlyGlbLoader.loadAsync(MODEL_URL);
    const scene = gltf.scene;
    const animations = gltf.animations;

    // Rest pose: no clip playing is the parked jet with the wheels on the ground.
    scene.updateMatrixWorld(true);
    assert.equal(round(worldPosition(scene.getObjectByName('wheel_nose')).y), -1.74,
        'the nose wheel stands on the ground line while nothing plays');
    assert.equal(round(scene.getObjectByName('canopy').rotation.x), 0, 'the canopy starts shut');
    assert.equal(round(scene.getObjectByName('refuel_probe').position.length()), 0,
        'the probe starts stowed');

    // Landing gear: the legs swing and the wheels ride along on their parent.
    const gear = sampleClip(scene, animations, 'gear_up',
        ['gear_nose', 'wheel_nose', 'door_left'], [0, 1.4, 2.2, 3.0],
        (node) => ({ rotation: round(node.rotation.x), position: worldPosition(node).toArray().map(round) }));
    assert.equal(gear[0].wheel_nose.position[1], -1.74, 'the wheel hangs below the leg at rest');
    assert.ok(Math.abs(gear[1].gear_nose.rotation) > 0.7, 'the nose leg swings at 1.4 s');
    assert.ok(gear[2].wheel_nose.position[1] > -1.0, 'the wheel rides up with the retracting leg');
    assert.ok(Math.abs(gear[2].wheel_nose.position[0]) < 0.01, 'the wheel keeps its span station');
    assert.ok(gear[2].wheel_nose.position[2] < -2.6 && gear[2].wheel_nose.position[2] > -3.0,
        'the retracted wheel ends up under the fuselage');
    const doorLeft = sampleClip(scene, animations, 'gear_up', ['door_left'], [0, 0.6, 3.0],
        (node) => round(node.rotation.z));
    assert.ok(Math.abs(doorLeft[1].door_left) > 1.2, 'the door swings open before the leg travels');
    assert.equal(doorLeft[2].door_left, 0, 'the door shuts again on the retracted leg');
    // gear_down is the same travel backwards and ends exactly on the parked pose.
    const gearDown = sampleClip(scene, animations, 'gear_down', ['wheel_nose'], [0, 3.0],
        (node) => worldPosition(node).toArray().map(round));
    assert.ok(gearDown[0].wheel_nose[1] > -1.0, 'gear_down starts retracted');
    assert.equal(gearDown[1].wheel_nose[1], -1.74, 'gear_down ends on the parked pose');

    // Canopy, speed brake and probe: one hinge each, opening and extending.
    const canopy = sampleClip(scene, animations, 'canopy_open', ['canopy'], [0, 1.2],
        (node) => round((node.rotation.x * 180) / Math.PI));
    assert.equal(canopy[0].canopy, 0);
    assert.ok(canopy[1].canopy > 28 && canopy[1].canopy < 32, `canopy lifts 30 degrees, got ${canopy[1].canopy}`);
    const brake = sampleClip(scene, animations, 'speed_brake_open', ['speed_brake'], [0, 0.8],
        (node) => round((node.rotation.x * 180) / Math.PI));
    assert.ok(brake[1].speed_brake < -50, `the speed brake opens 55 degrees, got ${brake[1].speed_brake}`);
    const probe = sampleClip(scene, animations, 'refuel_probe_extend', ['refuel_probe'], [0, 1.5],
        (node) => ({ move: round(node.position.length()), rotation: round(node.rotation.x) }));
    assert.ok(probe[1].refuel_probe.move > 0.9,
        `the probe telescopes 0.95 m, got ${probe[1].refuel_probe.move}`);
    assert.ok(probe[1].refuel_probe.rotation < -0.1, 'the extended probe droops');

    // Afterburner: the flame grows out of the nozzle and the petals iris with it.
    const burner = sampleClip(scene, animations, 'afterburner',
        ['afterburner_noshadow_nocol', 'nozzle_petals'], [0, 0.6, 2.0],
        (node) => node.scale.toArray().map(round));
    assert.ok(burner[0].afterburner_noshadow_nocol[2] < 0.1, 'the flame is drawn in at idle');
    assert.deepEqual(burner[1].afterburner_noshadow_nocol, [1, 1, 1], 'the flame is at full length');
    assert.ok(burner[1].nozzle_petals[0] > burner[0].nozzle_petals[0], 'the iris opens with thrust');
    assert.deepEqual(burner[2].afterburner_noshadow_nocol, burner[0].afterburner_noshadow_nocol,
        'the flame returns to idle at the end of the loop');

    // Wheels: a full turn over the loop, and the same phase on both sides.
    const wheels = sampleClip(scene, animations, 'wheel_roll', ['wheel_nose', 'wheel_left'],
        [0, 0.25, 0.5, 1.0], (node) => round(node.rotation.x));
    assert.ok(Math.abs(wheels[1].wheel_nose - wheels[0].wheel_nose) > 1.0, 'wheels spin');
    assert.equal(wheels[1].wheel_nose, wheels[1].wheel_left, 'both sides turn together');
    assert.equal(wheels[3].wheel_nose, wheels[0].wheel_nose, 'the spin loop closes');

    // Control surfaces: one loop of pitch, roll and yaw that ends where it began.
    const controls = sampleClip(scene, animations, 'flight_controls',
        ['elevon_left', 'elevon_right', 'canard_left', 'rudder', 'lef_left'], [0, 1.3333, 2.0, 4.0],
        (node) => node.quaternion.clone());
    // A roll input splits the elevons, so each part is measured at its own strongest frame.
    const peakDeflection = (part) => Math.max(...[1, 2].map((index) => (
        controls[0][part].angleTo(controls[index][part]) * (180 / Math.PI)
    )));
    for (const part of ['elevon_left', 'elevon_right', 'canard_left', 'lef_left']) {
        assert.ok(peakDeflection(part) > 8, `${part} deflects in the loop, peak ${round(peakDeflection(part))}`);
    }
    assert.ok(peakDeflection('rudder') > 15, 'the rudder yaws in the loop');
    assert.ok(Math.abs(controls[1].elevon_left.angleTo(controls[1].elevon_right) * (180 / Math.PI)) > 30,
        'a roll input splits the two elevons against each other');
    for (const part of ['elevon_left', 'elevon_right', 'canard_left', 'rudder', 'lef_left']) {
        // Sampled at the exact clip end the pose is the start pose again; half a degree of slack
        // covers the last interpolation step, against deflections of eight degrees and more.
        assert.ok(controls[0][part].angleTo(controls[3][part]) * (180 / Math.PI) < 0.5,
            `${part} returns to its start, so the loop is seamless`);
    }
});

test('the real loader places the parked jet and gives the moving parts dynamic collision', async () => {
    const parked = await loadGLBMap(MODEL_URL, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'dynamic',
        animationClock: { clipName: 'gear_up', mode: 'once', playbackRate: 1 },
    });
    const size = parked.bounds.getSize(new Vector3());
    assert.deepEqual(parked.bounds.min.toArray().map(round), PARKED_BOUNDS.min, 'placement floor');
    assert.deepEqual(parked.bounds.max.toArray().map(round), PARKED_BOUNDS.max, 'placement roof');
    // Longest edge is the fuselage, the nose points to -z, and the wheels set the base height.
    assert.ok(Math.abs(size.z - 14.95) < 0.05, `length ${round(size.z)} stays the authored 14.1 m plus stores`);
    assert.ok(Math.abs(size.x - 9.285) < 0.05, 'span follows the wingtip stores');

    const animated = [...(parked.animatedNodes?.values?.() ?? parked.animatedNodes)]
        .map((node) => node.name);
    for (const part of ['gear_nose', 'gear_left', 'gear_right', 'wheel_nose', 'door_nose']) {
        assert.ok(animated.includes(part), `${part} counts as animated for the gear_up clip`);
    }
    assert.ok(!animated.includes('canopy'), 'a clip only claims the parts it drives');

    const colliders = parked.colliders.map((entry) => entry.meshCollider.mesh.name).sort();
    assert.ok(colliders.length > 0, 'the moving gear carries colliders');
    for (const part of ['gear_nose', 'gear_left', 'gear_right']) {
        assert.ok(colliders.some((name) => name.startsWith(part)), `${part} collides`);
    }
    assert.ok(colliders.every((name) => !name.includes('afterburner')), 'the flame never collides');
    assert.ok(colliders.every((name) => !name.includes('details')), 'trim never collides');
});
