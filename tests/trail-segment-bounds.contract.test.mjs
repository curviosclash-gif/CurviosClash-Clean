import test from 'node:test';
import assert from 'node:assert/strict';

import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

// The collision query rejects most segments on their bounding box. The box is fixed once a segment
// is registered, so it is computed there instead of on every query; the stored numbers must be the
// very same expressions the query used, or a probe on the box edge could flip its answer.

function buildField() {
    const players = [];
    for (let p = 0; p < 3; p += 1) players.push({ index: p, trail: { writeIndex: 120, maxSegments: 256 } });
    const index = new TrailSpatialIndex({ gridSize: 10, getPlayers: () => players });
    const entries = [];
    for (let p = 0; p < 3; p += 1) {
        for (let s = 0; s < 40; s += 1) {
            const fromX = -30 + s * 1.3 + p * 2.1;
            const fromZ = -15 + Math.sin(s * 0.53 + p) * 14;
            // Every second segment runs backwards so min and max swap sides.
            const dir = s % 2 === 0 ? 1 : -1;
            const ref = index.registerTrailSegment(p, s, {
                fromX,
                fromY: 1.5 + ((s + p) % 4) * 0.7,
                fromZ,
                toX: fromX + dir * 1.45,
                toY: 1.5 + ((s + p) % 4) * 0.7 - dir * 0.3,
                toZ: fromZ + Math.cos(s * 0.29 + p) * 1.6,
                radius: 0.45 + p * 0.15,
                ownerTrail: players[p].trail,
                hp: 2,
                maxHp: 2,
            });
            entries.push(ref.entry);
        }
    }
    return { index, entries, players };
}

// The query as it was before the bounds moved into the registry: the reference for every answer.
function referenceIntersects(seg, position, radius) {
    const minX = Math.min(seg.fromX, seg.toX) - seg.radius;
    const maxX = Math.max(seg.fromX, seg.toX) + seg.radius;
    if (position.x < minX - radius || position.x > maxX + radius) return false;
    const minY = Math.min(seg.fromY, seg.toY) - seg.radius;
    const maxY = Math.max(seg.fromY, seg.toY) + seg.radius;
    if (position.y < minY - radius || position.y > maxY + radius) return false;
    const minZ = Math.min(seg.fromZ, seg.toZ) - seg.radius;
    const maxZ = Math.max(seg.fromZ, seg.toZ) + seg.radius;
    if (position.z < minZ - radius || position.z > maxZ + radius) return false;
    const vx = seg.toX - seg.fromX, vy = seg.toY - seg.fromY, vz = seg.toZ - seg.fromZ;
    const wx = position.x - seg.fromX, wy = position.y - seg.fromY, wz = position.z - seg.fromZ;
    const lenSq = vx * vx + vy * vy + vz * vz;
    const t = lenSq > 0.000001 ? Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / lenSq)) : 0;
    const dx = position.x - (seg.fromX + t * vx), dy = position.y - (seg.fromY + t * vy), dz = position.z - (seg.fromZ + t * vz);
    const totalRadius = radius + seg.radius;
    return dx * dx + dy * dy + dz * dz <= totalRadius * totalRadius;
}

test('a registered segment carries its radius-grown bounding box', () => {
    const { entries } = buildField();
    for (const seg of entries) {
        assert.equal(seg.boundsMinX, Math.min(seg.fromX, seg.toX) - seg.radius);
        assert.equal(seg.boundsMaxX, Math.max(seg.fromX, seg.toX) + seg.radius);
        assert.equal(seg.boundsMinY, Math.min(seg.fromY, seg.toY) - seg.radius);
        assert.equal(seg.boundsMaxY, Math.max(seg.fromY, seg.toY) + seg.radius);
        assert.equal(seg.boundsMinZ, Math.min(seg.fromZ, seg.toZ) - seg.radius);
        assert.equal(seg.boundsMaxZ, Math.max(seg.fromZ, seg.toZ) + seg.radius);
    }
});

test('a recycled entry takes the bounding box of its new segment', () => {
    const { index, entries } = buildField();
    const seg = entries[5];
    index.registerTrailSegment(seg.playerIndex, 300, {
        fromX: 50, fromY: 9, fromZ: -50, toX: 48, toY: 11, toZ: -49, radius: 1.25, hp: 1, maxHp: 1,
    }, { entry: seg, key: seg._gridKeyRef });
    assert.deepEqual([seg.boundsMinX, seg.boundsMaxX, seg.boundsMinY, seg.boundsMaxY, seg.boundsMinZ, seg.boundsMaxZ],
        [46.75, 51.25, 7.75, 12.25, -51.25, -47.75]);
});

test('every probe of a dense field answers exactly like the per-query box', () => {
    const { index, entries } = buildField();
    let probes = 0, hits = 0;
    for (let x = -34; x <= 50; x += 0.37) {
        for (let z = -32; z <= 32; z += 0.41) {
            for (const y of [1.2, 2.6, 4.1]) {
                for (const radius of [0, 0.35, 1.1]) {
                    const position = { x, y, z };
                    for (const seg of entries) {
                        const expected = referenceIntersects(seg, position, radius);
                        const actual = index._collisionQuery._segmentIntersectsSphere(seg, position, radius);
                        if (actual !== expected) assert.fail(`segment ${seg.playerIndex}/${seg.segmentIdx} at ${x},${y},${z} r=${radius}`);
                        probes += 1;
                        if (actual) hits += 1;
                    }
                }
            }
        }
    }
    assert.ok(probes > 1_000_000, `probes ${probes}`);
    assert.ok(hits > 1000, `hits ${hits}`);
});
