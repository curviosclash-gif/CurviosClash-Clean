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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(ROOT, 'assets', 'models', 'characters', 'merc_scout');

/** What each variant promises. Mirrors scripts/merc_scout/spec.py. */
const VARIANTS = {
  mobile: {
    maxTriangles: 15000,
    maxGlbBytes: 6 * 1024 * 1024,
    bones: 43,
    fingerSegments: 2,
    textureSize: 1024,
    skinTextureSize: 1024,
    materials: ['Eye', 'Hair', 'Jacket', 'Leather', 'Skin', 'Trousers'],
  },
  pc: {
    maxTriangles: 45000,
    maxGlbBytes: 24 * 1024 * 1024,
    bones: 53,
    fingerSegments: 3,
    textureSize: 2048,
    skinTextureSize: 2048,
    materials: ['Accent', 'Eye', 'Hair', 'Jacket', 'Leather', 'Metal', 'Skin', 'Trousers'],
  },
  high: {
    maxTriangles: 120000,
    maxGlbBytes: 64 * 1024 * 1024,
    bones: 53,
    fingerSegments: 3,
    textureSize: 2048,
    skinTextureSize: 4096,
    materials: ['Accent', 'Eye', 'Hair', 'Jacket', 'Leather', 'Metal', 'Skin', 'Trousers'],
  },
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
