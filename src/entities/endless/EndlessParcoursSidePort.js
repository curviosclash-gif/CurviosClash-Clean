import { deriveEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { createEndlessPathSample, sampleEndlessModuleFrame } from './EndlessParcoursPathMetric.js';

const SIDES = ['right', 'top', 'left', 'bottom'];
const FRAME = createEndlessPathSample();

/** Build-time definition; recovery and introductory modules keep their closed walls. */
export function resolveEndlessSidePort(module, baseSeed) {
    const index = module.moduleIndex;
    if (index < 4 || module.recovery || index % 3 !== 1) return null;
    const quarter = (Math.floor(index / 3) + deriveEndlessSeed(baseSeed, 'side-port')) % 4;
    return { id: `endless-port:${index}`, side: SIDES[quarter], quarter, firstRing: 4, lastRing: 10,
        halfSides: 2, length: 40, localZ: module.length * 7 / 32 };
}

export function isEndlessPortPatch(port, ring, side, radial) {
    if (!port || ring < port.firstRing || ring >= port.lastRing) return false;
    const relative = (side - port.quarter * radial / 4 + port.halfSides + radial) % radial;
    return relative < port.halfSides * 2;
}

/** Outer mouth is slightly wider longitudinally, retaining finite wall thickness. */
export function sidePortRingProgress(port, ring, axial, layer, thickness, length) {
    let z = ring * length / axial;
    if (port && layer) {
        if (ring === port.firstRing) z -= thickness;
        if (ring === port.lastRing) z += thickness;
    }
    return z / length;
}

/** Extend the same mouth vertices into a bounded shaft; no overlapping query solids. */
export function appendEndlessSidePort({ port, module, radial, axial, thickness, radiusAt, positions, inner,
    wallIndices, volumeIndices, layerVertices }) {
    if (!port) return;
    const axis = port.quarter * radial / 4, border = [];
    const vertex = (ring, side) => ring * radial + (side + radial) % radial;
    for (let side = -port.halfSides; side <= port.halfSides; side++) border.push(vertex(port.firstRing, axis + side));
    for (let ring = port.firstRing + 1; ring <= port.lastRing; ring++) border.push(vertex(ring, axis + port.halfSides));
    for (let side = port.halfSides - 1; side >= -port.halfSides; side--) border.push(vertex(port.lastRing, axis + side));
    for (let ring = port.lastRing - 1; ring > port.firstRing; ring--) border.push(vertex(ring, axis - port.halfSides));
    const angle = port.quarter * Math.PI / 2, ux = Math.cos(angle), uy = Math.sin(angle);
    const vx = -uy, vy = ux, endQ = radiusAt(port.localZ / module.length) + port.length;
    const segments = 4, tips = [];
    for (let layer = 0; layer < 2; layer++) {
        let previousWall = border.map(id => id + layer * layerVertices);
        let previousVolume = border;
        for (let depth = 1; depth <= segments; depth++) {
            const wallRing = [], volumeRing = [];
            for (const id of border) {
                const ring = Math.floor(id / radial), theta = (id % radial) * Math.PI * 2 / radial;
                const t = sidePortRingProgress(port, ring, axial, layer, thickness, module.length);
                const radius = radiusAt(t) + layer * thickness;
                const q0 = radius * Math.cos(theta - angle), v = radius * Math.sin(theta - angle);
                const q = q0 + (endQ + layer * thickness - q0) * depth / segments;
                sampleEndlessModuleFrame(module, t, FRAME);
                const x = q * ux + v * vx, y = q * uy + v * vy;
                const p = [FRAME.position.x + FRAME.right.x * x + FRAME.up.x * y,
                    FRAME.position.y + FRAME.right.y * x + FRAME.up.y * y,
                    FRAME.position.z - module.originZ + FRAME.right.z * x + FRAME.up.z * y];
                wallRing.push(positions.length / 3); positions.push(...p);
                if (!layer) { volumeRing.push(inner.length / 3); inner.push(...p); }
            }
            for (let i = 0; i < border.length; i++) {
                const next = (i + 1) % border.length;
                const a = previousWall[i], b = previousWall[next], c = wallRing[i], d = wallRing[next];
                if (!layer) wallIndices.push(a, c, b, b, c, d);
                else wallIndices.push(a, b, c, b, d, c);
                if (!layer) {
                    const va = previousVolume[i], vb = previousVolume[next], vc = volumeRing[i], vd = volumeRing[next];
                    volumeIndices.push(va, vb, vc, vb, vd, vc);
                }
            }
            previousWall = wallRing; previousVolume = volumeRing;
        }
        tips.push(previousWall);
        if (!layer) {
            sampleEndlessModuleFrame(module, port.localZ / module.length, FRAME);
            const center = inner.length / 3;
            inner.push(FRAME.position.x + endQ * (FRAME.right.x * ux + FRAME.up.x * uy),
                FRAME.position.y + endQ * (FRAME.right.y * ux + FRAME.up.y * uy),
                FRAME.position.z - module.originZ + endQ * (FRAME.right.z * ux + FRAME.up.z * uy));
            for (let i = 0; i < border.length; i++) volumeIndices.push(previousVolume[i], previousVolume[(i + 1) % border.length], center);
        }
    }
    for (let i = 0; i < border.length; i++) {
        const next = (i + 1) % border.length;
        wallIndices.push(tips[0][i], tips[1][i], tips[0][next], tips[0][next], tips[1][i], tips[1][next]);
    }
    port.endQ = endQ;
    port.ux = ux; port.uy = uy;
}


/** Build-time world-space anchor and shaft axis, borrowed by spawn and route queries. */
export function initializeEndlessSidePort(port, module, radiusAt) {
    if (!port) return null;
    sampleEndlessModuleFrame(module, port.localZ / module.length, FRAME);
    port.origin = { ...FRAME.position };
    port.axis = { x: FRAME.right.x * port.ux + FRAME.up.x * port.uy,
        y: FRAME.right.y * port.ux + FRAME.up.y * port.uy,
        z: FRAME.right.z * port.ux + FRAME.up.z * port.uy };
    port.radius = radiusAt(port.localZ / module.length);
    const q = port.endQ - 8;
    port.anchor = { id: port.id, x: port.origin.x + port.axis.x * q,
        y: port.origin.y + port.axis.y * q, z: port.origin.z + port.axis.z * q,
        ahead: false, portId: port.id, side: port.side };
    return port;
}

/** Shaft-first navigation prevents cutting diagonally through its longitudinal walls. */
export function sampleEndlessPortRoute(port, position, target) {
    if (!port?.origin || !position) return false;
    const q = (position.x - port.origin.x) * port.axis.x + (position.y - port.origin.y) * port.axis.y
        + (position.z - port.origin.z) * port.axis.z;
    if (q <= port.radius - 6) return false;
    const next = Math.max(port.radius - 8, q - 24);
    target.set(port.origin.x + port.axis.x * next, port.origin.y + port.axis.y * next, port.origin.z + port.axis.z * next);
    return true;
}
