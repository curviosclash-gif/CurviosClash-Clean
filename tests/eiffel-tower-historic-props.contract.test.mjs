import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { EIFFEL_TOWER_MAPS } from '../src/core/config/maps/presets/eiffel_tower/index.js';
import {
    EIFFEL_TOWER_GROUND,
} from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerModels.js';
import {
    EIFFEL_TOWER_HISTORIC_FAMILY_COUNTS,
    EIFFEL_TOWER_HISTORIC_MODELS,
    EIFFEL_TOWER_SIEGE_HISTORIC_MODELS,
} from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerHistoricProps.js';
import { EIFFEL_TOWER_SIEGE_MAPS } from '../src/core/config/maps/presets/eiffel_tower_siege/index.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const ROOT = path.resolve('assets/maps/eiffel_tower/props');
const FAMILIES = ['lamp', 'bench', 'urn', 'information'];

function variantPath(family, index, filename) {
    const familyId = `eiffel-historic-${family}`;
    const variantId = `${familyId}-v${String(index).padStart(2, '0')}`;
    return path.join(ROOT, familyId, variantId, filename);
}

function parseGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
    return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

function triangleCount(document) {
    return (document.meshes || []).reduce((total, mesh) => total + mesh.primitives.reduce(
        (meshTotal, primitive) => meshTotal + Number(document.accessors?.[primitive.indices]?.count || 0) / 3,
        0,
    ), 0);
}

test('Eiffel keeps exactly forty editable, static and collision-free historic prop variants', () => {
    assert.deepEqual(EIFFEL_TOWER_HISTORIC_FAMILY_COUNTS, {
        lamp: 10,
        bench: 10,
        urn: 10,
        information: 10,
    });
    const fingerprints = new Set();
    let count = 0;
    for (const family of FAMILIES) {
        for (let index = 1; index <= 10; index += 1) {
            const source = variantPath(family, index, 'source.blend');
            const runtime = variantPath(family, index, 'runtime.glb');
            assert.equal(existsSync(source), true, `${family} v${index} keeps its Blender source`);
            assert.equal(existsSync(runtime), true, `${family} v${index} keeps its GLB`);
            assert.ok(statSync(source).size > 20_000, `${source} is an editable scene`);
            assert.ok(statSync(runtime).size > 3_000, `${runtime} is a non-empty runtime asset`);

            const document = parseGlb(runtime);
            const meshNodes = (document.nodes || []).filter((node) => Number.isInteger(node.mesh));
            assert.equal(meshNodes.length, 1, `${runtime} exports one batched mesh`);
            assert.ok(meshNodes.every((node) => /_nocol/i.test(node.name || '')),
                `${runtime} cannot contribute scene collision`);
            assert.equal(document.animations?.length ?? 0, 0, `${runtime} stays static`);
            assert.equal(document.cameras?.length ?? 0, 0, `${runtime} exports no camera`);
            assert.equal(document.lights?.length ?? 0, 0, `${runtime} exports no light`);
            assert.ok(triangleCount(document) <= 8_000, `${runtime} stays inside its geometry budget`);
            assert.ok((document.materials || []).length <= 8, `${runtime} stays inside its material budget`);
            const fingerprint = JSON.stringify({
                family,
                triangles: triangleCount(document),
                materials: (document.materials || []).map((entry) => entry.name),
                bounds: (document.accessors || []).filter((entry) => entry.type === 'VEC3')
                    .map((entry) => [entry.min, entry.max]),
            });
            assert.equal(fingerprints.has(fingerprint), false, `${family} v${index} has distinct geometry`);
            fingerprints.add(fingerprint);
            if (family === 'lamp') {
                assert.ok((document.materials || []).some((entry) =>
                    Array.isArray(entry.emissiveFactor) && entry.emissiveFactor.some((value) => value > 0)),
                `${runtime} keeps emissive glass without a realtime light`);
            }
            count += 1;
        }
    }
    assert.equal(count, 40);
});

test('the route and siege maps each curate props, tree LODs and scaled dandelions', () => {
    for (const [name, models, map] of [
        ['route', EIFFEL_TOWER_HISTORIC_MODELS, EIFFEL_TOWER_MAPS.eiffel_tower],
        ['siege', EIFFEL_TOWER_SIEGE_HISTORIC_MODELS, EIFFEL_TOWER_SIEGE_MAPS.eiffel_tower_siege],
    ]) {
        assert.equal(models.length, 30, `${name} selection stays bounded`);
        assert.equal(new Set(models.map((entry) => entry.id)).size, 30, `${name} IDs stay unique`);
        assert.ok(models.every((entry) => entry.collision === false), `${name} decoration stays collision-free`);
        assert.ok(models.every((entry) => entry.maxRenderDistance > 0),
            `${name} decoration has bounded render distance`);
        assert.ok(models.every((entry) => entry.position[1] === EIFFEL_TOWER_GROUND),
            `${name} decoration stays grounded`);
        for (const family of FAMILIES) {
            assert.equal(models.filter((entry) => entry.id.startsWith(`eiffel-historic-${family}-`)).length, 4,
                `${name} represents ${family} with four curated variants`);
        }
        assert.equal(models.filter((entry) => entry.id.startsWith('eiffel-tree-')).length, 12);
        assert.equal(models.filter((entry) => entry.id.startsWith('eiffel-dandelion-')).length, 2);
        assert.deepEqual(map.glbModels.slice(-30).map((entry) => entry.id), models.map((entry) => entry.id));
    }
});

test('reused tree and dandelion instances receive runtime _nocol names and no colliders', async () => {
    const samples = [
        EIFFEL_TOWER_HISTORIC_MODELS.find((entry) => entry.id.startsWith('eiffel-tree-')),
        EIFFEL_TOWER_HISTORIC_MODELS.find((entry) => entry.id.startsWith('eiffel-dandelion-')),
    ];
    const result = await loadGLBMapCollection(samples, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
    });
    assert.equal(result.colliders.length, 0);
    const meshNames = [];
    result.scene.traverse((object) => {
        if (object.isMesh) meshNames.push(object.name);
    });
    assert.ok(meshNames.length > 0);
    assert.ok(meshNames.every((name) => /_nocol/i.test(name)), meshNames.join(', '));
    assert.equal(result.scene.children.every((slot) => slot.children[0]?.isLOD === true), true);
    assert.deepEqual(result.scene.children.map((slot) => slot.children[0].levels[1].distance), [200, 180]);
});

test('siege decoration stays clear of the tank square and the two underground portals', () => {
    const segmentDistance = (point, start, end) => {
        const dx = end[0] - start[0];
        const dz = end[1] - start[1];
        const lengthSquared = dx * dx + dz * dz;
        const amount = Math.max(0, Math.min(1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared));
        return Math.hypot(point[0] - (start[0] + dx * amount), point[1] - (start[1] + dz * amount));
    };
    const tankSegments = [
        [[95, 95], [95, -95]],
        [[95, -95], [-95, -95]],
        [[-95, -95], [-95, 95]],
        [[-95, 95], [95, 95]],
    ];
    for (const model of EIFFEL_TOWER_SIEGE_HISTORIC_MODELS) {
        const [x, , z] = model.position;
        const distanceToTankSquare = Math.min(...tankSegments.map(([start, end]) =>
            segmentDistance([x, z], start, end)));
        assert.ok(distanceToTankSquare >= 20, `${model.id} stays clear of the tank patrol`);
        assert.ok(Math.hypot(x + 140, z) >= 24, `${model.id} stays clear of the vault entry`);
        assert.ok(Math.hypot(x, z + 140) >= 24, `${model.id} stays clear of the vault eject point`);
    }
});
