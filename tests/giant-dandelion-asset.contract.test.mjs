import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
    assert.ok(heroSeeds[0].extras.release_frame > heroSeeds.at(-1).extras.release_frame,
        'near seeds should release after far seeds');
    assert.deepEqual(lod1Seeds.map((seed) => seed.extras.seed_index), [1, 3, 5, 7, 9]);
    assert.deepEqual(lod1Seeds.map((seed) => seed.extras.release_frame),
        heroSeeds.filter((seed) => seed.extras.seed_index % 2 === 1)
            .map((seed) => seed.extras.release_frame));
    for (const seed of lod1Seeds) {
        const heroSeed = heroSeeds.find((candidate) =>
            candidate.extras.seed_index === seed.extras.seed_index);
        const distance = Math.hypot(...flightPosition(lod1, seed, true)
            .map((value, axis) => value - flightPosition(hero, heroSeed, true)[axis]));
        assert.ok(distance < 0.001, `${seed.name} must match the hero flight path`);
    }
    assert.equal(flyingSeeds(lod2.document).length, 0, 'far LOD should omit airborne seeds');
    assert.ok(triangleCount(collision.document) <= 500, 'collision proxy exceeds its triangle budget');
});
