import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { BotSensors } from '../src/entities/ai/BotSensors.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

/**
 * A ship at the origin with a hull of radius 1, flying along -z. isSphereInOBB answers like
 * Player's OBB test: only spheres that touch the hull at the ship's current position count.
 * That check belongs to the real collision; a probe looks at points far ahead of the hull.
 */
function createScene() {
    const victim = {
        index: 0, isBot: true, alive: true, hitboxRadius: 0.4, position: new THREE.Vector3(0, 0, 0),
        isSphereInOBB(point, radius) { return point.distanceTo(this.position) <= 1 + radius; },
    };
    const rival = { index: 1, isBot: true, alive: true, position: new THREE.Vector3(30, 0, -12) };
    const players = [victim, rival];
    const index = new TrailSpatialIndex({ players });
    // Another ship's trail crossing the flight path 12 units ahead.
    index.registerTrailSegment(1, 0, { fromX: -6, fromY: 0, fromZ: -12, toX: 6, toY: 0, toZ: -12, radius: 0.3 });
    victim.trail = { entityManager: { checkGlobalCollision: (...args) => index.checkGlobalCollision(...args) } };
    return { victim, players };
}

test('a bot probe sees another ship\'s trail ahead of it, not only once its hull touches the trail', () => {
    const { victim, players } = createScene();
    const sensors = new BotSensors();
    assert.equal(sensors.checkTrailHit(new THREE.Vector3(0, 0, -12), victim, players), true,
        'the probe point on the trail 12 units ahead reports the trail');
    assert.equal(sensors.checkTrailHit(new THREE.Vector3(0, 0, -6), victim, players), false,
        'a probe point in open space stays clear');
});
