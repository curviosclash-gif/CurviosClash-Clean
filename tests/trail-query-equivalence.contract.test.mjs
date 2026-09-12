import test from 'node:test';
import assert from 'node:assert/strict';

import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

// The hunt targeting scanner walks a ray in 0.9 unit steps and asks the trail query at every step,
// which makes this query the hottest gameplay function of a match with many bots. Any change to how
// it gathers candidates has to answer exactly as before: same segment, same closest point, same
// cell, for every probe of a fixed field. These numbers were captured from the implementation that
// looked up the 3x3 cells per probe; they are the equivalence lock for later optimisations.
const EXPECTED_PROBES = 318;
const EXPECTED_HITS = 49;
const EXPECTED_SIGNATURE = 1473983161;
const EXPECTED_FIRST_HIT = '0:18.0:1/6:-26.601,3.225,-21.576:1994997';
const EXPECTED_LAST_HIT = '2:47.7:2/14:-10.200,2.600,-5.936:1996999';

function buildField() {
    const players = [];
    for (let p = 0; p < 4; p += 1) {
        players.push({ index: p, trail: { writeIndex: 200, maxSegments: 256 } });
    }
    const index = new TrailSpatialIndex({ gridSize: 10, getPlayers: () => players });
    // Four trails crossing the probe corridor at different heights and radii, dense enough that
    // several segments share a grid cell and the 3x3 neighbourhoods overlap between probes.
    for (let p = 0; p < 4; p += 1) {
        for (let s = 0; s < 60; s += 1) {
            const t = s * 1.7;
            const fromX = -40 + t + p * 3;
            const fromZ = -20 + Math.sin(s * 0.37 + p) * 18;
            index.registerTrailSegment(p, s, {
                fromX,
                fromY: 2 + ((s + p) % 5) * 0.6,
                fromZ,
                toX: fromX + 1.6,
                toY: 2 + ((s + p) % 5) * 0.6 + 0.2,
                toZ: fromZ + Math.cos(s * 0.41 + p) * 1.4,
                radius: 0.5 + p * 0.1,
                ownerTrail: players[p].trail,
                hp: 3,
                maxHp: 3,
            });
        }
    }
    return index;
}

function probeSeries(index) {
    const rays = [
        { origin: [-45, 3, -25], dir: [1, 0, 0.15] },
        { origin: [-10, 4, 20], dir: [0.4, -0.05, -1] },
        { origin: [30, 2.5, -30], dir: [-1, 0.03, 0.6] },
    ];
    const out = [];
    for (let r = 0; r < rays.length; r += 1) {
        const { origin, dir } = rays[r];
        const length = Math.hypot(dir[0], dir[1], dir[2]);
        const unit = dir.map((value) => value / length);
        for (let distance = 0; distance <= 95; distance += 0.9) {
            const probe = {
                x: origin[0] + unit[0] * distance,
                y: origin[1] + unit[1] * distance,
                z: origin[2] + unit[2] * distance,
            };
            const hit = index.checkProjectileTrailCollision(probe, 0.78, {
                excludePlayerIndex: r % 4,
                skipRecent: 12,
            });
            out.push(hit?.entry
                ? `${r}:${distance.toFixed(1)}:${hit.entry.playerIndex}/${hit.entry.segmentIdx}`
                    + `:${hit.closestPoint.closestX.toFixed(3)},${hit.closestPoint.closestY.toFixed(3)},`
                    + `${hit.closestPoint.closestZ.toFixed(3)}:${hit.cellKey}`
                : `${r}:${distance.toFixed(1)}:none`);
        }
    }
    return out;
}

function fnv1a(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

test('trail query answers a fixed probe series exactly as before', () => {
    const index = buildField();
    const results = probeSeries(index);
    const hits = results.filter((line) => !line.endsWith(':none'));

    assert.equal(results.length, EXPECTED_PROBES);
    assert.equal(hits.length, EXPECTED_HITS, 'a changed hit count means the query answers differently');
    assert.equal(hits[0], EXPECTED_FIRST_HIT);
    assert.equal(hits[hits.length - 1], EXPECTED_LAST_HIT);
    assert.equal(fnv1a(results.join('|')), EXPECTED_SIGNATURE, 'segment, closest point or cell changed for at least one probe');
});

test('destroyed segments drop out of the answer', () => {
    const index = buildField();
    const probe = { x: -26.601, y: 3.225, z: -21.576 };
    const identity = (hit) => (hit?.entry ? `${hit.entry.playerIndex}/${hit.entry.segmentIdx}` : 'none');
    const before = index.checkProjectileTrailCollision(probe, 0.78, { excludePlayerIndex: 0, skipRecent: 12 });
    assert.ok(before?.entry, 'the locked probe has to hit something to make this meaningful');
    const destroyed = identity(before);
    index.destroySegment(before.entry);
    const after = index.checkProjectileTrailCollision(probe, 0.78, { excludePlayerIndex: 0, skipRecent: 12 });
    assert.notEqual(identity(after), destroyed, 'a destroyed segment must not answer again');
});
