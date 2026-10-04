import { listVehiclePrimitiveBounds } from './VehiclePartStyleContract.js';

const GRID = 16;
const cache = new WeakMap();
const dot = (row, p) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2];
function inverse(m) {
    const [[a,b,c],[d,e,f],[g,h,i]] = m;
    const det = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if (Math.abs(det) < 1e-15) return null;
    return { det, matrix: [[e*i-f*h,c*h-b*i,b*f-c*e],[f*g-d*i,a*i-c*g,c*d-a*f],[d*h-e*g,b*g-a*h,a*e-b*d]].map(row => row.map(v => v/det)) };
}
function containsLocal(shape, p) {
    const [x,y,z] = p;
    if (p.some((v,axis) => Math.abs(v) > shape.half[axis] + 1e-9)) return false;
    const [a,b,c] = shape.size || [1,1,1];
    switch (shape.geo) {
        case 'sphere': return x*x+y*y+z*z <= a*a;
        case 'cone': return x*x+z*z <= (a*(0.5-y/b))**2;
        case 'cylinder': case 'pylon': return x*x+z*z <= (b+(a-b)*(y/c+0.5))**2;
        case 'capsule': return x*x+z*z+Math.max(0,Math.abs(y)-b/2)**2 <= a*a;
        case 'torus': return (Math.hypot(x,y)-a)**2+z*z <= b*b;
        case 'engine': {
            // Shroud plus the forward nozzle from ModularVehicleMesh.
            const radius = Math.abs(z) <= c/2 ? b+(a-b)*(0.5-z/c) : a*0.8;
            return x*x+y*y <= radius*radius;
        }
        default: return true;
    }
}
function contains(shape, world) {
    if (world.some((v,axis) => v < shape.min[axis]-1e-9 || v > shape.max[axis]+1e-9)) return false;
    const p = world.map((v,axis) => v-shape.offset[axis]);
    return containsLocal(shape, shape.inverse.map(row => dot(row,p)));
}

/** Deterministic integration in each primitive's own frame. Overlap counts once, empty
 * space never counts, and rotating an isolated primitive cannot inflate its volume.
 * Curved surfaces are approximated on a 16³ grid; role references use the same measure.
 * Runs only when immutable Lab designs are loaded/edited, never in simulation loops. */
export function measureArcadeLabHullVolume(parts) {
    if (!Array.isArray(parts)) return 0;
    if (cache.has(parts)) return cache.get(parts);
    const shapes = listVehiclePrimitiveBounds(parts, { ignoreGeos: ['flame','forcefield'], includeFrames: true })
        .map(shape => { const inv = inverse(shape.matrix); return inv ? { ...shape, inverse: inv.matrix, det: Math.abs(inv.det) } : null; })
        .filter(shape => shape && shape.half.every(v => v > 0));
    let volume = 0;
    for (let index = 0; index < shapes.length; index++) {
        const shape = shapes[index];
        const prior = shapes.slice(0,index).filter(other => other.min.every((v,axis) => v <= shape.max[axis] && other.max[axis] >= shape.min[axis]));
        let occupied = 0;
        for (let x=0;x<GRID;x++) for (let y=0;y<GRID;y++) for (let z=0;z<GRID;z++) {
            const p = [x,y,z].map((n,axis) => ((n+0.5)*2/GRID-1)*shape.half[axis]);
            if (!containsLocal(shape,p)) continue;
            const world = shape.matrix.map((row,axis) => dot(row,p)+shape.offset[axis]);
            if (!prior.some(other => contains(other,world))) occupied++;
        }
        volume += occupied/GRID**3 * 8 * shape.half.reduce((a,b) => a*b,1) * shape.det;
    }
    cache.set(parts,volume);
    return volume;
}
