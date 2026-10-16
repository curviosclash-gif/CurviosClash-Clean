import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { SKYSCRAPER_SITE_MAPS } from '../src/core/config/maps/presets/skyscraper_site/index.js';
import { placeMapGlbModel } from './helpers/placed-glb-model.mjs';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { SECTOR_MAP_POOLS, resolveMapSequence } from '../src/state/arcade/ArcadeMapProgression.js';
import { ARCADE_SECTOR_CATALOG, buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { resolveMapPortalEntryCount } from '../src/shared/contracts/PortalAuthoringContract.js';

const map = SKYSCRAPER_SITE_MAPS.skyscraper_site;
const source = readFileSync('scripts/skyscraper_site_layout.py', 'utf8');
const staticParts = [
    '01_street_ground', '02_skyline_street', '03_skyline_backdrop', '04_scaffold',
    '05_steel_skeleton', '06_concrete_core', '07_elevator_shaft', '08_roof_finale', '09_main_crane',
];
const loops = {
    '10_slewing_crane': ['SlewingCraneLoop', 24],
    '11_hoist_cabin': ['HoistCabinLoop', 12],
    '12_beam_pendulum': ['BeamPendulumLoop', 8],
    '13_concrete_bucket': ['ConcreteBucketLoop', 10],
};
const parts = [...staticParts, ...Object.keys(loops)];
const glbPath = stem => `assets/maps/skyscraper_site/glb/${stem}.glb`;

test('Skyscraper is selectable in the parcours collection and both arcade parcours pools', () => {
    assert.equal(resolveMapPickerCollection('skyscraper_site').id, 'parcours');
    assert.ok(SECTOR_MAP_POOLS.sector_parcours.includes('skyscraper_site'));
    assert.ok(ARCADE_SECTOR_CATALOG.find(entry => entry.id === 'sector_parcours').mapPool.includes('skyscraper_site'));
});

test('the ordered Skyscraper course does not generate shortcut portals', () => {
    assert.equal(map.portalCount, 0);
    assert.equal(resolveMapPortalEntryCount(map), 0);
});

test('Daily v1 keeps its maps while free Arcade can draw Skyscraper in both selection paths', () => {
    let freePlanUsesMap = false, freeRuntimeUsesMap = false;
    for (let seed = 0; seed < 128; seed++) {
        const daily = buildArcadeSectorPlan({ seed, sectorCount: 24, dailyChallenge: true });
        assert.equal(daily.dailyChallenge, true);
        assert.equal(daily.sequence.some(entry => entry.mapKey === 'skyscraper_site'), false);
        assert.equal(resolveMapSequence(daily, seed, MAP_PRESET_CATALOG).includes('skyscraper_site'), false);
        const free = buildArcadeSectorPlan({ seed, sectorCount: 24 });
        freePlanUsesMap ||= free.sequence.some(entry => entry.mapKey === 'skyscraper_site');
        freeRuntimeUsesMap ||= resolveMapSequence(free, seed, MAP_PRESET_CATALOG).includes('skyscraper_site');
    }
    assert.equal(freePlanUsesMap, true);
    assert.equal(freeRuntimeUsesMap, true);
});

function documentFor(stem) {
    const bytes = readFileSync(glbPath(stem));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trimEnd());
}

test('all thirteen Skyscraper parts retain editable sources and bounded, decodable exports', () => {
    for (const stem of parts) {
        assert.ok(statSync(`assets/maps/skyscraper_site/blender/${stem}.blend`).size > 100_000, stem);
        assert.ok(statSync(glbPath(stem)).size > 2_000, stem);
        assert.ok(statSync(glbPath(stem)).size <= 1_200 * 1024, stem);
        const document = documentFor(stem);
        assert.ok(!(document.extensionsRequired || []).some(name => /draco|meshopt|basisu/i.test(name)), stem);
        const animated = Object.hasOwn(loops, stem);
        const triangles = (document.meshes || []).flatMap(mesh => mesh.primitives || [])
            .reduce((sum, primitive) => sum + document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);
        assert.ok(triangles > 0 && triangles <= (animated ? 8_000 : 18_000), `${stem}: ${triangles} triangles`);
        assert.ok((document.nodes || []).filter(node => node.mesh !== undefined).length <= (animated ? 40 : 12), stem);
        assert.ok((document.materials || []).some(material => {
            const color = material.pbrMetallicRoughness?.baseColorFactor;
            return color && color.some((value, index) => index < 3 && value > 0.05 && value < 0.95);
        }), `${stem} retains authored material color`);
        if (!animated) assert.equal(document.animations?.length || 0, 0, stem);
    }
});

test('each moving hazard exports its complete named loop and animated collider subtree', () => {
    for (const [stem, [name, seconds]] of Object.entries(loops)) {
        const document = documentFor(stem);
        assert.equal(document.animations?.length, 1, stem);
        const animation = document.animations[0];
        assert.equal(animation.name, name);
        const duration = Math.max(...animation.samplers.map(sampler => document.accessors[sampler.input].max[0]));
        assert.ok(Math.abs(duration - seconds) < 0.05, `${stem}: ${duration}s`);
        assert.ok(animation.channels.length > 0, stem);
        const descendants = new Set();
        const collect = index => {
            const node = document.nodes[index];
            if (node.mesh !== undefined && !/_nocol/i.test(node.name)) descendants.add(node.name);
            for (const child of node.children || []) collect(child);
        };
        for (const channel of animation.channels) collect(channel.target.node);
        assert.ok(descendants.size > 0, `${stem} moves real collision geometry`);
        assert.ok([...descendants].every(node => /_dyn/i.test(node)), stem);
    }
});

test('every shared-frame part is placed exactly once at its actual exported center and base', async () => {
    assert.equal(map.glbModels.length, 13);
    assert.equal(new Set(map.glbModels.map(model => path.basename(model.url, '.glb'))).size, 13);
    assert.equal(map.glbAnimationClock.beatSeconds, 2);
    for (const stem of parts) {
        const model = map.glbModels.find(entry => entry.url === glbPath(stem));
        assert.ok(model, stem);
        assert.equal(model.scale, 1);
        assert.deepEqual(model.rotation, [0, 0, 0]);
        const gltf = await geometryOnlyGlbLoader.loadAsync(glbPath(stem));
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const actual = [(bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2];
        actual.forEach((value, axis) => assert.ok(Math.abs(value - model.position[axis]) <= 0.05, `${stem} axis ${axis}`));
        if (loops[stem]) assert.equal(model.animationClock.clipName, loops[stem][0]);
    }
});

test('the complete nineteen-ring course and spawn match the preserved layout', () => {
    const entries = [...map.parcours.checkpoints, map.parcours.finish];
    const pattern = /\("(CP\d+|FINISH)", "(\w+)", \(([^)]+)\), ([\d.]+), \(([^)]+)\), \(([^)]*)\), "([^"]+)"\)/g;
    const authored = [...source.matchAll(pattern)];
    const vector = text => text.split(',').map(Number);
    assert.equal(authored.length, 19);
    assert.equal(entries.length, authored.length);
    entries.forEach((entry, index) => {
        const [, id, type, pos, radius, forward, nextIds, label] = authored[index];
        assert.equal(entry.id, id);
        assert.equal(entry.type, type);
        assert.deepEqual(entry.pos, vector(pos));
        assert.deepEqual(entry.forward, vector(forward));
        assert.equal(entry.radius, Number(radius));
        assert.equal(entry.params.label, label);
        const declared = [...nextIds.matchAll(/"([A-Z0-9_]+)"/g)].map(match => match[1]);
        assert.deepEqual(entry.nextIds || (index < entries.length - 1 ? [entries[index + 1].id] : []), declared);
    });
    const spawn = vector(/^SPAWN = \(([^)]+)\)/m.exec(source)[1]);
    assert.deepEqual([map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z], spawn);
});

// Adaptive triangle distance proves the whole corridor using the 1-Lipschitz distance bound.
function segmentClear(a, b, triangle, required, depth = 0) {
    const middle = a.clone().lerp(b, 0.5);
    const distance = triangle.closestPointToPoint(middle, new THREE.Vector3()).distanceTo(middle);
    const half = a.distanceTo(b) / 2;
    if (distance < required - 1e-4) return false;
    if (distance >= required + half) return true;
    if (depth >= 18 || half <= 0.001) return false;
    return segmentClear(a, middle, triangle, required, depth + 1)
        && segmentClear(middle, b, triangle, required, depth + 1);
}

test('actual static meshes keep every ring and the complete spawn-to-roof corridor open', async () => {
    const triangles = [];
    for (const stem of staticParts) {
        const model = map.glbModels.find(entry => entry.url === glbPath(stem));
        const { scene } = await placeMapGlbModel(map, model.id);
        scene.traverse(node => {
            if (!node.isMesh || /_nocol/i.test(node.name)) return;
            const position = node.geometry.attributes.position, index = node.geometry.index;
            const count = index ? index.count : position.count;
            for (let offset = 0; offset < count; offset += 3) {
                const points = [0, 1, 2].map(step => new THREE.Vector3().fromBufferAttribute(position,
                    index ? index.getX(offset + step) : offset + step).applyMatrix4(node.matrixWorld));
                const triangle = new THREE.Triangle(...points);
                const center = triangle.getMidpoint(new THREE.Vector3());
                triangles.push({ triangle, center, radius: Math.max(...points.map(point => point.distanceTo(center))), name: node.name });
            }
        });
    }
    assert.ok(triangles.length > 100, 'probe real geometry');
    const rings = [...map.parcours.checkpoints, map.parcours.finish];
    const stops = [{ id: 'SPAWN', pos: Object.values(map.playerSpawn), radius: rings[0].radius }, ...rings];
    for (let i = 1; i < stops.length; i++) {
        const previous = stops[i - 1], stop = stops[i];
        const start = new THREE.Vector3(...previous.pos).multiplyScalar(3);
        const end = new THREE.Vector3(...stop.pos).multiplyScalar(3);
        const required = (Math.min(previous.radius, stop.radius) + 1.5) * 3;
        const ringRequired = (stop.radius + 3) * 3;
        const line = new THREE.Line3(start, end);
        for (const candidate of triangles) {
            if (candidate.center.distanceTo(end) - candidate.radius < ringRequired) {
                const distance = candidate.triangle.closestPointToPoint(end, new THREE.Vector3()).distanceTo(end);
                assert.ok(distance >= ringRequired - 1e-4, `${stop.id} ring vs ${candidate.name}: ${distance / 3}`);
            }
            if (line.closestPointToPoint(candidate.center, true, new THREE.Vector3()).distanceTo(candidate.center)
                - candidate.radius >= required) continue;
            assert.ok(segmentClear(start, end, candidate.triangle, required), `${previous.id}->${stop.id} vs ${candidate.name}`);
        }
    }
    const a = new THREE.Vector3(...rings[0].pos).multiplyScalar(3);
    const b = new THREE.Vector3(...rings[1].pos).multiplyScalar(3);
    const center = a.clone().lerp(b, 0.5);
    const blocker = new THREE.Triangle(center.clone().add(new THREE.Vector3(0, -2, -2)),
        center.clone().add(new THREE.Vector3(0, 2, -2)), center.clone().add(new THREE.Vector3(0, 0, 2)));
    assert.equal(segmentClear(a, b, blocker, 1), false, 'reject a real triangle across the route');
});
