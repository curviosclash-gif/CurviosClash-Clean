import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';

function obstacleAt(x) {
    return {
        box: new THREE.Box3(
            new THREE.Vector3(x - 1, -1, -1),
            new THREE.Vector3(x + 1, 1, 1),
        ),
        kind: 'hard',
        isWall: false,
    };
}

test('fast arena collision narrows large static obstacle sets and follows rebuilds', () => {
    const obstacles = Array.from({ length: 16 }, (_value, index) => obstacleAt(index * 40));
    let intersectionChecks = 0;
    for (const obstacle of obstacles) {
        const intersectsSphere = obstacle.box.intersectsSphere.bind(obstacle.box);
        obstacle.box.intersectsSphere = (sphere) => {
            intersectionChecks += 1;
            return intersectsSphere(sphere);
        };
    }
    const arena = {
        bounds: { minX: -1000, maxX: 1000, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        obstacles,
    };
    const collision = new ArenaCollision(arena);

    assert.equal(collision.checkCollisionFast(new THREE.Vector3(0, 0, 0), 0.5), true);
    assert.ok(intersectionChecks < obstacles.length);

    arena.obstacles.push(obstacleAt(20));
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(20, 0, 0), 0.5), true);

    arena.obstacles = [...arena.obstacles.slice(0, -1), obstacleAt(25)];
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(25, 0, 0), 0.5), true);
});
