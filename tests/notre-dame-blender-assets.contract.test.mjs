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
        nodes: 7,
        centerX: -59.31,
        span: { x: 9.5, y: 75.5, z: 44.0 },
        floorY: 0.0,
    },
    '02_nave': {
        nodes: 6,
        centerX: -24.75,
        span: { x: 60.4, y: 34.1, z: 42.6 },
        floorY: -0.8,
    },
    '03_transept': {
        nodes: 8,
        centerX: 12.25,
        span: { x: 17.0, y: 41.9, z: 50.5 },
        floorY: -0.8,
    },
    '04_choir_apse': {
        nodes: 7,
        centerX: 41.76,
        span: { x: 45.4, y: 34.1, z: 41.7 },
        floorY: -0.8,
    },
    '05_buttresses': {
        nodes: 4,
        centerX: 5.15,
        span: { x: 117.2, y: 30.7, z: 52.6 },
        floorY: 0.0,
    },
    '06_roof_fleche': {
        nodes: 6,
        centerX: 4.5,
        span: { x: 118.5, y: 82.1, z: 48.0 },
        floorY: 14.06,
    },
    '07_parvis_island': {
        nodes: 6,
        centerX: -22.0,
        span: { x: 259.5, y: 12.0, z: 172.0 },
        floorY: -1.8,
    },
});

// The reconstruction site. These are the meshes collision has to follow every frame, so they
// keep the same 6000 triangle budget the other animated maps use rather than the architecture
// budget above. Every loop is a whole multiple of one six second beat, which is what lets the
// preset offset them against each other into a single rhythm.
const BEAT_SECONDS = 6;
const TRIANGLE_BUDGET_PER_SETPIECE = 6_000;
const SETPIECES = Object.freeze({
    '10_tower_crane': { clip: 'TowerCraneLoop', duration: 24, landmark: 'tower_crane_base_signal' },
    '11_scaffold_lift': { clip: 'ScaffoldLiftLoop', duration: 6, landmark: 'scaffold_lift_foot_signal' },
    '12_stone_hoist': { clip: 'StoneHoistLoop', duration: 6, landmark: 'stone_hoist_beam_signal' },
    '13_fleche_hoist': { clip: 'FlecheHoistLoop', duration: 12, landmark: 'fleche_hoist_cradle_signal' },
    '14_tarpaulin_wall': { clip: 'TarpaulinWallLoop', duration: 12, landmark: 'tarpaulin_wall_head_signal' },
    '15_vault_gantry': { clip: 'VaultGantryLoop', duration: 12, landmark: 'gantry_cradle' },
    '16_bell_swing': { clip: 'BellSwingLoop', duration: 6, landmark: 'bell_frame_signal' },
    '17_rose_ring': { clip: 'RoseRingLoop', duration: 12, landmark: 'rose_ring_hub_signal' },
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
        assert.ok(glbSize > 10_000, `${name} exports a non-empty GLB`);
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

    for (const name of Object.keys(SETPIECES)) {
        totalGlbBytes += statSync(path.join(ASSET_ROOT, 'glb', `${name}.glb`)).size;
    }

    assert.ok(
        totalGlbBytes <= TOTAL_GLB_BUDGET_BYTES,
        `Notre-Dame GLBs stay within ${TOTAL_GLB_BUDGET_BYTES} bytes (got ${totalGlbBytes})`,
    );
});

test('the reconstruction site loops on the shared beat and separates its collision', () => {
    for (const [name, expected] of Object.entries(SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps its editable Blender source`);
        assert.ok(statSync(glbPath).size > 10_000, `${name} exports a non-empty GLB`);

        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1, `${name} exports exactly one animation`);
        assert.equal(document.animations[0].name, expected.clip, `${name} keeps its clip name`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expected.duration) <= (1 / 30),
            `${name} keeps its ${expected.duration}s loop`,
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
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET_PER_SETPIECE,
            `${name} stays within the ${TRIANGLE_BUDGET_PER_SETPIECE} triangle budget`,
        );

        // The split that makes the map affordable: a moving mesh gets a collider, so exactly
        // one coarse body per moving part carries collision while the detail rides along as
        // _nocol. Without both halves the setpiece either collides against nothing or makes
        // the physics chase every rope and lamp.
        const animated = animatedMeshNames(document);
        assert.ok(
            animated.some((nodeName) => !/_nocol$/i.test(nodeName)),
            `${name} retains a coarse animated collision mesh`,
        );
        assert.ok(
            animated.some((nodeName) => /_nocol$/i.test(nodeName)),
            `${name} separates animated visual detail from collision`,
        );
    }
});

test('the sheeting opens one bay at a time instead of everywhere at once', () => {
    const glb = readGlb(path.join(ASSET_ROOT, 'glb', '14_tarpaulin_wall.glb'));
    const duration = SETPIECES['14_tarpaulin_wall'].duration;
    const moments = openingMoments(glb);

    assert.equal(moments.length, 7, 'all seven bays are animated');
    assert.ok(moments.every((entry) => entry.travel > 0.5), 'every bay actually draws aside');

    // If every bay opened at the same moment the hoarding would be a blinking wall rather than
    // a traveling gap, and a player could not learn where to be. Evenly spaced moments are what
    // makes the position learnable.
    const times = moments.map((entry) => entry.time).sort((left, right) => left - right);
    assert.equal(
        new Set(times.map((time) => time.toFixed(3))).size,
        7,
        `the sheeting opens at seven distinct moments, got ${times.join(', ')}`,
    );
    const expectedStride = duration / 7;
    for (let index = 1; index < times.length; index += 1) {
        const stride = times[index] - times[index - 1];
        assert.ok(
            Math.abs(stride - expectedStride) <= expectedStride * 0.25,
            `the sheeting keeps an even stride near ${expectedStride.toFixed(2)}s, got ${stride.toFixed(2)}s`,
        );
    }
});

test('the hoarding stands across the approach instead of along it', () => {
    const glb = readGlb(path.join(ASSET_ROOT, 'glb', '14_tarpaulin_wall.glb'));

    // glTF X runs along the building, which is the line a run flies in on from the river, and
    // glTF Z runs across it. A barrier meant to be flown through has to be wide across and thin
    // along. Built the other way round it hangs edge-on in the flight line: its face is never in
    // front of anyone, its sheets lie on the route for their whole length, and the traveling gap
    // opens along the flight path instead of across it.
    const box = boundingBox(glb.document);
    assert.ok(
        box.span.z > box.span.x * 4,
        `the hoarding spans wider across the approach (${box.span.z.toFixed(1)} m) `
        + `than along it (${box.span.x.toFixed(1)} m)`,
    );

    // The same rule for the movement: each bay draws aside across the approach, so the opening
    // walks along the face a player is looking at.
    const travels = openingTravels(glb);
    assert.equal(travels.length, 7, 'all seven bays are animated');
    for (const entry of travels) {
        assert.ok(
            Math.abs(entry.offset[2]) > Math.abs(entry.offset[0]) * 4,
            `${entry.node} draws aside across the approach, `
            + `got along=${entry.offset[0].toFixed(2)} across=${entry.offset[2].toFixed(2)}`,
        );
    }
});

test('the crane and the rose scaffold carry their gap around instead of opening one', () => {
    // Two setpieces state the rule the other way round: nothing opens or shuts, the whole
    // assembly turns and the way past it travels with it. Both animate exactly one rig.
    for (const [name, rig] of [['10_tower_crane', 'CraneSlew'], ['17_rose_ring', 'RoseScaffoldRing']]) {
        const { document } = readGlb(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
        const channels = document.animations[0].channels;
        assert.equal(channels.length, 1, `${name} turns as a single rig`);
        assert.equal(document.nodes[channels[0].target.node].name, rig);
        assert.equal(
            channels[0].target.path,
            'rotation',
            `${name} carries its gap around by turning`,
        );
    }
});

test('the bells and the stone slings run on staggered phases', () => {
    // A peal never swings as one, and a row of blocks that swung together would be a wall with
    // no line through it. Both rely on their elements being out of phase with each other.
    for (const [name, expectedCount] of [['16_bell_swing', 3], ['12_stone_hoist', 5]]) {
        const moments = openingMoments(readGlb(path.join(ASSET_ROOT, 'glb', `${name}.glb`)));
        assert.equal(moments.length, expectedCount, `${name} animates all ${expectedCount} elements`);
        assert.ok(moments.every((entry) => entry.travel > 0.05), `${name} actually moves every element`);

        // Every element has to reach its extreme at its own moment. Anything less than one
        // distinct moment per element means two of them swing together, and the group turns
        // back into a solid row at that instant.
        const times = moments.map((entry) => entry.time);
        assert.equal(
            new Set(times.map((time) => time.toFixed(3))).size,
            expectedCount,
            `${name} reaches its extremes at ${expectedCount} distinct moments, got ${times.join(', ')}`,
        );
    }
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
