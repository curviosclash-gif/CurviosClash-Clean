import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import {
    raycastStaticMeshCollider,
    sphereIntersectsStaticMeshCollider,
} from '../src/entities/arena/StaticMeshCollider.js';
import { isPositionInSandstormShelter, normalizeMapSandstorm } from '../src/shared/contracts/MapSandstormContract.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// All checks run in authored units: the loader places the GLBs at scale 1, and the preset
// anchors and shelter volumes are authored before ARENA.MAP_SCALE as well.
const MAP = MAP_PRESET_CATALOG.pyramid;
const CEILING = MAP.size[1];
const UP = new Vector3(0, 1, 0);
const PYRAMIDS = [
    { id: 'sun-king', cx: 0, cz: -60, half: 50, height: 145 },
    { id: 'dawn', cx: 78, cz: 55, half: 39, height: 130 },
    { id: 'dusk', cx: -78, cz: 55, half: 39, height: 130 },
];

let loadedPromise = null;
function loadArena() {
    loadedPromise ??= loadGLBMapCollection(MAP.glbModels, {
        loader: geometryOnlyGlbLoader, colliderMode: 'scene', requireComplete: true,
    }).then((loaded) => {
        loaded.scene.updateMatrixWorld(true);
        return loaded;
    });
    return loadedPromise;
}

function toVector(anchor) {
    return Array.isArray(anchor) ? new Vector3(...anchor) : new Vector3(anchor.x, anchor.y, anchor.z);
}

function isSolidAt(loaded, point, radius) {
    return loaded.colliders.some((entry) => entry.meshCollider
        && sphereIntersectsStaticMeshCollider(entry.meshCollider, point, radius));
}

function hasRoof(loaded, point) {
    return loaded.colliders.some((entry) => entry.meshCollider
        && raycastStaticMeshCollider(entry.meshCollider, point, UP, CEILING - point.y));
}

function sampleVolume(volume, steps = 5) {
    const points = [];
    for (let ix = 0; ix < steps; ix += 1) {
        for (let iy = 0; iy < steps; iy += 1) {
            for (let iz = 0; iz < steps; iz += 1) {
                const f = (i) => (i + 0.5) / steps;
                points.push(new Vector3(
                    volume.min[0] + (volume.max[0] - volume.min[0]) * f(ix),
                    volume.min[1] + (volume.max[1] - volume.min[1]) * f(iy),
                    volume.min[2] + (volume.max[2] - volume.min[2]) * f(iz),
                ));
            }
        }
    }
    return points;
}

test.after(async () => {
    if (loadedPromise) disposeObject3DResources((await loadedPromise).scene);
});

test('pyramid GLBs stay within their triangle, size and draw budgets', () => {
    for (const model of MAP.glbModels) {
        const bytes = readFileSync(model.url);
        const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
        const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
        const triangles = primitives.reduce((sum, primitive) => sum + doc.accessors[primitive.indices].count / 3, 0);
        assert.ok(triangles <= 6000, `${model.id}: ${triangles} triangles`);
        assert.ok(statSync(model.url).size <= 400 * 1024, `${model.id}: ${statSync(model.url).size} bytes`);
        assert.ok(primitives.length <= 20, `${model.id}: ${primitives.length} draw calls`);
        assert.equal(doc.extensionsUsed?.some((name) => /draco|meshopt|ktx|basisu/i.test(name)) || false, false);
    }
});

test('every preset position is the bounding-box anchor the loader places each GLB by', async () => {
    for (const model of MAP.glbModels) {
        const gltf = await geometryOnlyGlbLoader.loadAsync(model.url);
        const bounds = new Box3().setFromObject(gltf.scene);
        const center = bounds.getCenter(new Vector3());
        assert.ok(Math.abs(center.x - model.position[0]) < 0.01, `${model.id} x ${center.x}`);
        assert.ok(Math.abs(bounds.min.y - model.position[1]) < 0.01, `${model.id} y ${bounds.min.y}`);
        assert.ok(Math.abs(center.z - model.position[2]) < 0.01, `${model.id} z ${center.z}`);
    }
});

test('every storm shelter is a roofed, mostly open interior space', async () => {
    const loaded = await loadArena();
    const shelters = normalizeMapSandstorm(MAP.sandstorm).shelterVolumes;
    assert.ok(shelters.length >= 8, 'halls, galleries, portal chambers and the pavilion are shelters');
    for (const volume of shelters) {
        const samples = sampleVolume(volume);
        // Columns inside a hall are fine; a floor slab cutting through the volume is not
        // (the slabs of the old king interior left 64 % of a shelter open).
        const open = samples.filter((point) => !isSolidAt(loaded, point, 0.6));
        assert.ok(open.length >= samples.length * 0.8,
            `${volume.id}: only ${open.length}/${samples.length} sample points are open`);
        const roofed = open.filter((point) => hasRoof(loaded, point));
        assert.ok(roofed.length === open.length,
            `${volume.id}: ${open.length - roofed.length} open points see the sky`);
    }
});

test('the interiors a player reaches are sheltered, from hall to portal chamber', () => {
    const interiorPoints = [
        [0, 12, -60], [30, 12, -40], [0, 52, -60], [25, 40, -60], [0, 85, -60],
        [78, 12, 70], [78, 50, 55], [78, 80, 60], [-78, 12, 40], [-78, 80, 50],
        [0, 7, 16], [15, 10, 25],
    ];
    for (const point of interiorPoints) {
        assert.equal(isPositionInSandstormShelter(toVector(point), MAP.sandstorm), true, `${point} is sheltered`);
    }
    assert.equal(isPositionInSandstormShelter(toVector([0, 8, 60]), MAP.sandstorm), false, 'the avenue is open');
});

test('spawns and items sit either under open sky or inside a shelter, never in a sealed pocket', async () => {
    const loaded = await loadArena();
    const anchors = [MAP.playerSpawn, ...MAP.botSpawns, ...MAP.items.map((item) => item.pos)];
    for (const anchor of anchors) {
        const point = toVector(anchor);
        const outdoors = !hasRoof(loaded, point);
        const sheltered = isPositionInSandstormShelter(point, MAP.sandstorm);
        assert.ok(outdoors || sheltered, `${point.toArray()} is enclosed but no shelter`);
    }
});

test('portal endpoints float free inside their chambers', async () => {
    const loaded = await loadArena();
    for (const portal of MAP.portals) {
        for (const end of [portal.a, portal.b]) {
            const point = toVector(end);
            assert.equal(isSolidAt(loaded, point, 4), false, `${end} has room for the portal`);
            assert.equal(isPositionInSandstormShelter(point, MAP.sandstorm), true, `${end} lies in a chamber`);
        }
    }
});

test('the stepped walls leave no slit to the sky above the interiors', async () => {
    // The stepped skin is visual only (_nocol), so check it with a plain three.js ray against every
    // drawn mesh: straight up from the floor next to the walls there must always be stone.
    const loaded = await loadArena();
    const meshes = [];
    loaded.scene.traverse((node) => { if (node instanceof Mesh && node.visible) meshes.push(node); });
    const raycaster = new Raycaster();
    for (const pyramid of PYRAMIDS) {
        const leaks = [];
        for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            for (let r = 2; r < pyramid.half - 2; r += 0.5) {
                const origin = new Vector3(pyramid.cx + dx * r * 0.7071, 2, pyramid.cz + dz * r * 0.7071);
                raycaster.set(origin, UP);
                raycaster.far = pyramid.height + 5;
                if (raycaster.intersectObjects(meshes, false).length === 0) leaks.push(r);
            }
        }
        assert.deepEqual(leaks, [], `${pyramid.id}: sky visible straight up at radii ${leaks.slice(0, 5)}`);
    }
});
