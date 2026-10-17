import { resolveEndlessCourseCenter } from './EndlessParcoursConnectors.js';

const STEPS = 128;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

export function createEndlessPathSample() {
    return {
        s: 0, moduleIndex: 0, progress: 0, distanceSquared: 0,
        position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
    };
}

function speed(module, t) {
    const scale = Math.PI * 0.5 * Math.sin(Math.PI * t);
    return Math.hypot(module.length, module.dx * scale, module.dy * scale);
}

/** Numerical arc length of the existing cosine centreline; gameplay still uses legacy Z. */
export class EndlessParcoursPathMetric {
    constructor() {
        this._modules = [];
        this._sample = createEndlessPathSample();
        this._range = { moduleIndex: 0, startS: 0, endS: 0, lengthS: 0 };
        this.totalLength = 0;
    }

    getModuleCount() { return this._modules.length; }
    clear() { this._modules.length = 0; this.totalLength = 0; }

    appendModule(module) {
        const index = this._modules.length;
        const values = [module?.originZ, module?.length, module?.entryDrift?.x,
            module?.entryDrift?.y, module?.exitDrift?.x, module?.exitDrift?.y];
        if (module?.moduleIndex !== index || !values.every(Number.isFinite) || module.length <= 0) {
            throw new RangeError('Metric modules must be finite, positive and appended consecutively');
        }
        const previous = this._modules[index - 1];
        if (previous && (Math.abs(previous.originZ + previous.length - module.originZ) > 1e-6
            || Math.abs(previous.exitDrift.x - module.entryDrift.x) > 1e-6
            || Math.abs(previous.exitDrift.y - module.entryDrift.y) > 1e-6)) {
            throw new RangeError('Metric module seam is discontinuous');
        }
        const record = {
            moduleIndex: index, originZ: module.originZ, length: module.length,
            entryDrift: { ...module.entryDrift }, exitDrift: { ...module.exitDrift },
            dx: module.exitDrift.x - module.entryDrift.x, dy: module.exitDrift.y - module.entryDrift.y,
            startS: this.totalLength, stations: new Float64Array(STEPS + 1),
        };
        // Simpson integration measures the curve, rather than its Z span or chord length.
        for (let step = 1; step <= STEPS; step++) {
            const lo = (step - 1) / STEPS, hi = step / STEPS;
            record.stations[step] = record.stations[step - 1]
                + (speed(record, lo) + 4 * speed(record, (lo + hi) / 2) + speed(record, hi)) / (6 * STEPS);
        }
        this.totalLength += record.stations[STEPS];
        this._modules.push(record);
        return this.getStationRange(index);
    }

    /** Omitted outputs use instance scratch objects; retain a result by providing your own out. */
    getStationRange(index, out = this._range) {
        const record = Number.isInteger(index) ? this._modules[index] : null;
        if (!record) return null;
        out.moduleIndex = index;
        out.startS = record.startS;
        out.lengthS = record.stations[STEPS];
        out.endS = out.startS + out.lengthS;
        return out;
    }

    _moduleAtS(s) {
        let lo = 0, hi = this._modules.length - 1;
        // Shared seams belong to the following module, except the final endpoint.
        while (lo < hi) {
            const middle = Math.floor((lo + hi) / 2);
            const record = this._modules[middle];
            if (s >= record.startS + record.stations[STEPS]) lo = middle + 1;
            else hi = middle;
        }
        return this._modules[lo];
    }

    sampleAtS(station, out = this._sample) {
        if (!this._modules.length) return null;
        const s = Math.max(0, Math.min(this.totalLength, Number(station) || 0));
        const record = this._moduleAtS(s), localS = s - record.startS;
        let lo = 0, hi = STEPS;
        while (hi - lo > 1) {
            const middle = Math.floor((lo + hi) / 2);
            if (record.stations[middle] <= localS) lo = middle;
            else hi = middle;
        }
        const fraction = (localS - record.stations[lo]) / (record.stations[hi] - record.stations[lo]);
        const t = Math.max(0, Math.min(1, (lo + fraction) / STEPS));
        out.s = s; out.moduleIndex = record.moduleIndex; out.progress = t; out.distanceSquared = 0;
        resolveEndlessCourseCenter(record.entryDrift, record.exitDrift, t, out.position);
        out.position.z = record.originZ + record.length * t;
        const scale = Math.PI * 0.5 * Math.sin(Math.PI * t);
        const norm = speed(record, t);
        const tx = record.dx * scale / norm, ty = record.dy * scale / norm, tz = record.length / norm;
        out.tangent.x = tx; out.tangent.y = ty; out.tangent.z = tz;
        // Z is strictly increasing, so world-up cross tangent cannot become singular.
        const rightLength = Math.hypot(tz, tx);
        const rx = tz / rightLength, rz = -tx / rightLength;
        out.right.x = rx; out.right.y = 0; out.right.z = rz;
        out.up.x = ty * rz; out.up.y = tz * rx - tx * rz; out.up.z = -ty * rx;
        return out;
    }

    _distanceSquared(record, t, point) {
        const blend = (1 - Math.cos(Math.PI * t)) * 0.5;
        const dx = record.entryDrift.x + record.dx * blend - point.x;
        const dy = record.entryDrift.y + record.dy * blend - point.y;
        const dz = record.originZ + record.length * t - point.z;
        return dx * dx + dy * dy + dz * dz;
    }

    _boxDistanceSquared(record, point) {
        const dx = Math.max(Math.min(record.entryDrift.x, record.exitDrift.x) - point.x, 0,
            point.x - Math.max(record.entryDrift.x, record.exitDrift.x));
        const dy = Math.max(Math.min(record.entryDrift.y, record.exitDrift.y) - point.y, 0,
            point.y - Math.max(record.entryDrift.y, record.exitDrift.y));
        const dz = Math.max(record.originZ - point.z, 0, point.z - record.originZ - record.length);
        return dx * dx + dy * dy + dz * dz;
    }

    projectPoint(point, out = this._sample) {
        if (!this._modules.length || !Number.isFinite(point?.x)
            || !Number.isFinite(point?.y) || !Number.isFinite(point?.z)) return null;
        const px = point.x, py = point.y, pz = point.z;
        let bestRecord = this._modules[0], bestT = 0, bestDistance = Infinity;
        for (const record of this._modules) {
            if (this._boxDistanceSquared(record, point) > bestDistance) continue;
            let cell = 0, localDistance = Infinity;
            for (let step = 0; step <= STEPS; step++) {
                const distance = this._distanceSquared(record, step / STEPS, point);
                if (distance < localDistance) { localDistance = distance; cell = step; }
            }
            if (localDistance < bestDistance) {
                bestDistance = localDistance; bestT = cell / STEPS; bestRecord = record;
            }
            // Refine the nearest LUT neighbourhood, checking endpoints above as well.
            let lo = Math.max(0, (cell - 1) / STEPS), hi = Math.min(1, (cell + 1) / STEPS);
            let left = hi - GOLDEN * (hi - lo), right = lo + GOLDEN * (hi - lo);
            let leftDistance = this._distanceSquared(record, left, point);
            let rightDistance = this._distanceSquared(record, right, point);
            for (let iteration = 0; iteration < 40; iteration++) {
                if (leftDistance < rightDistance) {
                    hi = right; right = left; rightDistance = leftDistance;
                    left = hi - GOLDEN * (hi - lo); leftDistance = this._distanceSquared(record, left, point);
                } else {
                    lo = left; left = right; leftDistance = rightDistance;
                    right = lo + GOLDEN * (hi - lo); rightDistance = this._distanceSquared(record, right, point);
                }
            }
            const t = (lo + hi) * 0.5, distance = this._distanceSquared(record, t, point);
            if (distance < bestDistance) { bestDistance = distance; bestRecord = record; bestT = t; }
        }
        const cell = Math.min(STEPS - 1, Math.floor(bestT * STEPS));
        const s = bestT === 1 ? bestRecord.startS + bestRecord.stations[STEPS]
            : bestRecord.startS + bestRecord.stations[cell]
                + (bestT * STEPS - cell) * (bestRecord.stations[cell + 1] - bestRecord.stations[cell]);
        this.sampleAtS(s, out);
        const dx = out.position.x - px, dy = out.position.y - py, dz = out.position.z - pz;
        out.distanceSquared = dx * dx + dy * dy + dz * dz;
        return out;
    }
}
