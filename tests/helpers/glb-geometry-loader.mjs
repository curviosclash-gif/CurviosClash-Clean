import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Node collision probes retain the exported meshes, transforms and animation bytes.
// Only materials are omitted because image decoding needs a browser; desktop tests
// load the original files and cover their textures and rendering separately.
export const geometryOnlyGlbLoader = {
    async loadAsync(url) {
        const bytes = readFileSync(url);
        const length = bytes.readUInt32LE(12);
        const json = JSON.parse(bytes.subarray(20, 20 + length));
        for (const mesh of json.meshes || []) {
            for (const primitive of mesh.primitives) delete primitive.material;
        }
        delete json.materials;
        delete json.textures;
        delete json.images;
        const encoded = Buffer.from(JSON.stringify(json));
        const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
        encoded.copy(padded);
        const binaryChunk = bytes.subarray(20 + length);
        const result = Buffer.alloc(20 + padded.length + binaryChunk.length);
        result.writeUInt32LE(0x46546c67, 0);
        result.writeUInt32LE(2, 4);
        result.writeUInt32LE(result.length, 8);
        result.writeUInt32LE(padded.length, 12);
        result.writeUInt32LE(0x4e4f534a, 16);
        padded.copy(result, 20);
        binaryChunk.copy(result, 20 + padded.length);
        return new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength), '');
    },
};
