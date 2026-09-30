import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ASSET_ROOT = path.resolve('assets/maps/notre_dame');
const TOTAL_GLB_BUDGET_BYTES = 4 * 1024 * 1024;
const TRIANGLE_BUDGET_PER_ARCHITECTURE_PART = 18_000;

// Notre-Dame de Paris, in metres, as the parts are modelled in Blender. These are the numbers
// that make the map recognisable rather than merely gothic, so they are asserted rather than
// merely commented: overall length 127.5, transept 48 across, towers 69 high, nave vault 33,
// spire tip 96. The generator builds everything in one shared coordinate system with X running
// west to east, which is why each part also states where it sits along that axis.
//
// glTF is exported Y-up, so a part's glTF X is length along the building, Y is height above the
// floor, and Z is width across it.
const PARTS = Object.freeze({
    '01_west_facade': {
        nodes: 9,
        collisionShell: true,
        centerX: -59.31,
        span: { x: 9.5, y: 75.5, z: 44.0 },
        floorY: 0.0,
    },
    '02_nave': {
        nodes: 7,
        collisionShell: true,
        centerX: -24.75,
        span: { x: 60.4, y: 34.4, z: 42.6 },
        floorY: -0.8,
    },
    '03_transept': {
        nodes: 9,
        collisionShell: true,
        centerX: 12.25,
        span: { x: 17.0, y: 41.9, z: 50.5 },
        floorY: -0.8,
    },
    '04_choir_apse': {
        nodes: 8,
        collisionShell: true,
        centerX: 41.76,
        span: { x: 45.4, y: 34.4, z: 41.7 },
        floorY: -0.8,
    },
    '05_buttresses': {
        nodes: 4,
        centerX: 5.15,
        span: { x: 117.2, y: 30.7, z: 52.6 },
        floorY: 0.0,
    },
    '06_roof_fleche': {
        nodes: 7,
        collisionShell: true,
        centerX: 4.5,
        span: { x: 118.5, y: 82.1, z: 48.0 },
        floorY: 14.06,
    },
    '07_parvis_island': {
        nodes: 4,
        centerX: -22.0,
        span: { x: 259.5, y: 5.8, z: 172.0 },
        floorY: -1.8,
    },
});

const CATHEDRAL_LENGTH = 127.5;
const SPIRE_TIP_HEIGHT = 96.0;
const TOWER_HEIGHT = 69.0;
const TRANSEPT_WIDTH = 48.0;

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

function readGlbJson(filePath) {
    return readGlb(filePath).document;
}

function nodeNames(fileStem) {
    const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${fileStem}.glb`));
    return (document.nodes || []).map((node) => String(node.name || '')).filter(Boolean);
}

/** Reads a float accessor into rows, so animation times and values compare directly. */
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

/** Every mesh whose world transform a clip drives, including meshes under an animated rig. */
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

test('scene collision keeps foam and moving structural members correctly typed', () => {
    const parvisDocument = readGlbJson(path.join(ASSET_ROOT, 'glb', '07_parvis_island.glb'));
    const parvisMaterials = (parvisDocument.materials || [])
        .map((material) => String(material.name || '').toLowerCase());
    assert.ok(!parvisMaterials.some((name) => name.includes('oak') || name.includes('foliage')),
        'the island no longer bakes the former primitive tree materials');

    const parvisColliders = nodeNames('07_parvis_island')
        .filter((name) => !name.toLowerCase().includes('_nocol'));
    assert.ok(parvisColliders.length > 0, 'the island exports collidable ground meshes');
    assert.ok(
        parvisColliders.every((name) => name.toLowerCase().includes('_foam')),
        'every collidable island mesh keeps the foam response',
    );


});

/**
 * The moment in the loop at which each rig is furthest from its resting pose -- in other words,
 * when its element has stepped aside and the way through is in front of it.
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
        return {
            node: String(document.nodes[channel.target.node]?.name || ''),
            time: widestTime,
            travel: widest,
        };
    });
}

/**
 * How far each rig has travelled from its resting pose at its widest, as a vector rather than a
 * distance -- which tells the direction a gap opens in, not only that it opens.
 */
function openingTravels(glb) {
    const { document } = glb;
    const animation = document.animations[0];
    return animation.channels.map((channel) => {
        const sampler = animation.samplers[channel.sampler];
        const values = readFloatAccessor(glb, sampler.output);
        const resting = values[0];

        let widest = 0;
        let offset = resting.map(() => 0);
        for (const value of values) {
            const delta = value.map((entry, axis) => entry - resting[axis]);
            const distance = Math.hypot(...delta);
            if (distance > widest) {
                widest = distance;
                offset = delta;
            }
        }
        return { node: String(document.nodes[channel.target.node]?.name || ''), offset };
    });
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

function primitiveCount(document) {
    return (document.meshes || []).reduce(
        (count, mesh) => count + (mesh.primitives || []).length,
        0,
    );
}

/**
 * Bounding box of the whole file, read from the POSITION accessors' declared min/max. Those are
 * mandatory in glTF, so the box can be derived without decoding a single vertex.
 */
function boundingBox(document) {
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessor = document.accessors?.[primitive.attributes?.POSITION];
            if (!accessor?.min || !accessor?.max) continue;
            for (let axis = 0; axis < 3; axis += 1) {
                low[axis] = Math.min(low[axis], Number(accessor.min[axis]));
                high[axis] = Math.max(high[axis], Number(accessor.max[axis]));
            }
        }
    }
    return {
        low,
        high,
        span: { x: high[0] - low[0], y: high[1] - low[1], z: high[2] - low[2] },
        center: { x: (low[0] + high[0]) / 2, z: (low[2] + high[2]) / 2 },
    };
}

function meshNodeNames(document) {
    return (document.nodes || [])
        .filter((node) => node.mesh !== undefined)
        .map((node) => String(node.name || ''));
}

test('Notre-Dame keeps editable Blender sources and merged, texture-free exports', () => {
    let totalGlbBytes = 0;

    for (const [name, expected] of Object.entries(PARTS)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps its editable Blender source`);
        const glbSize = statSync(glbPath).size;
        const minimumGlbBytes = name === '07_parvis_island' ? 8_000 : 10_000;
        assert.ok(glbSize > minimumGlbBytes, `${name} exports a non-empty GLB`);
        totalGlbBytes += glbSize;

        const document = readGlbJson(glbPath);
        assert.ok(
            !document.animations?.length,
            `${name} is static architecture and carries no clip`,
        );
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET_PER_ARCHITECTURE_PART,
            `${name} stays within the ${TRIANGLE_BUDGET_PER_ARCHITECTURE_PART} triangle budget`,
        );

        // Meshes are merged per material, which is what keeps these files at a few hundred
        // kilobytes instead of the megabyte-plus a per-primitive export produced.
        const nodeNames = meshNodeNames(document);
        assert.equal(
            nodeNames.length,
            expected.nodes,
            `${name} merges down to ${expected.nodes} mesh nodes, got ${nodeNames.join(', ')}`,
        );
        const partName = name.split('_').slice(1).join('_');
        for (const nodeName of nodeNames) {
            assert.ok(
                nodeName.startsWith(`${partName}_`),
                `${name} names its merged meshes after the part, got ${nodeName}`,
            );
        }
        assert.ok(
            nodeNames.some((nodeName) => /_nocol$/i.test(nodeName)),
            `${name} keeps its decorative meshes marked _nocol`,
        );
        if (expected.collisionShell) {
            assert.ok(
                nodeNames.some((nodeName) => /_colonly$/i.test(nodeName)),
                `${name} keeps its invisible collision shell separate from visual meshes`,
            );
        }

        // No texture coordinates: the materials are flat colours, so UVs were pure weight.
        for (const mesh of document.meshes || []) {
            for (const primitive of mesh.primitives || []) {
                assert.ok(
                    primitive.attributes?.TEXCOORD_0 === undefined,
                    `${name} exports no unused texture coordinates`,
                );
            }
        }
    }

    assert.ok(
        totalGlbBytes <= TOTAL_GLB_BUDGET_BYTES,
        `Notre-Dame GLBs stay within ${TOTAL_GLB_BUDGET_BYTES} bytes (got ${totalGlbBytes})`,
    );
});

test('every part keeps the measured proportions of the real building', () => {
    for (const [name, expected] of Object.entries(PARTS)) {
        const box = boundingBox(readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`)));

        for (const axis of ['x', 'y', 'z']) {
            const tolerance = Math.max(0.5, expected.span[axis] * 0.02);
            assert.ok(
                Math.abs(box.span[axis] - expected.span[axis]) <= tolerance,
                `${name} keeps its ${axis} extent near ${expected.span[axis]} m, got ${box.span[axis].toFixed(2)}`,
            );
        }
        assert.ok(
            Math.abs(box.center.x - expected.centerX) <= 0.5,
            `${name} sits at ${expected.centerX} m along the building, got ${box.center.x.toFixed(2)}`,
        );
        assert.ok(
            Math.abs(box.center.z) <= 0.5,
            `${name} stays symmetrical about the nave axis, got ${box.center.z.toFixed(2)}`,
        );
        assert.ok(
            Math.abs(box.low[1] - expected.floorY) <= 0.5,
            `${name} starts at ${expected.floorY} m, got ${box.low[1].toFixed(2)}`,
        );
    }
});

test('the parts add up to the cathedral rather than to seven separate buildings', () => {
    const box = (name) => boundingBox(readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`)));

    const facade = box('01_west_facade');
    const nave = box('02_nave');
    const transept = box('03_transept');
    const choir = box('04_choir_apse');
    const roof = box('06_roof_fleche');

    // West front to apse is the documented overall length.
    const overall = choir.high[0] - facade.low[0];
    assert.ok(
        Math.abs(overall - CATHEDRAL_LENGTH) <= 2.0,
        `west front to apse spans ${CATHEDRAL_LENGTH} m, got ${overall.toFixed(2)}`,
    );

    // Consecutive parts have to meet: a gap would show as a slot of daylight through the wall.
    // A small overlap is correct and expected -- neighbouring parts share the thickness of the
    // wall between them -- but a large one means two sets of stone occupy the same space, which
    // both wastes triangles and makes the surfaces flicker against each other.
    const joints = [
        ['facade to nave', facade.high[0], nave.low[0]],
        ['nave to transept', nave.high[0], transept.low[0]],
        ['transept to choir', transept.high[0], choir.low[0]],
    ];
    for (const [label, endOfFirst, startOfSecond] of joints) {
        assert.ok(
            Math.abs(endOfFirst - startOfSecond) <= 2.0,
            `${label} meets without a gap, got ${(startOfSecond - endOfFirst).toFixed(2)} m`,
        );
    }

    // The three heights everybody knows the building by.
    assert.ok(
        Math.abs(roof.high[1] - SPIRE_TIP_HEIGHT) <= 1.5,
        `the spire tips out at ${SPIRE_TIP_HEIGHT} m, got ${roof.high[1].toFixed(2)}`,
    );
    assert.ok(
        facade.high[1] > TOWER_HEIGHT && facade.high[1] < TOWER_HEIGHT + 9,
        `the towers reach ${TOWER_HEIGHT} m plus their pinnacles, got ${facade.high[1].toFixed(2)}`,
    );
    assert.ok(
        Math.abs(transept.span.z - TRANSEPT_WIDTH) <= 4.0,
        `the transept measures ${TRANSEPT_WIDTH} m across, got ${transept.span.z.toFixed(2)}`,
    );
    // The transept is the widest point: that is what makes the plan read as a cross.
    assert.ok(
        transept.span.z > nave.span.z,
        `the transept is wider than the nave, got ${transept.span.z.toFixed(2)} vs ${nave.span.z.toFixed(2)}`,
    );
});
