import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';
import { Trail } from '../src/entities/Trail.js';

// A segment that leaves its grid cell gets a key ARRAY, one that stays inside a single cell
// gets a plain numeric key. Only the array is pooled, which is where ownership can slip.
const MULTI_CELL = Object.freeze({ fromX: 0, fromY: 2, fromZ: 5, toX: 34, toY: 2, toZ: 5, radius: 0.3, hp: 3, maxHp: 3 });
const OTHER_MULTI_CELL = Object.freeze({ fromX: 120, fromY: 2, fromZ: 5, toX: 154, toY: 2, toZ: 5, radius: 0.3, hp: 3, maxHp: 3 });
const THIRD_MULTI_CELL = Object.freeze({ fromX: 240, fromY: 2, fromZ: 5, toX: 274, toY: 2, toZ: 5, radius: 0.3, hp: 3, maxHp: 3 });

const TRAIL_CONFIG = Object.freeze({
    TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 6, UPDATE_INTERVAL: 0.05, GAP_CHANCE: 0, GAP_DURATION: 0.1 },
    HUNT: { TRAIL_SEGMENT_HP: 3 },
});

function createIndex() {
    return new TrailSpatialIndex({ gridSize: 10, getPlayers: () => [] });
}

function cellsHolding(index, entry) {
    const cells = [];
    for (const [key, cell] of index.spatialGrid) {
        if (cell.has(entry)) cells.push(key);
    }
    return cells.sort((a, b) => a - b);
}

function keysOf(ref) {
    return (Array.isArray(ref.key) ? [...ref.key] : [ref.key]).sort((a, b) => a - b);
}

test('a pooled grid key array is never handed to a second registration', () => {
    const index = createIndex();

    const first = index.registerTrailSegment(0, 0, MULTI_CELL);
    assert.ok(Array.isArray(first.key), 'expected a multi cell segment to own a key array');
    // The ring buffer unregisters the oldest segment and re-registers the very same ref.
    index.unregisterTrailSegment(first.key, first.entry);
    const reused = index.registerTrailSegment(0, 0, OTHER_MULTI_CELL, first);
    // A fresh registration takes an array out of the pool.
    const second = index.registerTrailSegment(1, 0, THIRD_MULTI_CELL);

    assert.notEqual(reused.key, second.key, 'two live segments must not share one key array');
    assert.deepEqual(cellsHolding(index, reused.entry), keysOf(reused));
    assert.deepEqual(cellsHolding(index, second.entry), keysOf(second));

    index.unregisterTrailSegment(reused.key, reused.entry);
    index.unregisterTrailSegment(second.key, second.entry);
    assert.equal(index.spatialGrid.size, 0, 'every cell must be empty once both segments are gone');
});

function createRenderer() {
    return { addToScene() { }, removeFromScene() { } };
}

test('a wrapped trail leaves no segment behind in the collision grid after clear', () => {
    const index = createIndex();
    const trail = new Trail(createRenderer(), 0x33aaff, 0, {
        entityRuntimeConfig: TRAIL_CONFIG,
        getTrailSpatialIndex: () => index,
    });

    const position = new THREE.Vector3(0, 2, 5);
    const direction = new THREE.Vector3(1, 0, 0);
    // Long steps cross cell borders (key array), short steps stay inside one cell (numeric key),
    // so the ring buffer reuses and pools key arrays in turn.
    for (let step = 0; step < 24; step++) {
        position.x += step % 2 === 0 ? 12 : 1;
        trail.update(0.05, position, direction);
    }
    assert.equal(trail.segmentCount, TRAIL_CONFIG.TRAIL.MAX_SEGMENTS, 'expected the ring buffer to have wrapped');

    for (const ref of trail.segmentRefs) {
        if (!ref) continue;
        assert.deepEqual(cellsHolding(index, ref.entry), keysOf(ref), 'a live segment sits in exactly its own cells');
    }

    trail.clear();

    assert.equal(index.spatialGrid.size, 0, 'clear() must leave no lethal leftovers in the grid');
});
