import * as THREE from 'three';

const SIZE = 64;

/** Small periodic pixel patterns, generated once per runtime, with no canvas or downloaded assets. */
export function createEndlessBiomeTextures(id) {
    const color = new Uint8Array(SIZE * SIZE * 4), emission = new Uint8Array(color.length);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const noise = ((x * 37 + y * 71 + x * y * 13) % 31) / 31;
        let shade = 0.62 + noise * 0.18, glow = 0;
        if (id === 'industrial') {
            const edge = x < 3 || y < 3;
            const warning = y >= 46 && y < 56;
            shade = edge ? 0.25 : warning ? ((x + y) % 20 < 10 ? 0.95 : 0.18) : shade;
            glow = warning && (x + y) % 20 < 10 ? 0.35 : 0;
        } else if (id === 'crystal') {
            const diamond = Math.abs(x % 32 - 16) + Math.abs(y % 32 - 16);
            shade = diamond < 12 ? (x % 32 < 16 ? 0.95 : 0.48) : 0.3 + noise * 0.2;
            glow = diamond < 12 ? 0.35 + (12 - diamond) * 0.045 : 0;
        } else if (id === 'deepsea') {
            shade = 0.45 + Math.sin(y * Math.PI / 8 + Math.sin(x * Math.PI / 16)) * 0.12 + noise * 0.12;
            glow = (x * 11 + y * 17) % 131 < 2 ? 0.6 : 0;
        } else if (id === 'energy') {
            const line = x % 16 < 2 || y % 32 < 2;
            shade = line ? 0.95 : 0.25 + noise * 0.16; glow = line ? 0.95 : 0;
        } else {
            const joint = y % 16 < 2 || (x + (Math.floor(y / 16) % 2) * 16) % 32 < 2;
            const crack = (x * 3 + Math.floor(y / 4) * 7) % 53 < 2;
            shade = joint || crack ? 0.22 : 0.65 + noise * 0.25;
            glow = !joint && (x + 3 * y) % 43 < 2 ? 0.14 : 0;
        }
        const offset = (y * SIZE + x) * 4;
        for (let c = 0; c < 3; c++) { color[offset + c] = Math.round(shade * 255); emission[offset + c] = Math.round((0.18 + glow * 0.82) * 255); }
        color[offset + 3] = 255; emission[offset + 3] = 255;
    }
    const make = data => {
        const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true; texture.needsUpdate = true;
        texture.userData.__sharedNoDispose = true;
        return texture;
    };
    const map = make(color); map.colorSpace = THREE.SRGBColorSpace;
    return { map, emission: make(emission) };
}

/** Preserve the original position/index order; only duplicate seam vertices where UVs wrap. */
export function addEndlessTubeUvs(geometry, radial, axial, length) {
    const original = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const positions = Array.from(original.array), normals = Array.from(normal.array), uv = [];
    const layerVertices = (axial + 1) * radial, regular = layerVertices * 2;
    for (let i = 0; i < original.count; i++) {
        if (i < regular) uv.push(i % radial / radial * 6, Math.floor(i % layerVertices / radial) / axial * length / 24);
        else uv.push((original.getX(i) + original.getY(i)) / 24, original.getZ(i) / 24);
    }
    const indices = Array.from(geometry.index.array), duplicates = new Map();
    for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices.slice(i, i + 3);
        if (triangle.some(index => index >= regular)) continue;
        const sides = triangle.map(index => index % radial);
        if (Math.max(...sides) - Math.min(...sides) <= radial / 2) continue;
        for (let j = 0; j < 3; j++) {
            const index = triangle[j];
            if (index % radial >= radial / 2) continue;
            if (!duplicates.has(index)) {
                duplicates.set(index, positions.length / 3);
                positions.push(original.getX(index), original.getY(index), original.getZ(index));
                normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
                uv.push(uv[index * 2] + 6, uv[index * 2 + 1]);
            }
            indices[i + j] = duplicates.get(index);
        }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
}
