// Shared collision probe for the Notre-Dame maps.
//
// The map draws the cathedral from GLB files but collides on the authored boxes in
// NotreDameStructure, and nothing in the loader ties the two together. Every test that asks
// "does this point block?" has to model the same three obstacle shapes the runtime compiles,
// so the model lives here rather than being copied per test file.

/**
 * Mirrors ArenaGeometryCompilePipeline: a plain box, a box with a bore through it, and a
 * standalone tube whose wall is the solid part. Foam is skipped -- it bounces, it does not stop.
 *
 * @param {Array<object>} obstacles authored obstacle definitions, in authored units
 * @returns {(point: number[]) => boolean} whether a point sits inside hard collision
 */
export function createSolidProbe(obstacles) {
    return function isSolid(point) {
        const [px, py, pz] = point;
        for (const obstacle of obstacles) {
            if (String(obstacle.kind || 'hard') === 'foam') continue;

            if (String(obstacle.shape || '') === 'tube') {
                const [ax, ay, az] = obstacle.start;
                const [bx, by, bz] = obstacle.end;
                const abx = bx - ax; const aby = by - ay; const abz = bz - az;
                const lengthSq = abx * abx + aby * aby + abz * abz;
                const along = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lengthSq;
                if (along < 0 || along > 1) continue;
                const dx = px - (ax + abx * along);
                const dy = py - (ay + aby * along);
                const dz = pz - (az + abz * along);
                const distance = Math.hypot(dx, dy, dz);
                const outer = obstacle.radius + Math.max(0.25, Math.min(1.2, obstacle.radius * 0.18));
                if (distance <= outer && distance >= obstacle.radius) return true;
                continue;
            }

            const [cx, cy, cz] = obstacle.pos;
            const [width, height, depth] = obstacle.size;
            if (Math.abs(px - cx) > width / 2) continue;
            if (Math.abs(py - cy) > height / 2) continue;
            if (Math.abs(pz - cz) > depth / 2) continue;

            if (obstacle.tunnel) {
                const axis = obstacle.tunnel.axis;
                const crossA = axis === 'x' ? height : width;
                const crossB = axis === 'z' ? height : depth;
                const radius = Math.min(
                    obstacle.tunnel.radius,
                    Math.max(0.001, Math.min(crossA, crossB) / 2 - 1e-4),
                );
                const first = axis === 'x' ? py - cy : px - cx;
                const second = axis === 'z' ? py - cy : pz - cz;
                if (first * first + second * second < radius * radius) continue;
            }
            return true;
        }
        return false;
    };
}
