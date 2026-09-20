import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { REACTOR_SITE_MAPS } from '../src/core/config/maps/presets/reactor_site/index.js';
import {
    REACTOR_SITE_GROUND,
    REACTOR_SITE_METRE,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteModels.js';
import { REACTOR_SITE_PROP_MODELS } from '../src/core/config/maps/presets/reactor_site/ReactorSiteProps.js';
import {
    HALL_Z,
    REACTOR_SITE_GATES,
    REACTOR_SITE_ITEMS,
    STACK_X,
    STACK_Z,
    TOWER_X,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteStructure.js';

const ROOT = path.resolve('assets/maps/reactor_site/props');
const FAMILIES = ['pipe-support', 'cable-tray', 'maintenance-light', 'control-box'];
const MAP = REACTOR_SITE_MAPS.reactor_site;

function variantPath(family, index, filename) {
    const stem = `reactor-${family}-v${String(index).padStart(2, '0')}`;
    return path.join(ROOT, `reactor-${family}`, stem, filename);
}

function parseGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.toString('ascii', 16, 20), 'JSON', `${filePath} starts with JSON`);
    return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

function triangleCount(gltf) {
    return (gltf.meshes || []).reduce((total, mesh) => total + mesh.primitives.reduce((sum, primitive) => {
        assert.equal(primitive.mode ?? 4, 4, 'infrastructure props use triangle topology');
        return sum + Number(gltf.accessors?.[primitive.indices]?.count || 0) / 3;
    }, 0), 0);
}

function horizontalDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

test('Reactor Site keeps ten editable, static, collision-free variants for every infrastructure family', () => {
    let sourceCount = 0;
    let runtimeCount = 0;
    for (const family of FAMILIES) {
        const fingerprints = new Set();
        for (let index = 1; index <= 10; index += 1) {
            const source = variantPath(family, index, 'source.blend');
            const runtime = variantPath(family, index, 'runtime.glb');
            assert.equal(existsSync(source), true, `${family} v${index} keeps its Blender source`);
            assert.equal(existsSync(runtime), true, `${family} v${index} keeps its runtime GLB`);
            assert.ok(statSync(source).size > 20_000, `${source} is an editable scene`);
            assert.ok(statSync(runtime).size > 5_000, `${runtime} is non-empty`);

            const gltf = parseGlb(runtime);
            const meshNodes = (gltf.nodes || []).filter((node) => Number.isInteger(node.mesh));
            assert.equal(meshNodes.length, 1, `${runtime} exports one batched mesh node`);
            assert.ok(meshNodes.every((node) => /_nocol$/i.test(node.name || '')),
                `${runtime} cannot contribute scene collision`);
            assert.equal((gltf.animations || []).length, 0, `${runtime} stays static`);
            assert.ok((gltf.materials || []).length <= 9, `${runtime} shares a compact material palette`);
            const fingerprint = JSON.stringify({
                triangles: triangleCount(gltf),
                materials: (gltf.materials || []).map((material) => material.name),
                bounds: (gltf.accessors || []).filter((entry) => entry.type === 'VEC3')
                    .map((entry) => [entry.min, entry.max]),
            });
            assert.equal(fingerprints.has(fingerprint), false, `${family} v${index} has distinct geometry`);
            fingerprints.add(fingerprint);
            sourceCount += 1;
            runtimeCount += 1;
        }
    }
    assert.equal(sourceCount, 40);
    assert.equal(runtimeCount, 40);
});

test('the curated selection represents every family without changing the map scale or collision', () => {
    assert.equal(REACTOR_SITE_PROP_MODELS.length, 20);
    assert.equal(new Set(REACTOR_SITE_PROP_MODELS.map((entry) => entry.id)).size, 20);
    const selectedByFamily = new Map(FAMILIES.map((family) => [family, 0]));
    let selectedBytes = 0;
    let selectedTriangles = 0;
    for (const model of REACTOR_SITE_PROP_MODELS) {
        assert.equal(model.scale, REACTOR_SITE_METRE, `${model.id} uses the map's metre scale`);
        assert.equal(model.targetSize, undefined, `${model.id} is never size-normalised`);
        assert.equal(existsSync(path.resolve(model.url)), true, `${model.id} resolves to a packaged asset`);
        const family = FAMILIES.find((candidate) => model.id.startsWith(`reactor-${candidate}-`));
        assert.ok(family, `${model.id} belongs to a contracted family`);
        selectedByFamily.set(family, selectedByFamily.get(family) + 1);
        selectedBytes += statSync(path.resolve(model.url)).size;
        selectedTriangles += triangleCount(parseGlb(path.resolve(model.url)));
    }
    assert.deepEqual([...selectedByFamily.values()], [5, 5, 5, 5]);
    assert.ok(selectedBytes <= 6 * 1024 * 1024, `placed props stay under 6 MiB (got ${selectedBytes})`);
    assert.ok(selectedTriangles <= 180_000, `placed props stay under 180k triangles (got ${selectedTriangles})`);
    // Every curated prop reaches the map. Checked by membership rather than by position: the
    // props used to be the last twenty entries, and the perimeter fungus that now follows them
    // made that incidental fact look like a broken curation.
    const placed = new Set(MAP.glbModels.map((entry) => entry.id));
    for (const model of REACTOR_SITE_PROP_MODELS) {
        assert.ok(placed.has(model.id), `${model.id} is placed on the map`);
    }
    assert.equal(MAP.glbColliderMode, 'scene');
});

test('curated props stay outside collapse envelopes and clear flight anchors', () => {
    const collapseEnvelopes = [
        { id: 'tower-west', center: [-TOWER_X, REACTOR_SITE_GROUND, 0], radius: 72 },
        { id: 'tower-east', center: [TOWER_X, REACTOR_SITE_GROUND, 0], radius: 72 },
        { id: 'stack', center: [STACK_X, REACTOR_SITE_GROUND, STACK_Z], radius: 56 },
        { id: 'hall', center: [0, REACTOR_SITE_GROUND, HALL_Z], radius: 58 },
        { id: 'reactor', center: [0, REACTOR_SITE_GROUND, 0], radius: 34 },
    ];
    const flightAnchors = [
        [MAP.playerSpawn.x, MAP.playerSpawn.y, MAP.playerSpawn.z],
        ...MAP.botSpawns.map((spawn) => [spawn.x, spawn.y, spawn.z]),
        ...REACTOR_SITE_GATES.map((gate) => gate.pos),
        ...REACTOR_SITE_ITEMS.map((item) => [item.x, item.y, item.z]),
    ];
    for (const model of REACTOR_SITE_PROP_MODELS) {
        assert.equal(model.position[1], REACTOR_SITE_GROUND, `${model.id} rests on permanent terrain`);
        for (const envelope of collapseEnvelopes) {
            assert.ok(horizontalDistance(model.position, envelope.center) > envelope.radius,
                `${model.id} clears the ${envelope.id} collapse envelope`);
        }
        for (const anchor of flightAnchors) {
            assert.ok(horizontalDistance(model.position, anchor) > 8,
                `${model.id} leaves the flight anchor at ${anchor[0]},${anchor[2]} clear`);
        }
    }
});
