import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ASSET_ROOT = path.resolve('assets/maps/verdant_aperture');
const TOTAL_GLB_BUDGET_BYTES = 2 * 1024 * 1024;
const TRIANGLE_BUDGET_PER_SETPIECE = 6000;
const BEAT_SECONDS = 6;

const SETPIECES = Object.freeze({
    '01_leaf_shutter': { clip: 'LeafShutterLoop', duration: 6, landmark: 'leaf_shutter_hub_signal' },
    '02_bloom_iris': { clip: 'BloomIrisLoop', duration: 12, landmark: 'bloom_iris_calyx_signal' },
    '03_root_arch': { clip: 'RootArchLoop', duration: 6, landmark: 'root_arch_floor_signal' },
    '04_canopy_drift': { clip: 'CanopyDriftLoop', duration: 12, landmark: 'canopy_drift_rail_signal' },
    '05_glass_louvre': { clip: 'GlassLouvreLoop', duration: 12, landmark: 'glass_louvre_ridge_signal' },
    '06_pollen_mill': { clip: 'PollenMillLoop', duration: 6, landmark: 'pollen_mill_hub_signal' },
    '07_vine_gate': { clip: 'VineGateLoop', duration: 24, landmark: 'vine_gate_post_signal' },
    '08_heart_seed': { clip: 'HeartSeedLoop', duration: 12, landmark: 'heart_seed_plinth_signal' },
});

// The setpieces built from the traveling-opening rule: every element owns one slot of the loop
// and steps aside during it, so the hole walks along the barrier exactly once per loop.
const TRAVELING_OPENINGS = Object.freeze({
    '01_leaf_shutter': 8,
    '02_bloom_iris': 6,
    '03_root_arch': 7,
    '05_glass_louvre': 9,
    '07_vine_gate': 6,
});

const COMPONENTS_PER_TYPE = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 });
const CHUNK_TYPE_BIN = 0x004e4942;
const COMPONENT_TYPE_FLOAT = 5126;

function readGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with JSON`);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());

    let offset = 20 + jsonLength;
    let binary = null;
    while (offset < bytes.length) {
        const chunkLength = bytes.readUInt32LE(offset);
        if (bytes.readUInt32LE(offset + 4) === CHUNK_TYPE_BIN) {
            binary = bytes.subarray(offset + 8, offset + 8 + chunkLength);
        }
        offset += 8 + chunkLength;
    }
    return { document, binary };
}

/** Reads a float accessor into rows, so animation times and values can be compared directly. */
function readFloatAccessor({ document, binary }, accessorIndex) {
    const accessor = document.accessors[accessorIndex];
    assert.equal(accessor.componentType, COMPONENT_TYPE_FLOAT, 'animation data is float encoded');
    const bufferView = document.bufferViews[accessor.bufferView];
    const componentCount = COMPONENTS_PER_TYPE[accessor.type];
    const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

    const rows = [];
    for (let index = 0; index < accessor.count; index += 1) {
        const row = [];
        for (let component = 0; component < componentCount; component += 1) {
            row.push(binary.readFloatLE(start + (index * componentCount + component) * 4));
        }
        rows.push(row);
    }
    return rows;
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

function animatedMeshNames(document) {
    const nodes = document.nodes || [];
    const names = new Set();
    const collect = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(String(node.name || ''));
        for (const child of node.children || []) collect(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (['translation', 'rotation', 'scale'].includes(channel.target?.path)) {
                collect(channel.target.node);
            }
        }
    }
    return [...names];
}

function triangleCount(document) {
    let count = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
            const accessorCount = Number(document.accessors?.[accessorIndex]?.count) || 0;
            count += accessorCount / 3;
        }
    }
    return count;
}

/**
 * The moment in the loop at which a rig is furthest from its resting pose — in other words, when
 * its element stands aside and the hole is in front of it.
 */
function openingMoments(glb) {
    const { document } = glb;
    const animation = document.animations[0];
    return animation.channels.map((channel) => {
        const sampler = animation.samplers[channel.sampler];
        const times = readFloatAccessor(glb, sampler.input).map((row) => row[0]);
        const values = readFloatAccessor(glb, sampler.output);
        const resting = values[0];

        let widest = 0;
        let widestTime = 0;
        values.forEach((value, index) => {
            const distance = Math.hypot(...value.map((entry, axis) => entry - resting[axis]));
            if (distance > widest) {
                widest = distance;
                widestTime = times[index];
            }
        });
        return { node: String(document.nodes[channel.target.node]?.name || ''), time: widestTime, travel: widest };
    });
}

test('Verdant Aperture keeps editable Blender sources and loader-compatible beat loops', () => {
    let totalGlbBytes = 0;

    for (const [name, expected] of Object.entries(SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps its editable Blender source`);
        const glbSize = statSync(glbPath).size;
        assert.ok(glbSize > 10_000, `${name} exports a non-empty GLB`);
        totalGlbBytes += glbSize;

        const { document } = readGlb(glbPath);
        assert.equal(document.animations?.length, 1, `${name} exports exactly one animation`);
        assert.equal(document.animations[0].name, expected.clip, `${name} keeps its runtime clip name`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expected.duration) <= (1 / 30),
            `${name} keeps its ${expected.duration}s duration`,
        );
        assert.equal(
            expected.duration % BEAT_SECONDS,
            0,
            `${name} loops on a whole multiple of the ${BEAT_SECONDS}s beat`,
        );
        assert.ok(
            (document.nodes || []).some((node) => node.name === expected.landmark),
            `${name} contains its readability landmark ${expected.landmark}`,
        );

        const animated = animatedMeshNames(document);
        assert.ok(
            animated.some((nodeName) => !/_nocol$/i.test(nodeName)),
            `${name} retains a coarse animated collision mesh`,
        );
        assert.ok(
            animated.some((nodeName) => /_nocol$/i.test(nodeName)),
            `${name} separates animated visual detail from collision`,
        );
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET_PER_SETPIECE,
            `${name} stays within the ${TRIANGLE_BUDGET_PER_SETPIECE} triangle budget`,
        );
    }

    assert.ok(
        totalGlbBytes <= TOTAL_GLB_BUDGET_BYTES,
        `Verdant Aperture GLBs stay within ${TOTAL_GLB_BUDGET_BYTES} bytes (got ${totalGlbBytes})`,
    );
});

test('the opening travels along each barrier instead of opening everywhere at once', () => {
    for (const [name, elementCount] of Object.entries(TRAVELING_OPENINGS)) {
        const glb = readGlb(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
        const duration = SETPIECES[name].duration;
        const moments = openingMoments(glb);

        assert.equal(moments.length, elementCount, `${name} animates all ${elementCount} elements`);
        assert.ok(moments.every((entry) => entry.travel > 0.05), `${name} actually moves every element`);

        // This is the rule the whole map is built on. If every element stepped aside at the same
        // moment the barrier would be a blinking wall, not a traveling hole, and the level would
        // stop being readable. Evenly spaced moments are what makes the position learnable.
        const times = moments.map((entry) => entry.time).sort((left, right) => left - right);
        assert.equal(
            new Set(times.map((time) => time.toFixed(3))).size,
            elementCount,
            `${name} opens at ${elementCount} distinct moments, got ${times.join(', ')}`,
        );

        const expectedStride = duration / elementCount;
        for (let index = 1; index < times.length; index += 1) {
            const stride = times[index] - times[index - 1];
            assert.ok(
                Math.abs(stride - expectedStride) <= expectedStride * 0.25,
                `${name} keeps an even stride near ${expectedStride.toFixed(2)}s, got ${stride.toFixed(2)}s`,
            );
        }
    }
});

test('the sliding curtain and the mill carry their gap instead of opening a slot', () => {
    // Two setpieces state the same rule differently: the gap is a missing element, and moving the
    // whole assembly moves the gap with it. Both animate exactly one rig for that reason.
    const curtain = openingMoments(readGlb(path.join(ASSET_ROOT, 'glb', '04_canopy_drift.glb')));
    assert.equal(curtain.length, 1, 'the canopy curtain moves as one piece');
    assert.equal(curtain[0].node, 'CanopyCurtain');
    assert.ok(curtain[0].travel >= 5, `the curtain sweeps its gap across the hall, got ${curtain[0].travel}`);

    const mill = readGlb(path.join(ASSET_ROOT, 'glb', '06_pollen_mill.glb'));
    const millChannels = mill.document.animations[0].channels;
    assert.equal(millChannels.length, 1, 'the pollen mill turns as one rotor');
    assert.equal(mill.document.nodes[millChannels[0].target.node].name, 'PollenRotor');
    assert.equal(millChannels[0].target.path, 'rotation', 'the mill carries its gap around by turning');
});
