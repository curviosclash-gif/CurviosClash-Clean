import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/**
 * Decodes an 8-bit RGBA, non-interlaced PNG (what Blender writes) into rows from the top.
 * @returns {{ width: number, height: number, data: Uint8Array }} data is RGBA, row-major
 */
export function readPngRgba(path) {
    const file = readFileSync(path);
    let offset = 8;
    let width = 0, height = 0;
    const chunks = [];
    while (offset < file.length) {
        const length = file.readUInt32BE(offset);
        const type = file.toString('ascii', offset + 4, offset + 8);
        const body = file.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0); height = body.readUInt32BE(4);
            if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('expected 8-bit RGBA, not interlaced');
        } else if (type === 'IDAT') chunks.push(body);
        offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * 4;
    const data = new Uint8Array(height * stride);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x += 1) {
            const left = x >= 4 ? data[y * stride + x - 4] : 0;
            const up = y > 0 ? data[(y - 1) * stride + x] : 0;
            const corner = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
            let value = line[x];
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - corner;
                const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
                value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
            }
            data[y * stride + x] = value & 255;
        }
    }
    return { width, height, data };
}
