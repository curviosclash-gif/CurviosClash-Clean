import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// The generated maps carry their surface variation in COLOR_0, a vertex colour stream glTF
// multiplies onto the material's base colour. Two things about that encoding are easy to break and
// invisible until someone looks at the map:
//
//  1. The exporter writes COLOR_0 as a normalised ushort. A value above 1.0 does not clamp, it
//     wraps -- 1.02 comes back as 0.02 and turns one element black. The generator only darkens for
//     exactly this reason, so any value near zero means something started brightening again.
//  2. The stream can simply stop being written (an export flag lost in a refactor), which no
//     geometry check would notice.
//
// This reads the shipped files rather than regenerating them, so it needs no Blender.

const GLB_DIR = 'assets/maps/burg_falkenwacht/glb';

// The darkest the pipeline can legitimately go: full occlusion at AO_STRENGTH 0.7 leaves 0.3, and
// the strongest grain multiplies that by roughly 0.76. Anything materially below that is a wrapped
// value, not an authored one.
const DARKEST_LEGITIMATE = 0.18;

function readGlbJson(path) {
    const buffer = readFileSync(path);
    assert.equal(buffer.readUInt32LE(0), 0x46546c67, `${path} is not a GLB`);
    const jsonLength = buffer.readUInt32LE(12);
    const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
    const padded = jsonLength + (jsonLength % 4 ? 4 - (jsonLength % 4) : 0);
    return { json, binary: buffer.subarray(20 + padded + 8) };
}

function readColorChannels({ json, binary }, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const components = accessor.type === 'VEC4' ? 4 : 3;
    // 5121 unsigned byte, 5123 unsigned short, 5126 float. Only the first two are normalised.
    const width = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : 1;
    const scale = accessor.componentType === 5126 ? 1 : accessor.componentType === 5123 ? 65535 : 255;
    const stride = view.byteStride || components * width;
    const values = [];
    for (let index = 0; index < accessor.count; index += 1) {
        // Alpha is always written as 1 and carries no meaning here.
        for (let channel = 0; channel < 3; channel += 1) {
            const offset = start + index * stride + channel * width;
            const raw = accessor.componentType === 5126
                ? binary.readFloatLE(offset)
                : accessor.componentType === 5123
                    ? binary.readUInt16LE(offset)
                    : binary.readUInt8(offset);
            values.push(raw / scale);
        }
    }
    return values;
}

// Returns a function mapping a vertex index to a rounded "x,y,z" key. Rounding to a thousandth is
// far finer than any authored offset in these maps (the shallowest is 0.035) and far coarser than
// float32 noise at castle scale.
function pointReader({ json, binary }, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const stride = view.byteStride || 12;
    const cache = new Map();
    return (index) => {
        const hit = cache.get(index);
        if (hit !== undefined) return hit;
        const offset = start + index * stride;
        const key = [0, 1, 2]
            .map((axis) => binary.readFloatLE(offset + axis * 4).toFixed(3))
            .join(',');
        cache.set(index, key);
        return key;
    };
}

const files = readdirSync(GLB_DIR).filter((name) => name.endsWith('.glb')).sort();

test('falkenwacht ships vertex colours on its static geometry', () => {
    assert.ok(files.length >= 9, `expected the generated set, found ${files.length} files`);
    let withColor = 0;
    for (const name of files) {
        const glb = readGlbJson(join(GLB_DIR, name));
        for (const mesh of glb.json.meshes || []) {
            for (const primitive of mesh.primitives || []) {
                if (primitive.attributes?.COLOR_0 !== undefined) withColor += 1;
            }
        }
    }
    // Measured at 70 primitives when the grain and the occlusion bake were introduced. Parts that
    // come back fully neutral have their layer pruned on export, so this is a floor, not a count.
    assert.ok(withColor >= 50, `only ${withColor} primitives carry COLOR_0`);
});

test('colliding meshes are closed volumes', () => {
    // The mesh collider decides "is this point inside?" by counting ray crossings: an odd count
    // means inside. That only holds for closed geometry. A surface with an open side, or one drawn
    // as single faces, flips the count and parks a player inside apparently empty air.
    //
    // A closed surface has every edge shared by exactly two triangles. Edges are keyed by vertex
    // POSITION, not by index: the exporter splits vertices so each face can carry its own normal,
    // so after export a cube's corner exists three times over and nothing shares an index. The
    // collider works on triangle coordinates too, so position is also the definition that matters.
    //
    // Meshes marked _nocol carry no collision, so their geometry is free to be open.
    const openMeshes = [];
    for (const name of files) {
        const glb = readGlbJson(join(GLB_DIR, name));
        for (const mesh of glb.json.meshes || []) {
            if (String(mesh.name || '').toLowerCase().includes('_nocol')) continue;
            for (const primitive of mesh.primitives || []) {
                if (primitive.indices === undefined) continue;
                const accessor = glb.json.accessors[primitive.indices];
                const view = glb.json.bufferViews[accessor.bufferView];
                const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
                const width = accessor.componentType === 5125 ? 4 : 2;
                const read = (at) => (width === 4
                    ? glb.binary.readUInt32LE(start + at * 4)
                    : glb.binary.readUInt16LE(start + at * 2));
                const point = pointReader(glb, primitive.attributes.POSITION);

                const edges = new Map();
                for (let index = 0; index + 2 < accessor.count; index += 3) {
                    const corners = [
                        point(read(index)), point(read(index + 1)), point(read(index + 2)),
                    ];
                    for (let corner = 0; corner < 3; corner += 1) {
                        const from = corners[corner];
                        const to = corners[(corner + 1) % 3];
                        const key = from < to ? `${from}|${to}` : `${to}|${from}`;
                        edges.set(key, (edges.get(key) || 0) + 1);
                    }
                }
                // An ODD number of faces on an edge is the hole. Four is not: adjoining solids that
                // share a touching face, like the voussoirs of an arch, put two coincident faces
                // there. A ray crosses both, the parity is unchanged, and the collider stays
                // correct -- so this checks parity rather than insisting on exactly two.
                let dangling = 0;
                for (const count of edges.values()) {
                    if (count % 2 !== 0) dangling += 1;
                }
                if (dangling > 0) {
                    openMeshes.push(`${name} / ${mesh.name}: ${dangling} edges with an odd face count`);
                }
            }
        }
    }
    assert.deepEqual(openMeshes, [], `open collision geometry:\n${openMeshes.join('\n')}`);
});

test('no vertex colour wrapped past the top of the ushort range', () => {
    for (const name of files) {
        const glb = readGlbJson(join(GLB_DIR, name));
        for (const mesh of glb.json.meshes || []) {
            for (const primitive of mesh.primitives || []) {
                const accessorIndex = primitive.attributes?.COLOR_0;
                if (accessorIndex === undefined) continue;
                const values = readColorChannels(glb, accessorIndex);
                const darkest = Math.min(...values);
                assert.ok(
                    darkest >= DARKEST_LEGITIMATE,
                    `${name} / ${mesh.name}: channel value ${darkest.toFixed(4)} is below `
                    + `${DARKEST_LEGITIMATE}, which is what a value above 1.0 looks like after it wraps`
                );
                assert.ok(
                    Math.max(...values) <= 1.0001,
                    `${name} / ${mesh.name}: channel value above 1.0 would wrap on export`
                );
            }
        }
    }
});
