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
    return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
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

test('giant dandelion package contains editable source and four QA views', async () => {
    const blend = await stat(path.join(ASSET_DIR, 'blender', 'giant_dandelion.blend'));
    assert.ok(blend.size > 250_000, 'editable Blender source is unexpectedly small');

    for (const view of ['front', 'quarter', 'side', 'top']) {
        const png = await readFile(path.join(
            ASSET_DIR, 'blender', 'previews', `giant_dandelion_${view}.png`,
        ));
        assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), 640);
        assert.equal(png.readUInt32BE(20), 640);
    }
});

test('runtime GLBs are valid, animated, and decrease in complexity by LOD', async () => {
    const hero = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion.glb')));
    const lod1 = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_lod1.glb')));
    const lod2 = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_lod2.glb')));
    const collision = parseGlb(await readFile(path.join(ASSET_DIR, 'giant_dandelion_collision.glb')));

    const counts = [triangleCount(hero), triangleCount(lod1), triangleCount(lod2)];
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `LOD counts: ${counts}`);
    assert.ok((hero.animations?.length ?? 0) > 0, 'hero GLB must export WindGust animation');
    assert.ok(hero.meshes.some((mesh) => mesh.primitives?.some((primitive) => primitive.targets?.length)),
        'hero GLB must contain morph targets');
    assert.ok(triangleCount(collision) <= 500, 'collision proxy exceeds its triangle budget');
});
