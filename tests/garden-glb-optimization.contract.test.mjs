import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

function readGlb(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const length = bytes.readUInt32LE(12);
    return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length)), binary: bytes.subarray(28 + length) };
}

test('garden game variants retain geometry and animation bytes with a smaller texture payload', () => {
    const root = 'assets/models/';
    let originalBytes = 0; let optimizedBytes = 0;
    for (const file of readdirSync(`${root}downloaded_cc0/pm-avatar-garden`).filter((name) => name.endsWith('.glb'))) {
        const original = readGlb(`${root}downloaded_cc0/pm-avatar-garden/${file}`);
        const optimized = readGlb(`${root}optimized_cc0/pm-avatar-garden/${file}`);
        for (const key of ['nodes', 'meshes', 'accessors', 'animations', 'skins', 'scenes', 'materials']) {
            assert.deepEqual(optimized.json[key], original.json[key], `${file}: ${key}`);
        }
        const imageViews = new Set(original.json.images.map((image) => image.bufferView));
        original.json.bufferViews.forEach((view, index) => {
            if (imageViews.has(index)) return;
            const target = optimized.json.bufferViews[index];
            assert.deepEqual(
                optimized.binary.subarray(target.byteOffset || 0, (target.byteOffset || 0) + target.byteLength),
                original.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength),
                `${file}: geometry/animation buffer ${index}`,
            );
        });
        assert.ok(optimized.json.extensionsRequired.includes('EXT_texture_webp'));
        assert.ok(optimized.bytes.length < original.bytes.length);
        originalBytes += original.bytes.length;
        optimizedBytes += optimized.bytes.length;
    }
    assert.ok(optimizedBytes < originalBytes * 0.6, `${optimizedBytes} / ${originalBytes}`);
});
