import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const EXTENSION = 'EXT_meshopt_compression';
export const CHERRY_TREE_PATH = 'assets/maps/cherry_grove/glb/akebono_01.glb';
const aligned = size => (size + 3) & ~3;

export function readGlb(bytes) {
    if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
        || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB');
    const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
    if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error('Missing GLB binary chunk');
    const document = JSON.parse(bytes.subarray(20, binHeader).toString('utf8'));
    const binary = bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader));
    return { document, binary };
}

function writeGlb(document, binary) {
    const json = Buffer.from(JSON.stringify(document)), jsonSize = aligned(json.length), binSize = aligned(binary.length);
    const result = Buffer.alloc(28 + jsonSize + binSize);
    result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16);
    result.fill(0x20, 20, 20 + jsonSize); json.copy(result, 20);
    result.writeUInt32LE(binSize, 20 + jsonSize); result.writeUInt32LE(0x004e4942, 24 + jsonSize);
    binary.copy(result, 28 + jsonSize);
    return result;
}

export async function decodedViewBytes(document, binary, view) {
    const encoded = view.extensions?.[EXTENSION];
    if (!encoded) return binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    if (encoded.buffer !== 0) throw new Error('Expected embedded compressed buffer');
    await MeshoptDecoder.ready;
    const result = Buffer.alloc(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(result, encoded.count, encoded.byteStride,
        binary.subarray(encoded.byteOffset || 0, (encoded.byteOffset || 0) + encoded.byteLength), encoded.mode, encoded.filter || 'NONE');
    return result;
}

/** Includes every semantic JSON field and all view bytes, excluding only storage/codec layout. */
export async function semanticGlbHash(bytes) {
    const { document, binary } = readGlb(bytes), semantic = structuredClone(document);
    delete semantic.buffers;
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
        if (semantic[key]) {
            semantic[key] = semantic[key].filter(name => name !== EXTENSION);
            if (!semantic[key].length) delete semantic[key];
        }
    }
    for (const view of semantic.bufferViews) {
        delete view.buffer; delete view.byteOffset;
        if (view.extensions?.[EXTENSION]) {
            delete view.extensions[EXTENSION];
            if (!Object.keys(view.extensions).length) delete view.extensions;
        }
    }
    const digest = createHash('sha256').update(JSON.stringify(semantic));
    for (const view of document.bufferViews) digest.update(await decodedViewBytes(document, binary, view));
    return digest.digest('hex');
}

export async function compressCherryGroveTree(bytes) {
    const { document, binary } = readGlb(bytes);
    if (document.extensionsRequired?.includes(EXTENSION)) return bytes;
    if (document.buffers.length !== 1 || document.buffers[0].uri) throw new Error('Expected one embedded buffer');
    const candidates = document.bufferViews.map((view, index) => ({ view, index }))
        .filter(({ view }) => view.target === 34963).sort((a, b) => b.view.byteLength - a.view.byteLength);
    const { view, index } = candidates[0] || {};
    const accessor = document.accessors.find(entry => entry.bufferView === index);
    if (!view || accessor?.componentType !== 5125 || accessor.type !== 'SCALAR'
        || accessor.count * 4 !== view.byteLength || accessor.byteOffset) throw new Error('Expected a complete uint32 index view');
    const start = view.byteOffset || 0, end = start + view.byteLength;
    const original = binary.subarray(start, end);
    await MeshoptEncoder.ready;
    // INDICES preserves every index byte and its order; TRIANGLES may reorder triangles.
    const encoded = MeshoptEncoder.encodeGltfBuffer(original, accessor.count, 4, 'INDICES');
    const compact = Buffer.concat([binary.subarray(0, start), binary.subarray(end, document.buffers[0].byteLength)]);
    const offset = aligned(compact.length), output = Buffer.alloc(offset + encoded.length);
    compact.copy(output); output.set(encoded, offset);
    for (const other of document.bufferViews) {
        if (other === view) continue;
        const from = other.byteOffset || 0;
        if (other.buffer !== 0 || (from < end && from + other.byteLength > start)) throw new Error('Overlapping or external views');
        if (from >= end) other.byteOffset = from - view.byteLength;
    }
    document.buffers = [{ ...document.buffers[0], byteLength: output.length },
        { byteLength: view.byteLength, extensions: { [EXTENSION]: { fallback: true } } }];
    view.buffer = 1; view.byteOffset = 0;
    view.extensions = { ...view.extensions, [EXTENSION]: {
        buffer: 0, byteOffset: offset, byteLength: encoded.length, byteStride: 4, count: accessor.count, mode: 'INDICES',
    } };
    document.extensionsUsed = [...new Set([...(document.extensionsUsed || []), EXTENSION])];
    document.extensionsRequired = [...new Set([...(document.extensionsRequired || []), EXTENSION])];
    const packed = writeGlb(document, output);
    if (packed.length >= bytes.length || await semanticGlbHash(packed) !== await semanticGlbHash(bytes)) {
        throw new Error('Compression did not preserve the complete model or reduce its size');
    }
    return packed;
}

/** Authoring tools can reimport the exact decoded model even without the runtime codec. */
export async function decompressCherryGroveTree(bytes) {
    const { document, binary } = readGlb(bytes);
    if (!document.extensionsRequired?.includes(EXTENSION)) return bytes;
    const chunks = [binary.subarray(0, document.buffers[0].byteLength)];
    let length = chunks[0].length;
    for (const view of document.bufferViews) {
        if (!view.extensions?.[EXTENSION]) continue;
        const decoded = await decodedViewBytes(document, binary, view), offset = aligned(length);
        chunks.push(Buffer.alloc(offset - length), decoded);
        length = offset + decoded.length;
        view.buffer = 0; view.byteOffset = offset;
        delete view.extensions[EXTENSION];
        if (!Object.keys(view.extensions).length) delete view.extensions;
    }
    document.buffers = [{ ...document.buffers[0], byteLength: length }];
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
        if (document[key]) {
            document[key] = document[key].filter(name => name !== EXTENSION);
            if (!document[key].length) delete document[key];
        }
    }
    return writeGlb(document, Buffer.concat(chunks));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const decode = process.argv[2] === '--decode', source = decode ? process.argv[3] : CHERRY_TREE_PATH;
    const target = decode ? process.argv[4] : source;
    if (!source || !target || (decode && source === target)) throw new Error('Decode needs separate input and output paths');
    const before = await readFile(source), after = await (decode ? decompressCherryGroveTree(before) : compressCherryGroveTree(before));
    if (await semanticGlbHash(after) !== await semanticGlbHash(before)) throw new Error('Decoded model differs');
    await writeFile(target, after);
    console.log(JSON.stringify({ path: target, before: before.length, after: after.length,
        saved: before.length - after.length, semanticSha256: await semanticGlbHash(after) }));
}
