import * as THREE from 'three';

function waveCrestFactor(normalizedX) {
    return 0.84 + Math.sin(normalizedX * 11.3) * 0.055
        + Math.sin(normalizedX * 23.7) * 0.035;
}

export function createWaveFrontGeometry(width, height, depth, travelSign, segments = 48, rows = 6) {
    const positions = new Float32Array((segments + 1) * (rows + 1) * 3);
    const indices = [];
    for (let column = 0; column <= segments; column += 1) {
        const across = column / segments;
        const normalizedX = across * 2 - 1;
        const arch = Math.max(0, 1 - normalizedX * normalizedX);
        const crest = waveCrestFactor(normalizedX);
        for (let row = 0; row <= rows; row += 1) {
            const up = row / rows;
            const offset = (column * (rows + 1) + row) * 3;
            positions[offset] = -width / 2 + width * across;
            positions[offset + 1] = height * up * crest;
            positions[offset + 2] = travelSign * depth * arch * (0.28 + up * 0.72);
        }
    }
    for (let column = 0; column < segments; column += 1) {
        for (let row = 0; row < rows; row += 1) {
            const current = column * (rows + 1) + row;
            const next = current + rows + 1;
            indices.push(current, next, next + 1, current, next + 1, current + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function createWaveFoamGeometry(width, height, depth, travelSign, segments = 48) {
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];
    for (let column = 0; column <= segments; column += 1) {
        const across = column / segments;
        const normalizedX = across * 2 - 1;
        const arch = Math.max(0, 1 - normalizedX * normalizedX);
        const base = column * 6;
        const y = height * waveCrestFactor(normalizedX);
        const z = travelSign * depth * arch;
        positions.set([-width / 2 + width * across, y, z], base);
        positions.set([-width / 2 + width * across, y - height * 0.13,
            z - travelSign * depth * 0.08], base + 3);
        if (column < segments) {
            const vertex = column * 2;
            indices.push(vertex, vertex + 2, vertex + 3, vertex, vertex + 3, vertex + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function createBreachCrestGeometry(width, height, segments = 48) {
    const positions = [];
    const indices = [];
    for (let index = 0; index < segments; index += 1) {
        const x0 = -width / 2 + width * index / segments;
        const x1 = -width / 2 + width * (index + 1) / segments;
        const y0 = height * (0.78 + Math.sin(index * 1.71) * 0.09 + Math.sin(index * 0.37) * 0.08);
        const y1 = height * (0.78 + Math.sin((index + 1) * 1.71) * 0.09
            + Math.sin((index + 1) * 0.37) * 0.08);
        const vertex = positions.length / 3;
        const depth = height * 0.28;
        positions.push(x0, 0, -depth, x1, 0, -depth, x1, y1, 0, x0, y0, 0,
            x0, 0, depth, x1, 0, depth);
        indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3,
            vertex + 3, vertex + 2, vertex + 5, vertex + 3, vertex + 5, vertex + 4,
            vertex + 4, vertex + 5, vertex + 1, vertex + 4, vertex + 1, vertex);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function createJetGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    geometry.setIndex([
        0, 1, 3, 1, 2, 3, 4, 7, 5, 5, 7, 6,
        0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
        1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4,
    ]);
    return geometry;
}

export function updateJetGeometry(positions, nearWidth, farWidth, farHeight, length, height) {
    const values = positions.array;
    values[0] = -nearWidth; values[1] = 0; values[2] = 0;
    values[3] = nearWidth; values[4] = 0; values[5] = 0;
    values[6] = farWidth; values[7] = farHeight; values[8] = length;
    values[9] = -farWidth; values[10] = farHeight; values[11] = length;
    values[12] = -nearWidth; values[13] = height; values[14] = 0;
    values[15] = nearWidth; values[16] = height; values[17] = 0;
    values[18] = farWidth; values[19] = 0; values[20] = length;
    values[21] = -farWidth; values[22] = 0; values[23] = length;
    positions.needsUpdate = true;
}

function deterministicUnit(index, salt) {
    const value = Math.sin((index + 1) * (12.9898 + salt)) * 43758.5453;
    return value - Math.floor(value);
}

export function createWaveSprayGeometry(width, height, depth, travelSign, count = 96) {
    const positions = new Float32Array(count * 3);
    const baseY = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        const x = (deterministicUnit(index, 0.13) - 0.5) * width;
        const y = (0.15 + deterministicUnit(index, 0.47) * 0.85) * height;
        const normalizedX = x / (width * 0.5);
        const arch = Math.max(0, 1 - normalizedX * normalizedX);
        const z = travelSign * depth * arch
            + (deterministicUnit(index, 0.91) - 0.5) * height * 0.24;
        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;
        baseY[index] = y;
        phases[index] = deterministicUnit(index, 1.37) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry, baseY, phases };
}

export function createSoftSprayTexture() {
    const size = 16;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const distance = Math.hypot((x + 0.5 - size / 2) / (size / 2),
                (y + 0.5 - size / 2) / (size / 2));
            const offset = (y * size + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = Math.round(180 * Math.max(0, 1 - distance) ** 2);
        }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
}
