import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { createMapWorldSource } from '../scripts/map-world-source.mjs';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { copyObjVehicleAssetsPlugin } from '../dev/vite/productAssetCopyPlugin.js';

const KEYS = [
    'standard',
    'wind_cathedral',
    'chrono_forge_nexus',
    'maze',
    'complex',
    'vertical_maze',
    'trench',
];
const PYRAMID_MODULES = [
    '01_terrain',
    '02_sun_king_exterior',
    '03_sun_king_interior',
    '04_dawn_pyramid',
    '05_dusk_pyramid',
    '06_sun_plaza',
    '07_beacons_portals',
];
const quantize = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1000)).join(',');

test('desktop asset copy includes every local map pack and excludes Blender sources', (t) => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'curvios-map-copy-'));
    t.after(() => rmSync(outDir, { recursive: true, force: true }));
    const plugin = copyObjVehicleAssetsPlugin();
    plugin.configResolved({ root: process.cwd(), build: { outDir } });
    plugin.writeBundle();
    const models = Object.values(MAP_PRESET_CATALOG).flatMap((map) => map.glbModels || []);
    for (const url of new Set(models.map((model) => model.url).filter((url) => url.startsWith('assets/maps/')))) {
        assert.ok(statSync(path.join(outDir, url)).size > 0, `${url} included in app`);
        assert.equal(existsSync(path.join(outDir, path.dirname(url), '..', 'blender')), false);
    }
});

for (const key of KEYS) {
    test(`${key}: editable world stays within its geometry, material and shadow budgets`, () => {
        const map = MAP_PRESET_CATALOG[key];
        const root = `assets/maps/${key}`;
        assert.ok(statSync(`${root}/blender/01_world.blend`).size > 100000);
        const bytes = readFileSync(`${root}/glb/01_world.glb`);
        assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
        const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
        assert.equal(doc.scenes[doc.scene || 0].extras.geometry_digest, createMapWorldSource(key).geometryDigest,
            'regenerate the world when its authored geometry or layout version changes');
        const triangles = doc.meshes.flatMap((mesh) => mesh.primitives)
            .reduce((sum, primitive) => sum + doc.accessors[primitive.indices].count / 3, 0);
        assert.ok(triangles <= 30000, `${triangles} triangles`);
        assert.ok(doc.meshes.length <= 32, `${doc.meshes.length} draws`);
        assert.ok(doc.materials.length <= 8);
        assert.equal(doc.animations?.length || 0, 0);
        const meshes = doc.nodes.filter((node) => node.mesh !== undefined);
        assert.ok(meshes.every((node) => node.name.includes('_nocol')));
        assert.ok(meshes.filter((node) => !node.name.includes('_noshadow')).length <= 8);
        assert.ok((map.lights || []).length <= 4);
        assert.equal(map.glbColliderMode, 'dynamic');
        assert.equal(map.glbAuthoredObstaclesCollisionOnly, true);
    });

    test(`${key}: exported world aligns with fallback geometry at both arena scales`, async () => {
        const source = createMapWorldSource(key);
        const model = source.definition.glbModels.find((entry) => entry.url.includes(`/maps/${key}/`));
        for (const scale of [1, 1.5]) {
            const loaded = await loadGLBMapCollection([model], { loader: geometryOnlyGlbLoader,
                colliderMode: 'dynamic', placementScale: scale, requireComplete: true });
            try {
                assert.deepEqual(loaded.warnings, []);
                assert.equal(loaded.colliders.length, 0, 'visual skin adds no duplicate collision');
                const actual = new Set();
                loaded.scene.updateMatrixWorld(true);
                loaded.scene.traverse((mesh) => {
                    if (!mesh.isMesh || !/_(body|foam)_/.test(mesh.name)) return;
                    const position = mesh.geometry.getAttribute('position');
                    const p = new Vector3();
                    for (let i = 0; i < position.count; i++) {
                        p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).divideScalar(scale);
                        actual.add(quantize(p.x, p.y, p.z));
                    }
                });
                for (const mesh of source.meshes) {
                    for (let i = 0; i < mesh.positions.length; i += 3) {
                        assert.ok(actual.has(quantize(...mesh.positions.slice(i, i + 3))),
                            `${mesh.id} vertex ${i / 3} aligns at scale ${scale}`);
                    }
                }
                const bounds = new Box3().setFromObject(loaded.scene);
                assert.ok(Math.abs(bounds.min.y / scale - model.position[1]) < .001);
                assert.ok(Math.abs(bounds.min.x / scale + source.definition.size[0] / 2) < .001);
                assert.ok(Math.abs(bounds.max.z / scale - source.definition.size[2] / 2) < .001);
            } finally {
                disposeObject3DResources(loaded.scene);
            }
        }
    });
}

test('pyramid: modular Blender sources and GLBs form a bounded collidable arena', async () => {
    const map = MAP_PRESET_CATALOG.pyramid;
    assert.deepEqual(map.size, [260, 160, 260]);
    assert.equal(map.glbModels.length, PYRAMID_MODULES.length);
    for (const stem of PYRAMID_MODULES) {
        assert.ok(statSync(`assets/maps/pyramid/blender/${stem}.blend`).size > 100000, `${stem}.blend`);
        const bytes = readFileSync(`assets/maps/pyramid/glb/${stem}.glb`);
        assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${stem}.glb loadable header`);
    }

    const loaded = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        requireComplete: true,
    });
    try {
        assert.deepEqual(loaded.warnings, []);
        assert.ok(loaded.colliders.length >= 40 && loaded.colliders.length <= 100,
            `${loaded.colliders.length} colliders stay within the authored budget`);
        assert.deepEqual(
            loaded.colliders.filter((entry) => entry.sourceName.includes('_colonly'))
                .map((entry) => entry.sourceName).sort(),
            ['COL_evening_shell_colonly', 'COL_king_shell_colonly', 'COL_morning_shell_colonly'],
        );
        const bounds = new Box3().setFromObject(loaded.scene);
        assert.ok(bounds.min.x >= -130.01 && bounds.max.x <= 130.01, `x bounds ${bounds.min.x}..${bounds.max.x}`);
        assert.ok(bounds.min.z >= -130.01 && bounds.max.z <= 130.01, `z bounds ${bounds.min.z}..${bounds.max.z}`);
        assert.ok(bounds.min.y >= -12 && bounds.max.y <= 160.01, `y bounds ${bounds.min.y}..${bounds.max.y}`);
    } finally {
        disposeObject3DResources(loaded.scene);
    }
});

test('pyramid: all monuments reach the required measured storm-dam height ratio', async () => {
    const map = MAP_PRESET_CATALOG.pyramid;
    const damObstacle = MAP_PRESET_CATALOG.storm_dam_siege.obstacles.find((entry) => entry.size?.[1] >= 100);
    const measuredDamHeight = damObstacle.pos[1] + damObstacle.size[1] * .5;
    const requirements = new Map([
        ['sun-king-exterior', .9],
        ['dawn-pyramid', .8],
        ['dusk-pyramid', .8],
    ]);
    for (const [id, ratio] of requirements) {
        const model = map.glbModels.find((entry) => entry.id === id);
        const loaded = await loadGLBMapCollection([model], {
            loader: geometryOnlyGlbLoader,
            colliderMode: 'scene',
            requireComplete: true,
        });
        try {
            const bounds = new Box3().setFromObject(loaded.scene);
            assert.ok(bounds.max.y - bounds.min.y >= measuredDamHeight * ratio,
                `${id} reaches ${Math.round(ratio * 100)}% of the ${measuredDamHeight} unit dam`);
        } finally {
            disposeObject3DResources(loaded.scene);
        }
    }
});

test('pyramid: spawn and item anchors stay distributed and inside the arena', () => {
    const map = MAP_PRESET_CATALOG.pyramid;
    const spawns = [map.playerSpawn, ...map.botSpawns];
    assert.equal(spawns.length, 8);
    assert.equal(map.items.length, 8);
    for (const anchor of [...spawns, ...map.items.map((entry) => ({
        x: entry.pos[0], y: entry.pos[1], z: entry.pos[2],
    }))]) {
        assert.ok(Math.abs(anchor.x) <= 126 && Math.abs(anchor.z) <= 126);
        assert.ok(anchor.y >= 0 && anchor.y <= 156);
    }
    for (let left = 0; left < spawns.length; left += 1) {
        for (let right = left + 1; right < spawns.length; right += 1) {
            const dx = spawns[left].x - spawns[right].x;
            const dz = spawns[left].z - spawns[right].z;
            assert.ok(dx * dx + dz * dz >= 18 * 18, `spawn ${left}/${right} has escape room`);
        }
    }
});

test('pyramid: anchors avoid collision and keep at least three escape directions', async () => {
    const map = MAP_PRESET_CATALOG.pyramid;
    const loaded = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        requireComplete: true,
    });
    const collides = (position, radius = 1.2) => loaded.colliders.some((entry) => (
        entry.meshCollider
        && sphereIntersectsStaticMeshCollider(entry.meshCollider, position, radius)
    ));
    try {
        const spawnAnchors = [map.playerSpawn, ...map.botSpawns];
        const itemAnchors = map.items.map((entry) => ({
            x: entry.pos[0], y: entry.pos[1], z: entry.pos[2],
        }));
        for (const [kind, anchors] of [['spawn', spawnAnchors], ['item', itemAnchors]]) {
            for (let index = 0; index < anchors.length; index += 1) {
                const anchor = anchors[index];
                assert.equal(collides(anchor), false, `${kind} ${index} is collision-free`);
                let escapeDirections = 0;
                for (let direction = 0; direction < 8; direction += 1) {
                    const angle = direction * Math.PI / 4;
                    const probe = {
                        x: anchor.x + Math.cos(angle) * 10,
                        y: anchor.y,
                        z: anchor.z + Math.sin(angle) * 10,
                    };
                    if (!collides(probe)) escapeDirections += 1;
                }
                assert.ok(escapeDirections >= 3, `${kind} ${index} has ${escapeDirections} escape directions`);
            }
        }
    } finally {
        disposeObject3DResources(loaded.scene);
    }
});
