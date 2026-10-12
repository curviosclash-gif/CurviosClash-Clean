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

function webpSize(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    assert.equal(kind, 'VP8X');
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
}

test('garden game variants keep textures at 1024 px or less and constant maps tiny', () => {
    // The 2048 px atlases of the bushes cost about 22 MB of video memory each on the shared-memory
    // reference GPU for a bush that is a few dozen pixels wide in flight; the sky texture of the
    // black hole (4096 px) is showcase content and is left alone.
    const dir = 'assets/models/optimized_cc0/pm-avatar-garden/';
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.glb') && name !== 'BlackHole01.glb')) {
        const { json, binary } = readGlb(`${dir}${file}`);
        for (const image of json.images) {
            const view = json.bufferViews[image.bufferView];
            const [width, height] = webpSize(binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
            assert.ok(Math.max(width, height) <= 1024, `${file}: ${image.name} is ${width}x${height}`);
            if (/metallic/i.test(image.name) && view.byteLength < 400) {
                assert.ok(Math.max(width, height) <= 4, `${file}: constant map ${image.name} is ${width}x${height}`);
            }
        }
    }
});
