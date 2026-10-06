// Shared checks for decorative Blender prop families placed on map presets
// (scripts/map_prop_family_common.py builds them; every mesh is `_nocol`).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { loadGLBMapCollection } from '../../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './glb-geometry-loader.mjs';

export function familyVariantIds(objectId, count = 10) {
    return Array.from({ length: count }, (_, index) => `${objectId}-v${String(index + 1).padStart(2, '0')}`);
}

function readGlbJson(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${path} is a GLB`);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

// minTriangles only rejects empty or single-box exports; box-built families stay well below 100.
export function assertDecorativeFamily(familyDir, variantIds, { maxKiB = 120, minTriangles = 24, maxTriangles = 1500 } = {}) {
    assert.deepEqual(readdirSync(familyDir).sort(), variantIds);
    const signatures = new Set();
    for (const id of variantIds) {
        const blend = readFileSync(`${familyDir}/${id}/source.blend`);
        assert.equal(blend.toString('ascii', 0, 7), 'BLENDER', `${id} keeps its editable source`);
        const glbPath = `${familyDir}/${id}/runtime.glb`;
        assert.ok(statSync(glbPath).size <= maxKiB * 1024, `${id} stays under ${maxKiB} KiB`);
        const doc = readGlbJson(glbPath);
        const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
        const triangles = primitives.reduce((sum, primitive) => sum + doc.accessors[primitive.indices].count / 3, 0);
        assert.ok(triangles >= minTriangles && triangles <= maxTriangles, `${id}: ${triangles} triangles`);
        assert.ok(doc.materials.length <= 3, `${id} uses at most three materials`);
        assert.equal(doc.animations?.length || 0, 0);
        assert.equal(doc.cameras?.length || 0, 0);
        assert.equal(doc.textures?.length || 0, 0);
        assert.equal(doc.extensionsUsed?.includes('KHR_lights_punctual') || false, false);
        assert.ok(doc.materials.every((material) => (material.alphaMode || 'OPAQUE') === 'OPAQUE'), `${id} stays opaque`);
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
        // Counts alone repeat when two variants share their piece numbers; the exported
        // position bounds tell their shapes apart.
        const bounds = primitives.map((primitive) => doc.accessors[primitive.attributes.POSITION])
            .map((accessor) => [...accessor.min, ...accessor.max].map((value) => value.toFixed(3)).join(','));
        signatures.add(`${triangles}:${bounds.join('|')}`);
    }
    assert.equal(signatures.size, variantIds.length, 'every variant has its own geometry');
}

function boxDistanceXZ(x, z, obstacle) {
    const dx = Math.max(Math.abs(x - obstacle.pos[0]) - obstacle.size[0] / 2, 0);
    const dz = Math.max(Math.abs(z - obstacle.pos[2]) - obstacle.size[2] / 2, 0);
    return Math.hypot(dx, dz);
}

function tubeDistanceXZ(x, z, tube) {
    const [ax, , az] = tube.start;
    const [bx, , bz] = tube.end;
    const dx = bx - ax;
    const dz = bz - az;
    const along = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ((dx * dx + dz * dz) || 1)));
    return Math.hypot(x - ax - along * dx, z - az - along * dz) - tube.radius;
}

function routeAnchors(map) {
    return [
        ...map.parcours.checkpoints.map((checkpoint) => ({ pos: checkpoint.pos, radius: checkpoint.radius })),
        { pos: map.parcours.finish.pos, radius: map.parcours.finish.radius },
        ...map.items.map((item) => ({ pos: [item.x, item.y, item.z], radius: 0 })),
        ...[map.playerSpawn, ...map.botSpawns].map((spawn) => ({ pos: [spawn.x, spawn.y, spawn.z], radius: 0 })),
        ...(map.gates || []).map((gate) => ({ pos: gate.pos, radius: 4 })),
        ...(map.portals || []).flatMap((portal) => [{ pos: portal.a, radius: 4 }, { pos: portal.b, radius: 4 }]),
    ];
}

// Props stand on `floorY`, keep `wallClearance` from every listed obstacle footprint and
// 10 units plus the anchor's own radius from every route anchor, and stay below the route.
export function assertPropsClearOfRoute(map, props, { floorY, obstacles, wallClearance = 3.5 }) {
    assert.equal(map.glbColliderMode, 'dynamic', 'static props never collide in this map');
    assert.equal(new Set(props.map((prop) => prop.id)).size, props.length);
    const anchors = routeAnchors(map);
    const lowestRoute = Math.min(map.parcours.finish.pos[1], ...map.parcours.checkpoints.map((checkpoint) => checkpoint.pos[1]));
    for (const prop of props) {
        const [x, y, z] = prop.position;
        assert.ok(existsSync(prop.url), `${prop.id} resolves to a shipped GLB`);
        assert.equal(prop.collision, false);
        assert.equal(y, floorY, `${prop.id} stands on the floor`);
        assert.ok(y + prop.targetSize <= lowestRoute, `${prop.id} stays below the flight route`);
        for (const obstacle of obstacles) {
            const distance = obstacle.shape === 'tube' ? tubeDistanceXZ(x, z, obstacle) : boxDistanceXZ(x, z, obstacle);
            assert.ok(distance >= wallClearance, `${prop.id} keeps clear of the obstacle at ${obstacle.pos || obstacle.start}`);
        }
        for (const anchor of anchors) {
            const distance = Math.hypot(x - anchor.pos[0], z - anchor.pos[2]);
            assert.ok(distance >= 10 + anchor.radius, `${prop.id} keeps clear of the anchor at ${anchor.pos}`);
        }
    }
}

export async function assertLoaderAddsNoColliders(props) {
    const loaded = await loadGLBMapCollection(props, {
        loader: geometryOnlyGlbLoader, colliderMode: 'dynamic', requireComplete: true,
    });
    try {
        assert.deepEqual(loaded.warnings, []);
        assert.equal(loaded.colliders.length, 0);
    } finally {
        disposeObject3DResources(loaded.scene);
    }
}
