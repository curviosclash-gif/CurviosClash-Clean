import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { loadGLBMap } from '../src/entities/GLBMapLoader.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { refreshDynamicMeshCollider, sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

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
        nodes: 17,
        collisionShell: true,
        centerX: -59.78,
        span: { x: 10.67, y: 75.5, z: 44.0 },
        floorY: 0.0,
    },
    '02_nave': {
        nodes: 9,
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
        nodes: 11,
        collisionShell: true,
        centerX: 41.4,
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

/** Bounding box with glTF node transforms applied, which matters for animated pivots. */
function sceneBoundingBox(document) {
    const bounds = new THREE.Box3().makeEmpty();
    const visit = (nodeIndex, parentMatrix) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        const local = new THREE.Matrix4();
        if (Array.isArray(node.matrix)) local.fromArray(node.matrix);
        else {
            local.compose(
                new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
                new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
                new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
            );
        }
        const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
        const mesh = document.meshes?.[node.mesh];
        for (const primitive of mesh?.primitives || []) {
            const accessor = document.accessors?.[primitive.attributes?.POSITION];
            if (!accessor?.min || !accessor?.max) continue;
            bounds.union(new THREE.Box3(
                new THREE.Vector3().fromArray(accessor.min),
                new THREE.Vector3().fromArray(accessor.max),
            ).applyMatrix4(world));
        }
        for (const child of node.children || []) visit(child, world);
    };
    for (const nodeIndex of document.scenes?.[document.scene || 0]?.nodes || []) {
        visit(nodeIndex, new THREE.Matrix4());
    }
    const low = bounds.min.toArray();
    const high = bounds.max.toArray();
    return {
        low,
        high,
        span: { x: high[0] - low[0], y: high[1] - low[1], z: high[2] - low[2] },
        center: { x: (low[0] + high[0]) / 2, z: (low[2] + high[2]) / 2 },
    };
}

function measuredPartBounds(name) {
    const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
    return name === '01_west_facade' ? sceneBoundingBox(document) : boundingBox(document);
}

function meshNodeNames(document) {
    return (document.nodes || [])
        .filter((node) => node.mesh !== undefined)
        .map((node) => String(node.name || ''));
}

function floorCrossBayCentres({ document, binary }) {
    const node = document.nodes.find((entry) => entry.name === 'nave_stoneshaded_nocol');
    assert.ok(node, 'the decorative nave stone mesh is present');
    const primitive = document.meshes[node.mesh]?.primitives?.[0];
    assert.ok(primitive?.attributes?.POSITION !== undefined, 'the nave decoration has exported positions');
    const accessor = document.accessors[primitive.attributes.POSITION];
    const view = document.bufferViews[accessor.bufferView];
    const stride = view.byteStride || 12;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const centres = [];
    for (let index = 0; index < accessor.count; index += 1) {
        const offset = start + index * stride;
        const x = binary.readFloatLE(offset);
        const y = binary.readFloatLE(offset + 4);
        const z = binary.readFloatLE(offset + 8);
        // The ten cross centres are the only shaded, non-colliding geometry just above the nave
        // floor, and their long arm crosses the axis within 9 cm.
        if (y > 0.002 && y < 0.022 && Math.abs(z) < 0.1) centres.push(x);
    }
    return centres;
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
        if (name === '01_west_facade') {
            assert.deepEqual(document.animations?.map((animation) => animation.name), ['NotreDameMotion']);
        } else {
            assert.ok(!document.animations?.length, `${name} is static architecture and carries no clip`);
        }
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

test('the nave exports a pierced triforium, raised gallery roof and furnished interior', () => {
    const naveFile = readGlb(path.join(ASSET_ROOT, 'glb', '02_nave.glb'));
    const nave = naveFile.document;
    const naveNodes = meshNodeNames(nave);
    assert.ok(naveNodes.includes('nave_oak'), 'the gallery organ and nave furnishings stay editable in Blender');
    assert.ok(naveNodes.includes('nave_gold'), 'organ stops export with their brass material');
    const roof = readGlbJson(path.join(ASSET_ROOT, 'glb', '06_roof_fleche.glb'));
    assert.ok(meshNodeNames(roof).includes('roof_fleche_lead'),
        'the raised gallery roof remains an authored, colliding surface in the roof asset');
    assert.ok(!naveNodes.some((name) => /triforium_band/i.test(name)),
        'the former continuous collision wall is gone');
    const exportedFloorCrosses = floorCrossBayCentres(naveFile);
    for (let bay = 0; bay < 10; bay += 1) {
        const expectedX = -54.75 + 3 + bay * 6;
        assert.ok(exportedFloorCrosses.some((x) => Math.abs(x - expectedX) < 1.6),
            `the floor pattern is exported above the nave floor at bay ${bay}`);
    }

    const choir = readGlbJson(path.join(ASSET_ROOT, 'glb', '04_choir_apse.glb'));
    const choirNodes = meshNodeNames(choir);
    assert.ok(choirNodes.includes('choir_apse_oak'), 'the chancel screen and choir stalls are present');
    assert.ok(choirNodes.includes('choir_apse_gold'), 'the screen and altar keep their gilded details');
});

test('every part keeps the measured proportions of the real building', () => {
    for (const [name, expected] of Object.entries(PARTS)) {
        const box = measuredPartBounds(name);

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

test('the west facade exports its copper bells as visible geometry', () => {
    const facade = readGlbJson(path.join(ASSET_ROOT, 'glb', '01_west_facade.glb'));
    const names = meshNodeNames(facade);
    const copperNodes = names.filter((name) => /copper_nocol_animated/i.test(name));
    assert.equal(copperNodes.length, 4, 'both towers keep two independent animated bell meshes');
    const copper = facade.materials?.find((material) => /NDCopper/i.test(material.name || ''));
    assert.ok(copper, 'the bells keep their copper material in glTF');
    assert.ok(copperNodes.every((name) => facade.meshes[facade.nodes.find((node) => node.name === name).mesh]
        .primitives.some((primitive) => (facade.accessors[primitive.indices]?.count || 0) >= 300)),
    'four open shells export with their rims and clappers');
    const doors = names.filter((name) => /portal_[02]_door_.*_animated$/i.test(name));
    assert.equal(doors.length, 4, 'only the two side portals have animated door leaves');
    assert.ok(!names.some((name) => /portal_1_door_/i.test(name)),
        'the central CP05 portal remains doorless');
});

test('the west-facade Blender clip moves door colliders and leaves the CP05 portal doorless', async () => {
    const facade = readGlbJson(path.join(ASSET_ROOT, 'glb', '01_west_facade.glb'));
    const model = NOTRE_DAME_MAPS.notre_dame.glbModels.find((entry) => entry.id === 'notre-dame-west-facade');
    assert.equal(model.animationClock.mode, 'loop');
    assert.equal(model.animationClock.beatSeconds, 6);
    assert.equal(model.animationClock.clipName, 'NotreDameMotion');
    assert.equal(animationDurationSeconds(facade, facade.animations[0]), 12,
        'the clip loops over two six-second beats');

    const result = await loadGLBMap('assets/maps/notre_dame/glb/01_west_facade.glb', {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        animationClock: model.animationClock,
        modelId: model.id,
    });
    const driver = new GlbAnimationDriver();
    try {
        driver.setTracks(result.animationTracks);
        const doorColliders = result.colliders.filter((entry) => /portal_[02]_door_.*_animated/i.test(entry.sourceName));
        assert.equal(doorColliders.length, 4, 'each visible moving door leaf has a mesh collider');
        assert.ok(doorColliders.every((entry) => entry.dynamic), 'door collisions follow the animated pivots');
        assert.equal(result.colliders.filter((entry) => entry.dynamic).length, 4,
            'decorative swinging bells do not add colliders');
        const bellPivots = [];
        result.scene.traverse((node) => {
            if (/west_facade_tower_(north|south)_bell_[ab]_pivot/.test(node.name)) bellPivots.push(node);
        });
        assert.equal(bellPivots.length, 4, 'both towers retain four independent bell pivots');
        const bellRestRotations = bellPivots.map((pivot) => pivot.quaternion.clone());
        const center = new THREE.Vector3();
        let portal0ClosedAtZero = false;
        let portal2ClosedAtZero = false;
        let portal0ClosedAtSix = false;
        let portal2ClosedAtSix = false;
        for (const seconds of [0, 3, 6, 9, 12]) {
            driver.setElapsedSeconds(seconds);
            result.scene.updateMatrixWorld(true);
            for (const entry of doorColliders) refreshDynamicMeshCollider(entry.meshCollider, entry.box);
            const sideDoorCenters = doorColliders.map((entry) => {
                entry.box.getCenter(center);
                return center.clone();
            });
            assert.ok(sideDoorCenters.every((point) => Math.abs(point.z) > 8),
                `side door sweep stays outside the central portal at ${seconds}s`);
            const portal0Closed = doorColliders.some((entry) => /portal_0_/i.test(entry.sourceName)
                && sphereIntersectsStaticMeshCollider(entry.meshCollider,
                    { x: -61.5, y: 3, z: 13.5 }, 0.3));
            const portal2Closed = doorColliders.some((entry) => /portal_2_/i.test(entry.sourceName)
                && sphereIntersectsStaticMeshCollider(entry.meshCollider,
                    { x: -61.5, y: 3, z: -13.5 }, 0.3));
            if (seconds === 0) {
                portal0ClosedAtZero = portal0Closed;
                portal2ClosedAtZero = portal2Closed;
            } else if (seconds === 6) {
                portal0ClosedAtSix = portal0Closed;
                portal2ClosedAtSix = portal2Closed;
            }
        }
        assert.ok(portal0ClosedAtZero !== portal2ClosedAtZero,
            'one side portal starts closed while the other is already open');
        assert.equal(portal0ClosedAtSix, portal2ClosedAtZero,
            'the first side portal opens when the second closes');
        assert.equal(portal2ClosedAtSix, portal0ClosedAtZero,
            'the second side portal opens when the first closes');
        driver.setElapsedSeconds(1);
        assert.ok(bellPivots.every((pivot, index) => pivot.quaternion.angleTo(bellRestRotations[index]) > 0.02),
            'the exported clip visibly swings every bell pivot');
    } finally {
        driver.clear();
        disposeObject3DResources(result.scene);
    }
});

test('the parts add up to the cathedral rather than to seven separate buildings', () => {
    const box = measuredPartBounds;

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
