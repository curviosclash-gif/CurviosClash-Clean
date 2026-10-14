import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';

test('box collision normal follows the outside axis for a thin box', () => {
    const collision = new ArenaCollision({
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        obstacles: [{
            box: new THREE.Box3(new THREE.Vector3(-0.2, 0, -5), new THREE.Vector3(0.2, 10, 5)),
        }],
    });

    const hit = collision.getCollisionInfo(new THREE.Vector3(0.1, 10.3, 0), 0.5);
    assert.deepEqual(hit?.normal.toArray(), [0, 1, 0]);
});
