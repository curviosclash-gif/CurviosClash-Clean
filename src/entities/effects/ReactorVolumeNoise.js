import * as THREE from 'three';

// A tileable 3D cloud noise for the volumetric mushroom cloud. Built once per page and shared:
// red holds billowy Perlin-Worley (round cauliflower cells with soft fbm between them), green,
// blue and alpha hold inverted Worley noise at three finer frequencies for erosion. Every
// channel wraps at the texture's edges, so the ring can be wrapped in whole repeats with no seam.
export const VOLUME_NOISE_SIZE = 64;

function hash3(x, y, z, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One jittered feature point per cell of a `cells`-cube, wrapping. */
function featurePoints(cells, seed) {
    const points = new Float32Array(cells * cells * cells * 3);
    for (let z = 0, i = 0; z < cells; z += 1) {
        for (let y = 0; y < cells; y += 1) {
            for (let x = 0; x < cells; x += 1, i += 3) {
                points[i] = hash3(x, y, z, seed); points[i + 1] = hash3(x, y, z, seed + 1); points[i + 2] = hash3(x, y, z, seed + 2);
            }
        }
    }
    return points;
}

/** Inverted Worley: 1 at feature points, falling to 0 a cell away; wraps at `cells`. */
function worley(x, y, z, cells, points) {
    const px = x * cells, py = y * cells, pz = z * cells;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let nearest = 9;
    for (let dz = -1; dz <= 1; dz += 1) {
        const iz = cz + dz, wz = iz < 0 ? iz + cells : iz >= cells ? iz - cells : iz;
        for (let dy = -1; dy <= 1; dy += 1) {
            const iy = cy + dy, wy = iy < 0 ? iy + cells : iy >= cells ? iy - cells : iy;
            for (let dx = -1; dx <= 1; dx += 1) {
                const ix = cx + dx, wx = ix < 0 ? ix + cells : ix >= cells ? ix - cells : ix;
                const k = ((wz * cells + wy) * cells + wx) * 3;
                const fx = ix + points[k] - px, fy = iy + points[k + 1] - py, fz = iz + points[k + 2] - pz;
                const d = fx * fx + fy * fy + fz * fz;
                if (d < nearest) nearest = d;
            }
        }
    }
    return 1 - Math.min(1, Math.sqrt(nearest));
}

/** Lattice values of one fbm octave, wrapping at `period`. */
function lattice(period, seed) {
    const values = new Float32Array(period * period * period);
    for (let z = 0, i = 0; z < period; z += 1) {
        for (let y = 0; y < period; y += 1) {
            for (let x = 0; x < period; x += 1, i += 1) values[i] = hash3(x, y, z, seed);
        }
    }
    return values;
}

/** Tileable value-noise fbm over precomputed octave lattices. */
function fbm(x, y, z, octaves) {
    let sum = 0, amplitude = 0.5, norm = 0;
    for (const { period, values } of octaves) {
        const px = x * period, py = y * period, pz = z * period;
        const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
        const fx = px - ix, fy = py - iy, fz = pz - iz;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
        const x0 = ix % period, y0 = iy % period, z0 = iz % period;
        const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period, z1 = (z0 + 1) % period;
        const at = (a, b, c) => values[(c * period + b) * period + a];
        const lerp = (a, b, t) => a + (b - a) * t;
        const value = lerp(
            lerp(lerp(at(x0, y0, z0), at(x1, y0, z0), sx), lerp(at(x0, y1, z0), at(x1, y1, z0), sx), sy),
            lerp(lerp(at(x0, y0, z1), at(x1, y0, z1), sx), lerp(at(x0, y1, z1), at(x1, y1, z1), sx), sy), sz);
        sum += value * amplitude; norm += amplitude; amplitude *= 0.5;
    }
    return sum / norm;
}

/**
 * RGBA bytes of the noise volume; deterministic, so every client sees the same cloud. `slices`
 * limits how many layers one call fills, starting at `from`, so the work can be spread over
 * frames instead of stalling the map load for about four tenths of a second.
 */
export function buildVolumeNoiseData(size = VOLUME_NOISE_SIZE, data = new Uint8Array(size * size * size * 4), from = 0, slices = size) {
    const w4 = featurePoints(4, 11), w8 = featurePoints(8, 23), w16 = featurePoints(16, 37);
    const e8 = featurePoints(8, 61), e16 = featurePoints(16, 73), e32 = featurePoints(32, 89);
    const octaves = [4, 8, 16, 32].map((period, octave) => ({ period, values: lattice(period, 51 + octave * 7) }));
    const until = Math.min(size, from + slices);
    let offset = from * size * size * 4;
    for (let z = from; z < until; z += 1) {
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const u = x / size, v = y / size, w = z / size;
                const cells = worley(u, v, w, 4, w4) * 0.625 + worley(u, v, w, 8, w8) * 0.25 + worley(u, v, w, 16, w16) * 0.125;
                // Perlin-Worley: the fbm is remapped into the cells, which rounds the billows.
                const soft = fbm(u, v, w, octaves);
                const billow = Math.min(1, Math.max(0, (soft - (1 - cells)) / Math.max(0.05, cells) * 0.5 + cells * 0.5));
                data[offset] = Math.round(billow * 255);
                data[offset + 1] = Math.round(worley(u, v, w, 8, e8) * 255);
                data[offset + 2] = Math.round(worley(u, v, w, 16, e16) * 255);
                data[offset + 3] = Math.round(worley(u, v, w, 32, e32) * 255);
                offset += 4;
            }
        }
    }
    return data;
}

let shared = null;

/** Fills the volume a few layers per frame; in Node, where there are no frames, in one go. */
function fillVolumeNoise(texture, size) {
    const data = texture.image.data;
    // Two layers per frame: about twelve milliseconds of work, half a second until it is done.
    const step = 2;
    if (typeof requestAnimationFrame !== 'function') {
        buildVolumeNoiseData(size, data, 0, size);
        texture.needsUpdate = true;
        return;
    }
    const nextSlices = (from) => {
        buildVolumeNoiseData(size, data, from, step);
        texture.needsUpdate = true;
        if (from + step < size) requestAnimationFrame(() => nextSlices(from + step));
    };
    requestAnimationFrame(() => nextSlices(0));
}

/** The shared noise texture. Its content arrives over the next frames; smoke starts out smooth. */
export function getVolumeNoiseTexture() {
    if (shared) return shared;
    const size = VOLUME_NOISE_SIZE;
    const texture = new THREE.Data3DTexture(new Uint8Array(size * size * size * 4), size, size, size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    // Shared by every cloud; a map's disposal may release its GPU copy, the next use uploads it again.
    shared = texture;
    fillVolumeNoise(texture, size);
    return texture;
}
