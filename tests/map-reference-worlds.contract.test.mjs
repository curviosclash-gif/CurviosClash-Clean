import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
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
    'pyramid',
    'vertical_maze',
    'trench',
];
const quantize = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1000)).join(',');

test('desktop asset copy includes every local map pack and excludes Blender sources', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'curvios-map-copy-'));
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
