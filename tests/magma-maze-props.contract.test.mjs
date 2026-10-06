import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAGMA_BASALT_OUTCROPS } from '../src/core/config/maps/presets/magma_maze.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const FAMILY_DIR = 'assets/maps/magma_maze/props/basalt-outcrops';
const VARIANTS = Array.from({ length: 10 }, (_, index) => `magma-basalt-outcrop-v${String(index + 1).padStart(2, '0')}`);

function readGlbJson(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${path} is a GLB`);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

function boxDistanceXZ(x, z, obstacle) {
    const dx = Math.max(Math.abs(x - obstacle.pos[0]) - obstacle.size[0] / 2, 0);
    const dz = Math.max(Math.abs(z - obstacle.pos[2]) - obstacle.size[2] / 2, 0);
    return Math.hypot(dx, dz);
}

test('basalt outcrops ship ten decorative, budgeted variants with tone-mapping-safe lava', () => {
    assert.deepEqual(readdirSync(FAMILY_DIR).sort(), VARIANTS);
    const signatures = new Set();
    for (const id of VARIANTS) {
        const blend = readFileSync(`${FAMILY_DIR}/${id}/source.blend`);
        assert.equal(blend.toString('ascii', 0, 7), 'BLENDER', `${id} keeps its editable source`);
        const glbPath = `${FAMILY_DIR}/${id}/runtime.glb`;
        assert.ok(statSync(glbPath).size <= 120 * 1024, `${id} stays under 120 KiB`);
        const doc = readGlbJson(glbPath);
        const triangles = doc.meshes.flatMap((mesh) => mesh.primitives)
            .reduce((sum, primitive) => sum + doc.accessors[primitive.indices].count / 3, 0);
        assert.ok(triangles >= 100 && triangles <= 1500, `${id}: ${triangles} triangles`);
        assert.ok(doc.materials.length <= 3, `${id} uses at most three materials`);
        assert.equal(doc.animations?.length || 0, 0);
        assert.equal(doc.cameras?.length || 0, 0);
        assert.equal(doc.textures?.length || 0, 0);
        assert.equal(doc.extensionsUsed?.includes('KHR_lights_punctual') || false, false);
        const meshNodes = doc.nodes.filter((node) => node.mesh !== undefined);
        assert.ok(meshNodes.every((node) => node.name.includes('_nocol')), `${id} is decorative only`);
        for (const material of doc.materials) {
            const emissive = material.emissiveFactor || [0, 0, 0];
            const strength = material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
            if (Math.max(...emissive) === 0) continue;
            assert.ok(Math.max(...emissive) * strength <= 1.2, `${id} ${material.name} glow stays below white-out`);
            assert.ok(Math.max(...(material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1]).slice(0, 3)) <= 0.05,
                `${id} ${material.name} glows over a near-black base`);
        }
        // Counts alone repeat when two variants share column, crack and ember numbers; the
        // exported position bounds tell their shapes apart.
        const bounds = doc.meshes.flatMap((mesh) => mesh.primitives)
            .map((primitive) => doc.accessors[primitive.attributes.POSITION])
            .map((accessor) => [...accessor.min, ...accessor.max].map((value) => value.toFixed(3)).join(','));
        signatures.add(`${triangles}:${bounds.join('|')}`);
    }
    assert.equal(signatures.size, VARIANTS.length, 'every variant has its own geometry');
});

test('magma maze places the outcrops on the lava, clear of walls and every route anchor', () => {
    const map = MAP_PRESET_CATALOG.magma_maze;
    assert.equal(map.glbModels[0].url, 'assets/maps/magma_maze/glb/01_world.glb', 'the world loads first');
    assert.deepEqual(map.glbModels.slice(1), [...MAGMA_BASALT_OUTCROPS]);
    assert.equal(MAGMA_BASALT_OUTCROPS.length, 12);
    assert.equal(new Set(MAGMA_BASALT_OUTCROPS.map((prop) => prop.id)).size, 12);
    assert.equal(map.glbColliderMode, 'dynamic', 'static props never collide in this map');
    const lava = map.obstacles.find((obstacle) => obstacle.kind === 'foam' && obstacle.size[0] > 100);
    const walls = map.obstacles.filter((obstacle) => obstacle !== lava);
    const anchors = [
        ...map.parcours.checkpoints.map((checkpoint) => ({ pos: checkpoint.pos, radius: checkpoint.radius })),
        { pos: map.parcours.finish.pos, radius: map.parcours.finish.radius },
        ...map.items.map((item) => ({ pos: [item.x, item.y, item.z], radius: 0 })),
        ...[map.playerSpawn, ...map.botSpawns].map((spawn) => ({ pos: [spawn.x, spawn.y, spawn.z], radius: 0 })),
        ...map.gates.map((gate) => ({ pos: gate.pos, radius: 4 })),
        ...map.portals.flatMap((portal) => [{ pos: portal.a, radius: 4 }, { pos: portal.b, radius: 4 }]),
    ];
    const lowestRoute = Math.min(...map.parcours.checkpoints.map((checkpoint) => checkpoint.pos[1]));
    for (const prop of MAGMA_BASALT_OUTCROPS) {
        const [x, y, z] = prop.position;
        assert.ok(existsSync(prop.url), `${prop.id} resolves to a shipped GLB`);
        assert.equal(prop.collision, false);
        assert.equal(y, lava.pos[1] + lava.size[1] / 2, `${prop.id} stands on the lava top`);
        assert.ok(y + prop.targetSize <= lowestRoute, `${prop.id} stays below the flight route`);
        for (const wall of walls) {
            assert.ok(boxDistanceXZ(x, z, wall) >= 3.5, `${prop.id} keeps clear of the wall at ${wall.pos}`);
        }
        for (const anchor of anchors) {
            const distance = Math.hypot(x - anchor.pos[0], z - anchor.pos[2]);
            assert.ok(distance >= 10 + anchor.radius, `${prop.id} keeps clear of the anchor at ${anchor.pos}`);
        }
    }
});

test('the real loader adds the outcrops without a single collider', async () => {
    const loaded = await loadGLBMapCollection(MAGMA_BASALT_OUTCROPS, {
        loader: geometryOnlyGlbLoader, colliderMode: 'dynamic', requireComplete: true,
    });
    try {
        assert.deepEqual(loaded.warnings, []);
        assert.equal(loaded.colliders.length, 0);
    } finally {
        disposeObject3DResources(loaded.scene);
    }
});
