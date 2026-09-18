import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assembleMatchRuntimeProjection,
    createMatchRuntimePlayerProjection,
    createRocketThreatProjection,
} from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';

const INACTIVE = Object.freeze({
    active: false,
    count: 0,
    nearestDistance: 0,
    timeToImpactSeconds: 0,
    direction: { x: 0, y: 0, z: 0 },
    source: '',
});

function inactiveThreat() {
    return { ...INACTIVE, direction: { ...INACTIVE.direction } };
}

test('a missing or broken rocket threat projects as no threat at all', () => {
    assert.deepEqual(createRocketThreatProjection(), inactiveThreat());
    assert.deepEqual(createRocketThreatProjection(null), inactiveThreat());
    assert.deepEqual(createRocketThreatProjection('incoming'), inactiveThreat());
    assert.deepEqual(createMatchRuntimePlayerProjection({ playerIndex: 0 }).rocketThreat, inactiveThreat());
    assert.deepEqual(
        createMatchRuntimePlayerProjection({ playerIndex: 0, rocketThreat: 42 }).rocketThreat,
        inactiveThreat(),
    );
});

test('a real rocket threat keeps its numbers, its direction and its source', () => {
    const projected = createRocketThreatProjection({
        active: true,
        count: 2,
        nearestDistance: 37.5,
        timeToImpactSeconds: 1.25,
        direction: { x: 0, y: 0, z: -1 },
        source: 'turret',
        // The tracker also carries the projectile id; the HUD never needs it.
        nearestProjectileId: 'p-17',
    });
    assert.deepEqual(projected, {
        active: true,
        count: 2,
        nearestDistance: 37.5,
        timeToImpactSeconds: 1.25,
        direction: { x: 0, y: 0, z: -1 },
        source: 'turret',
    });

    const viaPlayer = createMatchRuntimePlayerProjection({
        playerIndex: 1,
        rocketThreat: { active: true, count: 1, nearestDistance: 12, direction: { x: 1, y: 0, z: 0 }, source: 'zone' },
    }).rocketThreat;
    assert.equal(viaPlayer.active, true);
    assert.equal(viaPlayer.count, 1);
    assert.equal(viaPlayer.source, 'zone');
    // A rocket that is not closing in has no time to impact; 0 means unknown.
    assert.equal(viaPlayer.timeToImpactSeconds, 0);
});

test('nonsense in a rocket threat is cleaned up instead of reaching the HUD', () => {
    const cleaned = createRocketThreatProjection({
        active: true,
        count: 2.7,
        nearestDistance: -5,
        timeToImpactSeconds: Number.NaN,
        direction: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: '0.5' },
        source: 'meteor',
    });
    assert.equal(cleaned.count, 2, 'a fractional count is truncated');
    assert.equal(cleaned.nearestDistance, 0, 'a negative distance never survives');
    assert.equal(cleaned.timeToImpactSeconds, 0);
    assert.deepEqual(cleaned.direction, { x: 0, y: 0, z: 0.5 });
    assert.equal(cleaned.source, '', 'an unknown source is dropped');

    // A claimed threat without a single rocket is no threat.
    assert.deepEqual(createRocketThreatProjection({ active: true, count: 0, nearestDistance: 9 }), inactiveThreat());
    assert.deepEqual(createRocketThreatProjection({ active: true, count: -3 }), inactiveThreat());
});

test('the rocket threat projection is a copy, because the tracker reuses its objects', () => {
    const live = {
        active: true,
        count: 1,
        nearestDistance: 20,
        timeToImpactSeconds: 2,
        direction: { x: 0, y: 0, z: 1 },
        source: 'player',
    };
    const projected = createRocketThreatProjection(live);
    assert.notEqual(projected, live);
    assert.notEqual(projected.direction, live.direction);

    live.count = 0;
    live.active = false;
    live.nearestDistance = 0;
    live.direction.z = 0;
    assert.equal(projected.active, true, 'the projection froze the frame it was taken in');
    assert.equal(projected.count, 1);
    assert.equal(projected.nearestDistance, 20);
    assert.equal(projected.direction.z, 1);
});

function createEntityManager(projectileSystem) {
    return {
        players: [
            { index: 0, alive: true, position: { x: 0, y: 0, z: 0 } },
            { index: 1, alive: true, position: { x: 0, y: 0, z: 0 } },
        ],
        _projectileSystem: projectileSystem,
    };
}

test('the builder reads the rocket threat per player and survives a match without projectiles', () => {
    const threats = [
        { active: true, count: 1, nearestDistance: 30, timeToImpactSeconds: 1.5, direction: { x: 0, y: 0, z: -1 }, nearestSource: 'player' },
        { active: false, count: 0, nearestDistance: 0, timeToImpactSeconds: 0, direction: { x: 0, y: 0, z: 0 }, nearestSource: '' },
    ];
    const entityManager = createEntityManager({
        getRocketThreat: (playerIndex) => threats[playerIndex] || null,
    });

    const players = buildMatchRuntimeProjection({ game: { entityManager } }).players;
    assert.equal(players.length, 2);
    assert.equal(players[0].rocketThreat.active, true);
    assert.equal(players[0].rocketThreat.count, 1);
    assert.equal(players[0].rocketThreat.nearestDistance, 30);
    assert.equal(players[0].rocketThreat.source, 'player');
    assert.deepEqual(players[1].rocketThreat, inactiveThreat());

    // No projectile system at all (menu, replay, a mode without rockets): no threat, no crash.
    const bare = buildMatchRuntimeProjection({ game: { entityManager: createEntityManager(null) } });
    assert.deepEqual(bare.players[0].rocketThreat, inactiveThreat());
    const legacy = buildMatchRuntimeProjection({ game: { entityManager: createEntityManager({}) } });
    assert.deepEqual(legacy.players[0].rocketThreat, inactiveThreat());
});

test('the assembled runtime projection keeps the rocket threat on every player', () => {
    const player = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        rocketThreat: { count: 3, nearestDistance: 8, direction: { x: 0, y: 1, z: 0 }, source: 'turret' },
    });
    const assembled = assembleMatchRuntimeProjection({ players: [player] });
    assert.deepEqual(assembled.players[0].rocketThreat, {
        active: true,
        count: 3,
        nearestDistance: 8,
        timeToImpactSeconds: 0,
        direction: { x: 0, y: 1, z: 0 },
        source: 'turret',
    });
});
