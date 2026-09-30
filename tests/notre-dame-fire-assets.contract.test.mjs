import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_FIRE_MODELS } from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireModels.js';
import { createStaticMeshCollider, sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// The four parts the fire rebuilt. Everything else this map flies is the intact set, covered by
// notre-dame-blender-assets.contract.test.mjs, and is deliberately not re-asserted here.
//
// The burnt parts get their own asset directory rather than joining the intact one, because that
// directory is already at 3.3 of its 4 MB budget and a shared budget would make one map's growth
// the other map's problem.
const ASSET_ROOT = path.resolve('assets/maps/notre_dame_fire/glb');
const TOTAL_GLB_BUDGET_BYTES = 2 * 1024 * 1024;
const TRIANGLE_BUDGET_PER_PART = 18_000;

// Metres, in the shared cathedral coordinate system: glTF X is length along the building, glTF Y
// is height above the church floor, glTF Z is width across it. These are the numbers the preset
// places by, so they are asserted rather than trusted.
// The building parts are symmetrical about the axis and centre on it.
const PARTS = Object.freeze({
    // Removing the inherited collision-only vault slab lowers the asset's measured top by 0.3 m.
    '02_nave_burnt': { centerX: -24.68, centerZ: 0, floorY: -0.8, spanY: 34.1 },
    '03_transept_burnt': { centerX: 12.25, centerZ: 0, floorY: -0.8, spanY: 41.9 },
    // The intact roof part is 82.1 m tall because the spire is in it. This one is not.
    '06_roof_burnt': { centerX: 3.79, centerZ: 0, floorY: 14.06, spanY: 21.5 },
    '20_fleche_debris': { centerX: 12.25, centerZ: 0.01, floorY: -0.23, spanY: 9.8 },
});

function readGlb(fileStem) {
    const bytes = readFileSync(path.join(ASSET_ROOT, `${fileStem}.glb`));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${fileStem} has a GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

const readGlbJson = readGlb;

/** Bounding box with every node transform applied. */
function boundingBox(document, { collidableOnly = false } = {}) {
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
        const collidable = !String(node.name || '').toLowerCase().includes('_nocol');
        if (node.mesh !== undefined && (!collidableOnly || collidable)) {
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

    const scene = document.scenes?.[document.scene || 0];
    for (const nodeIndex of scene?.nodes || []) visit(nodeIndex, new THREE.Matrix4());
    return { low: bounds.min.toArray(), high: bounds.max.toArray() };
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

/** One box per collidable node, so a wide-and-low surface can be told from a high-and-narrow one. */
function collidableNodeBoxes(fileStem) {
    const document = readGlbJson(fileStem);
    const boxes = [];
    for (const node of document.nodes || []) {
        const name = String(node.name || '');
        if (node.mesh === undefined || name.toLowerCase().includes('_nocol')) continue;
        for (const primitive of document.meshes?.[node.mesh]?.primitives || []) {
            const accessor = document.accessors?.[primitive.attributes?.POSITION];
            if (!accessor?.min || !accessor?.max) continue;
            boxes.push({ name, low: accessor.min.map(Number), high: accessor.max.map(Number) });
        }
    }
    return boxes;
}

async function collidableMeshColliders(fileStem) {
    const absolutePath = path.resolve(ASSET_ROOT, `${fileStem}.glb`);
    const gltf = await geometryOnlyGlbLoader.loadAsync(absolutePath);
    gltf.scene.updateMatrixWorld(true);
    const colliders = [];
    gltf.scene.traverse((node) => {
        if (!node.isMesh || String(node.name || '').toLowerCase().includes('_nocol')) return;
        const collider = createStaticMeshCollider(node);
        if (collider) colliders.push(collider);
    });
    return colliders;
}

function centralOpeningProbeRatio(colliders) {
    const longitudinalStations = Array.from({ length: 17 }, (_, index) => -40 + index * 5);
    const widthStations = Array.from({ length: 11 }, (_, index) => -5 + index);
    let openSamples = 0;
    let totalSamples = 0;
    for (const x of longitudinalStations) {
        for (const z of widthStations) {
            totalSamples += 1;
            let blocked = false;
            // Sweep a gameplay-sized sphere up through the central nave. This catches a lid at
            // any height between the side aisle roof and the ridge, not only at one chosen Y.
            for (let y = 24; y <= 35; y += 0.5) {
                if (colliders.some((collider) => sphereIntersectsStaticMeshCollider(
                    collider, { x, y, z }, 0.25,
                ))) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) openSamples += 1;
        }
    }
    return openSamples / totalSamples;
}

/** Names of the nodes that actually draw something. Rig empties carry no mesh and no marker. */
function meshNodeNames(fileStem) {
    return (readGlbJson(fileStem).nodes || [])
        .filter((node) => node.mesh !== undefined)
        .map((node) => String(node.name || ''))
        .filter(Boolean);
}

test('the burnt parts stay inside their own asset budget', () => {
    let total = 0;
    for (const fileStem of Object.keys(PARTS)) {
        const bytes = statSync(path.join(ASSET_ROOT, `${fileStem}.glb`)).size;
        assert.ok(bytes > 0, `${fileStem} is not empty`);
        total += bytes;
    }
    assert.ok(
        total <= TOTAL_GLB_BUDGET_BYTES,
        `burnt assets total ${(total / 1024).toFixed(1)} KB, over budget`,
    );
});

test('each burnt part is measured where the preset expects to place it', () => {
    // Get this wrong and the burnt nave drifts away from the choir it is joined to.
    for (const [fileStem, expected] of Object.entries(PARTS)) {
        const document = readGlbJson(fileStem);
        const { low, high } = boundingBox(document);
        const centerX = (low[0] + high[0]) / 2;
        assert.ok(
            Math.abs(centerX - expected.centerX) < 0.05,
            `${fileStem} centres at ${centerX.toFixed(2)}, expected ${expected.centerX}`,
        );
        assert.ok(
            Math.abs(low[1] - expected.floorY) < 0.05,
            `${fileStem} sits at ${low[1].toFixed(2)}, expected ${expected.floorY}`,
        );
        assert.ok(
            Math.abs((high[1] - low[1]) - expected.spanY) < 0.1,
            `${fileStem} is ${(high[1] - low[1]).toFixed(1)} m tall, expected ${expected.spanY}`,
        );
        const centerZ = (low[2] + high[2]) / 2;
        assert.ok(
            Math.abs(centerZ - expected.centerZ) < 0.05,
            `${fileStem} centres across at ${centerZ.toFixed(2)}, expected ${expected.centerZ}`,
        );
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET_PER_PART,
            `${fileStem} spends ${triangleCount(document)} triangles`,
        );
    }
});

test('the preset places every burnt part at the measurement its file reports', () => {
    const METRE = 1.4;
    const GROUND = 8;
    for (const [fileStem, expected] of Object.entries(PARTS)) {
        const model = NOTRE_DAME_FIRE_MODELS.find((entry) => entry.url.endsWith(`${fileStem}.glb`));
        assert.ok(model, `${fileStem} is placed by the preset`);
        assert.ok(
            Math.abs(model.position[0] - expected.centerX * METRE) < 0.1,
            `${fileStem} is placed along the building where its box centres`,
        );
        assert.ok(
            Math.abs(model.position[1] - (GROUND + expected.floorY * METRE)) < 0.1,
            `${fileStem} is placed at the height its underside reports`,
        );
        assert.ok(
            Math.abs(model.position[2] - expected.centerZ * METRE) < 0.1,
            `${fileStem} is placed across the building where its box centres`,
        );
    }
});

test('the roof collision meshes leave a real central opening', async () => {
    const boxes = collidableNodeBoxes('06_roof_burnt');
    assert.ok(boxes.length > 0, 'the roof part still has some collision');
    // Check actual GLB collision triangles at a grid of points through the vessel. The central
    // fallen timbers remain collidable, but occupy only some probes; a rebuilt roof lid would
    // intersect essentially the entire longitudinal corridor. The 24..35 m vertical span also
    // catches a lid built lower than the ridge, regardless of its material or object name.
    const colliders = await collidableMeshColliders('06_roof_burnt');
    const openRatio = centralOpeningProbeRatio(colliders);
    assert.ok(
        openRatio >= 0.75,
        `only ${(openRatio * 100).toFixed(1)}% of actual central GLB collision probes are open at roof height`,
    );
    // Countercheck the guard itself: an artificial cross-vessel lid at y=28, below the ridge,
    // must close the sampled channel and fail the same 75% opening rule.
    const syntheticLid = [
        new THREE.Mesh(new THREE.BoxGeometry(90, 0.1, 12)),
    ];
    syntheticLid[0].position.y = 28;
    syntheticLid[0].updateMatrixWorld(true);
    const syntheticCollider = createStaticMeshCollider(syntheticLid[0]);
    assert.ok(
        centralOpeningProbeRatio([...colliders, syntheticCollider]) < 0.75,
        'the same triangle probes must reject an artificial roof lid across the vessel',
    );
    // And the whole part now tops out far below the 45 m ridge it used to carry.
    const overall = boundingBox(readGlbJson('06_roof_burnt'));
    assert.ok(overall.high[1] < 36, `the roof still reaches ${overall.high[1].toFixed(1)} m`);
});

test('the debris cone is an obstacle and the broken rims are not', () => {
    // A ship must be stopped by the spire on the floor and must never catch on the jagged edge of
    // a hole it is flying through.
    const debris = meshNodeNames('20_fleche_debris');
    assert.ok(
        debris.some((name) => !name.toLowerCase().includes('_nocol')),
        'the debris cone collides',
    );

    for (const fileStem of ['02_nave_burnt', '03_transept_burnt']) {
        const document = readGlbJson(fileStem);
        assert.ok(
            (document.nodes || []).some((node) => (
                String(node.name || '').toLowerCase().includes('_nocol')
            )),
            `${fileStem} keeps its decorative and broken-edge meshes out of collision`,
        );
    }
});
