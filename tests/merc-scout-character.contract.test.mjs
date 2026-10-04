/**
 * Contract test for the "Mercenary Scout" character product.
 *
 * The generator is the source of truth, so this test reads what a buyer would
 * receive: the checked-in GLB files, their embedded textures and the FBX exports.
 * It deliberately parses the GLB container itself instead of loading Blender or
 * three.js, so a broken export cannot be excused by a working authoring scene.
 *
 * Run: node --test tests/merc-scout-character.contract.test.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(ROOT, 'assets', 'models', 'characters', 'merc_scout');

const BLENDER = process.env.BLENDER_EXECUTABLE
  || 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe';
test('fitted source garments keep their body correspondence through every clip', {
  skip: !existsSync(BLENDER),
}, () => {
  const inspect = String.raw`
import bpy, os, json
from pathlib import Path
rows = []
for variant in ('mobile', 'pc', 'high'):
    bpy.ops.wm.open_mainfile(filepath=str(Path(os.environ['MERC_MODEL_DIR']) / f'blender/merc_scout_{variant}.blend'))
    body = bpy.data.objects['merc_scout_body']
    rig = bpy.data.objects['merc_scout_rig']
    for image in bpy.data.images:
        if image.source == 'FILE':
            assert image.packed_file is not None and image.filepath.startswith('//'), (
                f'{variant}: texture depends on the deleted worktree: {image.name}')
    garments = [bpy.data.objects[name] for name in ('merc_scout_jacket', 'merc_scout_trousers',
        'merc_scout_sleeve_L', 'merc_scout_sleeve_R', 'merc_scout_boot_L', 'merc_scout_boot_R')]
    for obj in garments:
        mapping = obj.data.attributes.get('body_vertex_index')
        assert mapping is not None, f'{variant} {obj.name}: missing fitted surface'
        assert sum(item.value > 0 for item in mapping.data) > 40
        for v, item in zip(obj.data.vertices, mapping.data):
            if not item.value:
                continue
            source = body.data.vertices[item.value - 1]
            expected = {body.vertex_groups[g.group].name: g.weight for g in source.groups if g.weight > 1e-6}
            actual = {obj.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 1e-6}
            assert expected.keys() == actual.keys(), f'{variant} {obj.name}: detached skin influence'
            assert max(abs(actual[k]-expected[k]) for k in expected) < 1e-5
    actions = list(bpy.data.actions)
    assert len(actions) == 11
    minimum = 1.0
    for action in actions:
        rig.animation_data.action = action
        first, last = action.frame_range
        for frame in (first, (first+last)/2, last):
            bpy.context.scene.frame_set(int(frame), subframe=frame-int(frame))
            depsgraph = bpy.context.evaluated_depsgraph_get()
            skin = body.evaluated_get(depsgraph).to_mesh()
            for obj in garments:
                evaluated = obj.evaluated_get(depsgraph)
                mesh = evaluated.to_mesh()
                mapping = obj.data.attributes['body_vertex_index']
                for vertex, item in zip(mesh.vertices, mapping.data):
                    if item.value:
                        # Nearest points can belong to the opposite thigh, and
                        # averaged normals reverse at bent joints. Follow the
                        # actual skin counterpart; rendered coverage is a separate gate.
                        source = skin.vertices[item.value-1]
                        gap = (vertex.co-source.co).length
                        rest_gap = (obj.data.vertices[vertex.index].co-body.data.vertices[item.value-1].co).length
                        minimum = min(minimum, gap/max(rest_gap, 1e-6))
                        assert gap >= rest_gap*.05 and gap <= rest_gap*2+1e-5, (
                            f'{variant} {action.name} {obj.name}: collapsed or detached surface offset {gap}/{rest_gap}')
                evaluated.to_mesh_clear()
            body.evaluated_get(depsgraph).to_mesh_clear()
    rows.append({'variant':variant, 'clips':len(actions), 'minimum_offset_ratio':minimum})
print('MERC_FITTED_SOURCE_PASS', json.dumps(rows))
`;
  const result = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python-expr', inspect], { encoding: 'utf8', windowsHide: true, timeout: 180_000,
    env: { ...process.env, MERC_MODEL_DIR: MODEL_DIR } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /MERC_FITTED_SOURCE_PASS/);
});

/** What each variant promises. Mirrors scripts/merc_scout/spec.py. */
const VARIANTS = {
  mobile: {
    maxTriangles: 26000,
    maxGlbBytes: 6 * 1024 * 1024,
    bones: 45,
    fingerSegments: 2,
    textureSize: 1024,
    skinTextureSize: 1024,
    materials: ['Eye', 'Hair', 'Jacket', 'Leather', 'Skin', 'Trousers'],
  },
  pc: {
    maxTriangles: 45000,
    maxGlbBytes: 24 * 1024 * 1024,
    bones: 55,
    fingerSegments: 3,
    textureSize: 2048,
    skinTextureSize: 2048,
    materials: ['Accent', 'Eye', 'Hair', 'Jacket', 'Leather', 'Metal', 'Skin', 'Trousers'],
  },
  high: {
    maxTriangles: 120000,
    maxGlbBytes: 64 * 1024 * 1024,
    bones: 55,
    fingerSegments: 3,
    textureSize: 2048,
    skinTextureSize: 4096,
    materials: ['Accent', 'Eye', 'Hair', 'Jacket', 'Leather', 'Metal', 'Skin', 'Trousers'],
  },
};

/**
 * Anthropometric reference for a 1.80 m adult, in metres, and the tolerance the
 * product accepts. Mirrors spec.ANTHROPOMETRY / spec.TOLERANCE.
 */
const REFERENCE = {
  height: 1.800,
  tolerance: 0.08,
  knee: 0.513,
  ankle: 0.070,
  hipJoint: 0.954,
  shoulder: 1.472,
  humerus: 0.315,
  radius: 0.250,
  femur: 0.441,
  tibia: 0.443,
};

/** Clip name -> authored frame count. Duration is (frames - 1) / 30 s. */
const CLIPS = {
  Idle: 90,
  Walk: 32,
  Run: 22,
  Jump: 18,
  Fall: 24,
  Land: 15,
  Attack: 24,
  Hit: 15,
  Death: 48,
  Emote_Wave: 48,
  Emote_Cheer: 60,
};

const LOOPING = new Set(['Idle', 'Walk', 'Run', 'Fall']);

/** Meshes the product ships, one swappable piece each. */
const MESHES = [
  'merc_scout_body',
  'merc_scout_boot_L',
  'merc_scout_boot_R',
  'merc_scout_eye_L',
  'merc_scout_eye_R',
  'merc_scout_glove_L',
  'merc_scout_glove_R',
  'merc_scout_hair',
  'merc_scout_head',
  'merc_scout_jacket',
  'merc_scout_kit',
  'merc_scout_sleeve_L',
  'merc_scout_sleeve_R',
  'merc_scout_trousers',
];

const FPS = 30;
const GLB_MAGIC = 0x46546c67;

function readGlb(file) {
  const data = readFileSync(file);
  assert.equal(data.readUInt32LE(0), GLB_MAGIC, `${file} is not a GLB file`);
  assert.equal(data.readUInt32LE(4), 2, `${file} is not glTF 2.0`);
  const total = data.readUInt32LE(8);
  assert.equal(total, data.length, `${file} declares a wrong length`);
  let offset = 12;
  let gltf = null;
  let binary = null;
  while (offset < total) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      gltf = JSON.parse(data.subarray(offset + 8, offset + 8 + chunkLength).toString('utf8'));
    } else if (chunkType === 0x004e4942) {
      binary = data.subarray(offset + 8, offset + 8 + chunkLength);
    }
    offset += 8 + chunkLength;
  }
  assert.ok(gltf, `${file} has no JSON chunk`);
  return { gltf, binary, bytes: data.length };
}

/** Read a float accessor out of the binary chunk (all animation data is float). */
function readAccessor(gltf, binary, index) {
  const accessor = gltf.accessors[index];
  assert.equal(accessor.componentType, 5126, `accessor ${index} is not float`);
  const view = gltf.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * 4;
  const values = [];
  for (let element = 0; element < accessor.count; element += 1) {
    const base = start + element * stride;
    const tuple = [];
    for (let component = 0; component < components; component += 1) {
      tuple.push(binary.readFloatLE(base + component * 4));
    }
    values.push(tuple);
  }
  return values;
}

function samplersOf(gltf, animation) {
  return (animation.channels ?? []).map((channel) => ({
    channel,
    input: gltf.accessors[animation.samplers[channel.sampler].input],
    outputIndex: animation.samplers[channel.sampler].output,
  }));
}

function triangleCount(gltf) {
  let total = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.indices !== undefined) {
        total += gltf.accessors[primitive.indices].count / 3;
      } else {
        total += gltf.accessors[primitive.attributes.POSITION].count / 3;
      }
    }
  }
  return total;
}

function animationDurations(gltf) {
  const durations = new Map();
  for (const animation of gltf.animations ?? []) {
    let seconds = 0;
    for (const sampler of animation.samplers ?? []) {
      const accessor = gltf.accessors[sampler.input];
      if (accessor.max) {
        seconds = Math.max(seconds, accessor.max[0]);
      }
    }
    durations.set(animation.name, seconds);
  }
  return durations;
}

function pngSize(file) {
  const header = readFileSync(file).subarray(0, 24);
  assert.equal(header.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

for (const [variant, expected] of Object.entries(VARIANTS)) {
  const glbFile = path.join(MODEL_DIR, 'glb', `merc_scout_${variant}.glb`);
  const fbxFile = path.join(MODEL_DIR, 'fbx', `merc_scout_${variant}.fbx`);

  test(`merc-scout ${variant}: GLB and FBX exist and stay inside the budget`, () => {
    const glbBytes = statSync(glbFile).size;
    assert.ok(glbBytes > 100_000, `${variant} GLB is suspiciously small (${glbBytes} B)`);
    assert.ok(glbBytes <= expected.maxGlbBytes,
      `${variant} GLB is ${(glbBytes / 1024 / 1024).toFixed(2)} MiB, budget is ${expected.maxGlbBytes / 1024 / 1024} MiB`);
    assert.ok(statSync(fbxFile).size > 100_000, `${variant} FBX is too small`);
    const fbx = readFileSync(fbxFile);
    const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    let embeddedMaps = 0;
    for (let offset = fbx.indexOf(pngMagic); offset >= 0; offset = fbx.indexOf(pngMagic, offset + 8)) embeddedMaps++;
    assert.ok(embeddedMaps >= 12, `${variant} FBX must carry its PBR maps (${embeddedMaps} embedded)`);
  });

  test(`merc-scout ${variant}: geometry, rig and materials are complete`, () => {
    const { gltf, binary } = readGlb(glbFile);
    const triangles = triangleCount(gltf);
    assert.ok(triangles <= expected.maxTriangles,
      `${variant} has ${triangles} triangles, budget is ${expected.maxTriangles}`);

    const meshNames = gltf.meshes.map((mesh) => mesh.name).sort();
    assert.deepEqual(meshNames, [...MESHES].sort(), `${variant} mesh set changed`);

    assert.equal(gltf.skins.length, 1, `${variant} must carry exactly one skin`);
    assert.equal(gltf.skins[0].joints.length, expected.bones,
      `${variant} skin has ${gltf.skins[0].joints.length} joints, expected ${expected.bones}`);

    const materialNames = gltf.materials.map((material) => material.name)
      .map((name) => name.replace('merc_scout_', '')).sort();
    assert.deepEqual(materialNames, expected.materials, `${variant} material set changed`);
    assert.ok(binary && binary.length > 0, `${variant} GLB has no binary chunk`);
  });

  test(`merc-scout ${variant}: all eleven clips are present with the authored length`, () => {
    const { gltf } = readGlb(glbFile);
    const durations = animationDurations(gltf);
    assert.equal(durations.size, Object.keys(CLIPS).length,
      `${variant} carries ${durations.size} clips, expected ${Object.keys(CLIPS).length}`);
    for (const [clip, frames] of Object.entries(CLIPS)) {
      const seconds = durations.get(clip);
      assert.ok(seconds !== undefined, `${variant} is missing clip ${clip}`);
      const wanted = (frames - 1) / FPS;
      assert.ok(Math.abs(seconds - wanted) <= 1 / FPS,
        `${variant} clip ${clip} lasts ${seconds}s, expected ${wanted}s`);
    }
  });

  test(`merc-scout ${variant}: looping clips close their seam exactly`, () => {
    const { gltf, binary } = readGlb(glbFile);
    for (const animation of gltf.animations ?? []) {
      if (!LOOPING.has(animation.name)) continue;
      for (const { channel, outputIndex } of samplersOf(gltf, animation)) {
        const values = readAccessor(gltf, binary, outputIndex);
        const first = values[0];
        const last = values[values.length - 1];
        for (let component = 0; component < first.length; component += 1) {
          assert.ok(Math.abs(first[component] - last[component]) < 1e-4,
            `${variant} ${animation.name} does not loop: ${channel.target.path} `
            + `component ${component} starts at ${first[component]} and ends at ${last[component]}`);
        }
      }
    }
  });

  test(`merc-scout ${variant}: no root motion`, () => {
    const { gltf, binary } = readGlb(glbFile);
    const rootIndex = (gltf.nodes ?? []).findIndex((node) => node.name === 'Root');
    assert.ok(rootIndex >= 0, `${variant} has no Root node`);
    for (const animation of gltf.animations ?? []) {
      for (const { channel, outputIndex } of samplersOf(gltf, animation)) {
        if (channel.target.node !== rootIndex || channel.target.path !== 'translation') continue;
        const values = readAccessor(gltf, binary, outputIndex);
        const first = values[0];
        for (const value of values) {
          for (let component = 0; component < first.length; component += 1) {
            assert.ok(Math.abs(value[component] - first[component]) < 1e-5,
              `${variant} ${animation.name} moves the root; clips must be authored in place`);
          }
        }
      }
    }
  });

  test(`merc-scout ${variant}: PBR textures are embedded at the promised size`, () => {
    const { gltf } = readGlb(glbFile);
    const images = gltf.images ?? [];
    assert.ok(images.length >= 12, `${variant} embeds only ${images.length} images`);
    for (const image of images) {
      assert.ok(image.bufferView !== undefined,
        `${variant} keeps image ${image.name} outside the GLB (not embedded)`);
      assert.equal(image.mimeType, 'image/png', `${variant} image ${image.name} is not PNG`);
    }
    const painted = gltf.materials.filter((material) => material.pbrMetallicRoughness?.baseColorTexture);
    assert.ok(painted.length >= 5, `${variant} has only ${painted.length} painted materials`);

    const textured = gltf.materials.filter((material) => material.normalTexture);
    assert.ok(textured.length >= 5, `${variant} has only ${textured.length} normal-mapped materials`);

    const textureDir = path.join(MODEL_DIR, 'textures', variant);
    const files = readdirSync(textureDir).filter((name) => name.endsWith('.png'));
    for (const file of files) {
      const size = pngSize(path.join(textureDir, file));
      const wanted = file.startsWith('Skin')
        ? expected.skinTextureSize
        : expected.textureSize;
      assert.equal(size.width, wanted, `${variant}/${file} is ${size.width} px, expected ${wanted}`);
      assert.equal(size.height, wanted, `${variant}/${file} height is ${size.height} px`);
    }
    assert.ok(files.length >= 12, `${variant} ships only ${files.length} texture files`);
  });

  test(`merc-scout ${variant}: no decoder the engines cannot read`, () => {
    const { gltf } = readGlb(glbFile);
    const extensions = [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])];
    for (const forbidden of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression',
      'KHR_texture_basisu', 'KHR_mesh_quantization']) {
      assert.ok(!extensions.includes(forbidden), `${variant} requires ${forbidden}`);
    }
    assert.ok(!gltf.extensionsRequired || gltf.extensionsRequired.length === 0,
      `${variant} requires extensions: ${gltf.extensionsRequired?.join(', ')}`);
  });
}

/** 3x3 matrix helpers: glTF stores local node transforms, not world positions. */
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function multiply3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function apply3(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

/** World transform of every named node, walking the hierarchy once. */
function nodeTransforms(gltf) {
  const parents = new Map();
  (gltf.nodes ?? []).forEach((node, index) => {
    for (const child of node.children ?? []) parents.set(child, index);
  });
  const cache = new Map();
  const world = (index) => {
    if (cache.has(index)) return cache.get(index);
    const node = gltf.nodes[index];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const scale = node.scale ?? [1, 1, 1];
    const rotation = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
    const local = rotation.map((value, column) => value * scale[column % 3]);
    const parentIndex = parents.get(index);
    const parent = parentIndex === undefined
      ? { matrix: IDENTITY, position: [0, 0, 0] }
      : world(parentIndex);
    const offset = apply3(parent.matrix, node.translation ?? [0, 0, 0]);
    const result = {
      matrix: multiply3(parent.matrix, local),
      position: parent.position.map((value, axis) => value + offset[axis]),
    };
    cache.set(index, result);
    return result;
  };
  const byName = new Map();
  (gltf.nodes ?? []).forEach((node, index) => {
    if (node.name) byName.set(node.name, world(index));
  });
  return byName;
}

for (const variant of Object.keys(VARIANTS)) {
  const glbFile = path.join(MODEL_DIR, 'glb', `merc_scout_${variant}.glb`);

  test(`merc-scout ${variant}: bones follow the anthropometric reference skeleton`, () => {
    const { gltf } = readGlb(glbFile);
    const nodes = nodeTransforms(gltf);
    const position = (name) => {
      const entry = nodes.get(name);
      assert.ok(entry, `${variant} has no bone ${name}`);
      return entry.position;
    };
    const length = (from, to) => {
      const a = position(from);
      const b = position(to);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    const check = (label, built, reference) => {
      const delta = Math.abs(built - reference) / reference;
      assert.ok(delta <= REFERENCE.tolerance,
        `${variant} ${label}: ${built.toFixed(3)} m vs reference ${reference} m `
        + `(${(delta * 100).toFixed(1)} %)`);
    };
    // glTF is Y up, so a height is the Y component.
    check('humerus (UpperArm to LowerArm)', length('UpperArm_L', 'LowerArm_L'), REFERENCE.humerus);
    check('radius (LowerArm to Hand)', length('LowerArm_L', 'Hand_L'), REFERENCE.radius);
    check('femur (UpperLeg to LowerLeg)', length('UpperLeg_L', 'LowerLeg_L'), REFERENCE.femur);
    check('tibia (LowerLeg to Foot)', length('LowerLeg_L', 'Foot_L'), REFERENCE.tibia);
    check('knee height', position('LowerLeg_L')[1], REFERENCE.knee);
    check('ankle height', position('Foot_L')[1], REFERENCE.ankle);
    check('hip joint height', position('UpperLeg_L')[1], REFERENCE.hipJoint);
    check('shoulder height', position('UpperArm_L')[1], REFERENCE.shoulder);
    assert.ok(nodes.has('Eye_L') && nodes.has('Eye_R'),
      `${variant} ships no gaze bones for the eyes`);
  });

  test(`merc-scout ${variant}: stands 1.80 m tall with its soles on the ground`, () => {
    const { gltf } = readGlb(glbFile);
    const nodes = nodeTransforms(gltf);
    let low = [Infinity, Infinity, Infinity];
    let high = [-Infinity, -Infinity, -Infinity];
    (gltf.nodes ?? []).forEach((node) => {
      if (node.mesh === undefined) return;
      const transform = nodes.get(node.name) ?? { matrix: IDENTITY, position: [0, 0, 0] };
      for (const primitive of gltf.meshes[node.mesh].primitives ?? []) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        for (const cornerX of [accessor.min[0], accessor.max[0]]) {
          for (const cornerY of [accessor.min[1], accessor.max[1]]) {
            for (const cornerZ of [accessor.min[2], accessor.max[2]]) {
              const offset = apply3(transform.matrix, [cornerX, cornerY, cornerZ]);
              const point = offset.map((value, axis) => value + transform.position[axis]);
              low = low.map((value, axis) => Math.min(value, point[axis]));
              high = high.map((value, axis) => Math.max(value, point[axis]));
            }
          }
        }
      }
    });
    assert.ok(Number.isFinite(low[1]) && Number.isFinite(high[1]),
      `${variant} carries no POSITION bounds`);
    const height = high[1] - low[1];
    assert.ok(Math.abs(height - REFERENCE.height) <= 0.01,
      `${variant} is ${height.toFixed(3)} m tall, expected ${REFERENCE.height} m`);
    assert.ok(Math.abs(low[1]) <= 0.012,
      `${variant} has its lowest point at ${low[1].toFixed(3)} m instead of 0`);
  });
}
