import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { CHERRY_GROVE_MAPS } from '../src/core/config/maps/presets/cherry_grove.js';
import { CHERRY_GROVE_PLANTS } from '../src/core/config/maps/presets/cherry_grove/CherryGrovePlants.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { CherryLeafController } from '../src/entities/arena/CherryLeafController.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { isBeatAlignedClipDuration } from '../src/shared/contracts/MapAnimationClockContract.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const map = CHERRY_GROVE_MAPS.cherry_grove;
const oldSizes = [9.8, 10.2, 9.4, 10.5, 9.6, 8, 8.4, 7.7, 8.5, 7.9];
const manifest = JSON.parse(readFileSync(new URL('../assets/models/meadow_plants/manifest.json', import.meta.url)));

test('all ten actual tree placements grow by exactly fifteen, including their hidden trunks', async () => {
    const trees = map.glbModels.filter((model) => model.id.endsWith('-render'));
    const trunks = map.glbModels.filter((model) => model.collisionOnly);
    assert.equal(trees.length, 10);
    const anchors = [map.playerSpawn, ...map.botSpawns,
        ...map.items.map(({ pos: [x, y, z] }) => ({ x, y, z })),
        ...map.portals.flatMap(({ a, b }) => [a, b].map(([x, y, z]) => ({ x, y, z })))];
    for (const [index, tree] of trees.entries()) {
        assert.equal(tree.targetSize, oldSizes[index] * 15);
        assert.equal(trunks[index].scale, 15);
        const load = async (render, trunk) => loadGLBMapCollection([render, trunk], {
            loader: geometryOnlyGlbLoader, placementScale: 3, colliderMode: 'scene', requireComplete: true,
        });
        const baseline = await load({ ...tree, targetSize: oldSizes[index] }, { ...trunks[index], scale: 1 });
        const giant = await load(tree, trunks[index]);
        try {
            for (const id of [tree.id, trunks[index].id]) {
                const bounds = (result) => new THREE.Box3().setFromObject(result.scene.getObjectByName(`glb-slot-${id}`));
                const before = bounds(baseline).getSize(new THREE.Vector3());
                const afterBox = bounds(giant);
                const after = afterBox.getSize(new THREE.Vector3());
                for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(after[axis] / before[axis] - 15) < 1e-5, `${id} ${axis}`);
                assert.ok(Math.abs(afterBox.min.y - 12) < 1e-4, `${id} stands on the floor`);
                assert.ok(afterBox.max.y < map.size[1] * 3, `${id} fits below the flight ceiling`);
            }
            assert.ok(giant.colliders.length > 0);
            for (const anchor of anchors) {
                const point = new THREE.Vector3(anchor.x, anchor.y, anchor.z).multiplyScalar(3);
                assert.ok(!giant.colliders.some((c) => sphereIntersectsStaticMeshCollider(c.meshCollider, point, 3)),
                    `${tree.id} blocks anchor ${JSON.stringify(anchor)}`);
            }
            const hub = new THREE.Vector3(0, 24, 0);
            const routes = anchors.map(({ x, y, z }) => [new THREE.Vector3(x, y, z).multiplyScalar(3), hub]);
            routes.push([new THREE.Vector3(0, 24, -492), new THREE.Vector3(0, 24, 492)],
                [hub, new THREE.Vector3(0, 540, 0)]);
            for (const [start, end] of routes) {
                const steps = Math.ceil(start.distanceTo(end) / 3);
                for (let step = 0; step <= steps; step += 1) {
                    const point = start.clone().lerp(end, step / steps);
                    // Radius includes half a sampling interval, covering the continuous corridor.
                    assert.ok(!giant.colliders.some((c) => sphereIntersectsStaticMeshCollider(c.meshCollider, point, 4.5)),
                        `${tree.id} blocks a flight corridor`);
                }
            }
            const leaves = new CherryLeafController(giant.scene);
            assert.equal(leaves.count, 48);
            const point = leaves.leaves[0].releasePosition.clone();
            const start = point.clone().add(new THREE.Vector3(-12, 0, 0));
            const end = point.clone().add(new THREE.Vector3(12, 0, 0));
            assert.ok(leaves.releaseNearPass(start, end, 0, 2) > 0, 'a fast crown pass releases giant leaves');
            const saved = leaves.serialize();
            leaves.update(3);
            leaves.reset();
            assert.equal(leaves.events.length, 0);
            const offset = new THREE.Vector3(0, 20, 0);
            assert.equal(leaves.releaseNearPass(start.clone().add(offset), end.clone().add(offset), 0, 2), 0, 'nearby empty air is not a leaf hit');
            leaves.applyNetworkState(saved);
            assert.deepEqual(leaves.serialize(), saved, 'host/replay restoration keeps the releases');
        } finally {
            disposeObject3DResources(baseline.scene);
            disposeObject3DResources(giant.scene);
        }
    }
});

test('twelve imported species retain editable sources, vertex colors, wind and two static LODs', async () => {
    assert.equal(manifest.plants.length, 12);
    assert.equal(new Set(CHERRY_GROVE_PLANTS.filter((m) => m.url.includes('/meadow_plants/')).map((m) => m.url)).size, 12);
    for (const plant of manifest.plants) {
        assert.equal(plant.files.length, 4);
        for (const file of plant.files) {
            const url = new URL(`../assets/models/meadow_plants/${file.path}`, import.meta.url);
            const bytes = readFileSync(url);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
            if (file.path.endsWith('.blend')) {
                assert.equal(bytes.subarray(0, 7).toString(), 'BLENDER');
                continue;
            }
            const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
            assert.equal(document.images?.length || 0, 0, 'no missing external textures');
            assert.ok(document.meshes.every((mesh) => mesh.primitives.every((p) => p.attributes.COLOR_0 !== undefined)));
            const gltf = await geometryOnlyGlbLoader.loadAsync(url);
            try {
                const bounds = new THREE.Box3().setFromObject(gltf.scene);
                assert.ok(!bounds.isEmpty());
                if (file.path.includes('_lod')) assert.equal(gltf.animations.length, 0);
                else {
                    assert.equal(gltf.animations.length, 1);
                    assert.ok(gltf.animations[0].tracks.every((track) => track.name.endsWith('.morphTargetInfluences')));
                    const mixer = new THREE.AnimationMixer(gltf.scene);
                    const action = mixer.clipAction(gltf.animations[0]).play();
                    const driver = new GlbAnimationDriver();
                    const descriptor = CHERRY_GROVE_PLANTS.find((model) => model.url.endsWith(`/${plant.name}.glb`));
                    assert.ok(isBeatAlignedClipDuration(gltf.animations[0].duration, descriptor.animationClock), `${plant.name} wind beat matches its actual clip`);
                    driver.setTracks([{ mixer, action, durationSeconds: gltf.animations[0].duration,
                        clock: { ...descriptor.animationClock, playbackRate: 1, mode: 'loop' } }]);
                    const weights = () => { const values = []; gltf.scene.traverse((n) => { if (n.morphTargetInfluences) values.push(...n.morphTargetInfluences); }); return values; };
                    driver.setElapsedSeconds(0.1); const first = weights();
                    driver.setElapsedSeconds(0.7); assert.notDeepEqual(weights(), first, `${plant.name} wind moves`);
                    driver.setElapsedSeconds(0.1); assert.deepEqual(weights(), first, `${plant.name} wind rewinds`);
                    driver.clear();
                }
            } finally { disposeObject3DResources(gltf.scene); }
        }
    }
    for (const model of CHERRY_GROVE_PLANTS) {
        assert.equal(model.collision, false);
        assert.equal(model.role, 'optionalProp');
        assert.equal(model.position[1], 4);
        assert.ok(model.maxRenderDistance >= map.lighting.fog.far / 3 + model.targetSize * 1.225);
    }
});
