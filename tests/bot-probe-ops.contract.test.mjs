import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { BotSensors } from '../src/entities/ai/BotSensors.js';
import { composeProbeDirection, scoreProbe, scanProbeRay } from '../src/entities/ai/BotProbeOps.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

function makeSensors() {
    const sensors = new BotSensors();
    sensors.profile = { probeStep: 4, probeSpread: 1, errorRate: 0 };
    sensors.sense.mapCaution = 0;
    sensors._tmpRight.set(1, 0, 0);
    return sensors;
}

function makePlayer(trailIndex = null) {
    return {
        index: 1,
        position: new THREE.Vector3(),
        speed: 18,
        baseSpeed: 18,
        hitboxRadius: 0.5,
        trail: trailIndex ? { entityManager: trailIndex } : null,
    };
}

test('probe composition honors 3D pitch and the runtime planar gameplay setting', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const probe = { yaw: 0, pitch: 1, dir: new THREE.Vector3() };

    composeProbeDirection({ config: { GAMEPLAY: { PLANAR_MODE: false } }, profile: { probeSpread: 1 } },
        forward, right, up, probe);
    assert.ok(probe.dir.y > 0.6, '3D probes sample vertical clearance');
    assert.ok(probe.dir.z < -0.6);

    composeProbeDirection({ config: { GAMEPLAY: { PLANAR_MODE: true } }, profile: { probeSpread: 1 } },
        forward, right, up, probe);
    assert.equal(probe.dir.y, 0, 'planar probes omit pitch');
    assert.deepEqual(probe.dir.toArray(), [0, 0, -1]);
});

test('scoring uses the fast wall callback and scans laterals when the center is blocked', () => {
    const sensors = makeSensors();
    const player = makePlayer();
    const rival = { index: 2, trail: null };
    const trailIndex = new TrailSpatialIndex({ players: [null, player, rival] });
    player.trail = { entityManager: trailIndex };

    const fastCalls = [];
    let fallbackCalls = 0;
    const arena = {
        checkBotCollisionFast(position, radius) {
            fastCalls.push({ x: position.x, z: position.z, radius });
            return Math.abs(position.x) < 0.15 && position.z <= -8;
        },
        checkCollisionFast() {
            fallbackCalls += 1;
            return false;
        },
    };
    const probe = {
        yaw: 0,
        pitch: 0,
        weight: 0,
        dir: new THREE.Vector3(0, 0, -1),
    };

    scoreProbe(sensors, player, arena, [player, rival], probe, 12);

    assert.equal(probe.wallDist, 8, 'the center ray reports the authored wall crossing');
    assert.equal(probe.trailDist, 10.8, 'unblocked lateral rays retain their shorter configured range');
    assert.equal(probe.immediateDanger, false);
    assert.ok(Number.isFinite(probe.risk));
    assert.ok(fastCalls.some(({ x }) => x > 0.2), 'danger caused a right-side scan');
    assert.ok(fastCalls.some(({ x }) => x < -0.2), 'danger caused a left-side scan');
    assert.equal(fallbackCalls, 0, 'the fast bot collision callback wins when both APIs exist');
});

test('scoring sees the actual rival trail and flags immediate danger', () => {
    const sensors = makeSensors();
    const player = makePlayer();
    const rival = { index: 2, trail: null };
    const trailIndex = new TrailSpatialIndex({ players: [null, player, rival] });
    player.trail = { entityManager: trailIndex };
    trailIndex.registerTrailSegment(2, 0, {
        fromX: -0.5, fromY: 0, fromZ: -4,
        toX: 0.5, toY: 0, toZ: -4,
        radius: 0.6,
    });
    const probe = {
        yaw: 0,
        pitch: 0,
        weight: 0,
        dir: new THREE.Vector3(0, 0, -1),
    };
    scoreProbe(sensors, player, { checkBotCollisionFast: () => false }, [player, rival], probe, 12);

    assert.equal(probe.trailDist, 4, 'the real spatial index reports the rival trail');
    assert.equal(probe.immediateDanger, true);
    assert.ok(Number.isFinite(probe.risk));
});

test('a clear fallback ray preserves full clearance and uses checkCollisionFast', () => {
    const sensors = makeSensors();
    const player = makePlayer();
    const calls = [];
    const out = {};
    scanProbeRay(sensors, player, {
        checkCollisionFast(position, radius) {
            calls.push({ position: position.clone(), radius });
            return false;
        },
    }, [player], new THREE.Vector3(0, 0, -1), 8, 4, out);

    assert.equal(calls.length, 2);
    assert.equal(out.wallDist, 8);
    assert.equal(out.trailDist, 8);
    assert.equal(out.immediateDanger, false);
    assert.ok(calls.every(({ radius }) => radius > 0));
});
