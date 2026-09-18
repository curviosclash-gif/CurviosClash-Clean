import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DANDELION_SKY_MAP } from '../src/core/config/maps/presets/dandelion_sky.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { DandelionSeedController } from '../src/entities/arena/DandelionSeedController.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'assets', 'models', 'giant_dandelion');

function parseGlb(buffer) {
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
    assert.equal(buffer.readUInt32LE(4), 2);
    assert.equal(buffer.readUInt32LE(8), buffer.length);
    const jsonLength = buffer.readUInt32LE(12);
    assert.equal(buffer.toString('ascii', 16, 20), 'JSON');
    const document = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
    return { document, buffer, binaryStart: 20 + jsonLength + 8 };
}

function accessorEndpoint(glb, accessorIndex, last) {
    const accessor = glb.document.accessors[accessorIndex];
    assert.equal(accessor.componentType, 5126);
    assert.equal(accessor.type, 'VEC3');
    const view = glb.document.bufferViews[accessor.bufferView];
    const base = glb.binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    const offset = base + (last ? accessor.count - 1 : 0) * stride;
    return [0, 1, 2].map((axis) => glb.buffer.readFloatLE(offset + axis * 4));
}

function triangleCount(document) {
    let count = 0;
    for (const mesh of document.meshes ?? []) {
        for (const primitive of mesh.primitives ?? []) {
            if ((primitive.mode ?? 4) !== 4 || primitive.indices === undefined) continue;
            count += (document.accessors?.[primitive.indices]?.count ?? 0) / 3;
        }
    }
    return count;
}

function flyingSeeds(document) {
    return document.nodes.map((node, index) => ({ ...node, index }))
        .filter((node) => node.extras?.role === 'flying_seed');
}

function flightPosition(glb, seed, last) {
    const clip = glb.document.animations.find((animation) => animation.name === 'SeedFlight');
    const channel = clip.channels.find((entry) =>
        entry.target.node === seed.index && entry.target.path === 'translation');
    return accessorEndpoint(glb, clip.samplers[channel.sampler].output, last);
}

function assertFlightClip(glb, expectedSeeds) {
    const { document } = glb;
    const seeds = flyingSeeds(document);
    assert.equal(seeds.length, expectedSeeds);
    const clip = document.animations?.find((animation) => animation.name === 'SeedFlight');
    assert.ok(clip, 'SeedFlight animation clip is missing');
    assert.equal(document.animations.length, 1, 'all seed paths must play as one clip');
    const duration = Math.max(...clip.samplers.map((sampler) =>
        document.accessors[sampler.input].max?.[0] ?? 0));
    assert.ok(duration >= 3.99 && duration <= 4.01, `unexpected clip duration: ${duration}`);
    const releases = seeds.map((seed) => seed.extras.release_frame);
    assert.equal(new Set(releases).size, expectedSeeds, 'seeds must launch at distinct times');
    for (const seed of seeds) {
        const paths = clip.channels.filter((channel) => channel.target.node === seed.index)
            .map((channel) => channel.target.path).sort();
        assert.deepEqual(paths, ['rotation', 'scale', 'translation'],
            `${seed.name} must have individual flight, tumble and reveal channels`);
        const start = flightPosition(glb, seed, false);
        const end = flightPosition(glb, seed, true);
        assert.ok(Math.hypot(...end.map((value, axis) => value - start[axis])) > 0.4,
            `${seed.name} must actually travel along its flight path`);
        assert.equal(seed.extras.flight_end_frame, 120);
    }
    return seeds;
}

test('giant dandelion package contains editable source and six QA views', async () => {
    const blend = await stat(path.join(ASSET_DIR, 'blender', 'giant_dandelion.blend'));
    assert.ok(blend.size > 250_000, 'editable Blender source is unexpectedly small');

    for (const view of ['front', 'quarter', 'side', 'top', 'release', 'midflight']) {
        const png = await readFile(path.join(
            ASSET_DIR, 'blender', 'previews', `giant_dandelion_${view}.png`,
        ));
        assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), 640);
        assert.equal(png.readUInt32BE(20), 640);
    }
});

test('seed flight preview is a rendered MP4 video', async () => {
    const video = await readFile(path.join(
        ASSET_DIR, 'blender', 'previews', 'giant_dandelion_seedflight.mp4',
    ));
    assert.ok(video.length > 200_000, 'video preview is unexpectedly small');
    assert.equal(video.toString('ascii', 4, 8), 'ftyp');
});

test('runtime GLBs are valid, animated, and decrease in complexity by LOD', async () => {
    const hero = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion.glb')));
    const lod1 = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_lod1.glb')));
    const lod2 = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_lod2.glb')));
    const collision = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_collision.glb')));

    const counts = [triangleCount(hero.document), triangleCount(lod1.document),
        triangleCount(lod2.document)];
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `LOD counts: ${counts}`);
    assert.ok((hero.document.animations?.length ?? 0) > 0, 'hero GLB must export WindGust animation');
    assert.ok(hero.document.meshes.some((mesh) => mesh.primitives?.some((primitive) => primitive.targets?.length)),
        'hero GLB must contain morph targets');
    const heroSeeds = assertFlightClip(hero, 9);
    const lod1Seeds = assertFlightClip(lod1, 5);
    const tilts = heroSeeds.map((seed) => seed.extras.release_tilt_deg);
    assert.ok(tilts.filter((tilt) => tilt < 25).length >= 2,
        'at least two seeds should release nearly vertically');
    assert.ok(tilts.filter((tilt) => tilt > 65).length >= 2,
        'at least two seeds should release nearly horizontally');
    assert.ok(tilts.every((tilt) => tilt >= 0 && tilt <= 90));
    assert.ok(heroSeeds[0].extras.release_frame > heroSeeds.at(-1).extras.release_frame,
        'near seeds should release after far seeds');
    assert.deepEqual(lod1Seeds.map((seed) => seed.extras.seed_index), [1, 3, 5, 7, 9]);
    assert.deepEqual(lod1Seeds.map((seed) => seed.extras.release_frame),
        heroSeeds.filter((seed) => seed.extras.seed_index % 2 === 1)
            .map((seed) => seed.extras.release_frame));
    for (const seed of lod1Seeds) {
        const heroSeed = heroSeeds.find((candidate) =>
            candidate.extras.seed_index === seed.extras.seed_index);
        assert.equal(seed.extras.release_tilt_deg, heroSeed.extras.release_tilt_deg,
            `${seed.name} must keep the hero release angle`);
        const distance = Math.hypot(...flightPosition(lod1, seed, true)
            .map((value, axis) => value - flightPosition(hero, heroSeed, true)[axis]));
        assert.ok(distance < 0.001, `${seed.name} must match the hero flight path`);
    }
    assert.equal(flyingSeeds(lod2.document).length, 0, 'far LOD should omit airborne seeds');
    assert.ok(triangleCount(collision.document) <= 500, 'collision proxy exceeds its triangle budget');
});

test('shootable GLB keeps every visible attached seed as an individually addressable node', async () => {
    const { document } = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_shootable.glb')));
    const seeds = document.nodes.filter((node) => node.extras?.role === 'shootable_seed');
    const core = document.nodes.find((node) => node.extras?.role === 'receptacle_and_bracts');
    assert.ok(seeds.length >= 180 && seeds.length <= 252);
    assert.equal(seeds.length, core.extras.attached_seed_count);
    assert.equal(new Set(seeds.map((seed) => seed.extras.seed_index)).size, seeds.length);
    assert.ok(seeds.every((seed) => seed.mesh !== undefined
        && seed.name.endsWith('_nocol')
        && seed.extras.pappus_height > 1.6
        && seed.extras.pappus_height < 2));
    assert.equal(document.animations?.length ?? 0, 0,
        'runtime flight must be triggered by hits, not autoplayed');
});

test('new dandelion map scales the reusable flower to Eiffel height and is selectable', () => {
    const map = DANDELION_SKY_MAP.dandelion_sky;
    assert.equal(MAP_PRESET_CATALOG.dandelion_sky, map);
    assert.equal(MAP_PRESETS_BASE.dandelion_sky, map);
    assert.equal(resolveMapPickerCollection('dandelion_sky').id, 'adventure');
    assert.equal(map.glbModels[0].targetSize, 330);
    assert.equal(map.glbModels[0].url, 'assets/models/giant_dandelion/giant_dandelion_shootable.glb');
    assert.ok(map.size[1] > map.glbModels[0].targetSize);
    assert.equal(map.singlePlayerScenario.gameMode, 'HUNT');
});

test('the actual shootable GLB loads at 330 m without 220 seed colliders', async () => {
    const map = DANDELION_SKY_MAP.dandelion_sky;
    const result = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        placementScale: 1,
        colliderMode: map.glbColliderMode,
    });
    const height = new THREE.Box3().setFromObject(result.scene).getSize(new THREE.Vector3()).y;
    assert.ok(Math.abs(height - 330) < 1, `unexpected map flower height: ${height}`);
    assert.ok(result.colliders.length <= 6, 'seeds should not create permanent physics colliders');
    assert.ok(result.colliders.every((collider) => !collider.sourceName.startsWith('AttachedSeed_')));
    const controller = new DandelionSeedController(result.scene);
    assert.ok(controller.count >= 180);
    const seed = controller.seeds[0];
    const origin = seed.tip.clone().addScaledVector(seed.normal, 30);
    const hit = controller.raycast(origin, seed.normal.clone().negate(), 50);
    assert.ok(hit, 'the scaled seed crown must remain hittable');
});
