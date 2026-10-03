import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { buildObservation } from '../src/entities/ai/observation/ObservationSystem.js';
import { PowerupManager } from '../src/entities/Powerup.js';

function createPlayer() {
    return {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        hitboxRadius: 0.8,
        getDirection(out) { return out.set(0, 0, -1).applyQuaternion(this.quaternion); },
    };
}

function createProbeContext(player, arena, simulationNowMs, overrides = {}) {
    return {
        arena,
        players: [player],
        simulationNowMs,
        wallProbeCacheWindowMs: 18,
        wallProbeMinSteps: 4,
        wallProbeMaxSteps: 4,
        ...overrides,
    };
}

test('powerup bobbing and pickup box advance from accumulated update dt', () => {
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {}, CONFIG);
    const mesh = new THREE.Object3D();
    const item = {
        mesh,
        box: new THREE.Box3(),
        baseY: 4,
        phase: 0.3,
        animationKind: 'static',
        telegraphRemaining: 0,
        predictedCollected: false,
    };
    manager.items.push(item);

    manager.update(0.25);

    const expectedY = item.baseY + Math.sin(0.25 * CONFIG.POWERUP.BOUNCE_SPEED + item.phase) * CONFIG.POWERUP.BOUNCE_HEIGHT;
    assert.equal(manager._animationSeconds, 0.25);
    assert.ok(Math.abs(mesh.position.y - expectedY) < 1e-12);
    assert.equal(item.box.getCenter(new THREE.Vector3()).y, mesh.position.y);
    manager.clear();
    assert.equal(manager._animationSeconds, 0, 'clearing a round resets the pickup animation clock');
    manager.dispose();
});

test('bot runtime context supplies finite simulation time to observation context', () => {
    const entityManager = {
        _simulationClockMs: 1250,
        players: [],
        projectiles: [],
        powerupManager: { items: [] },
        runtimeConfig: { bot: {} },
    };
    const runtime = createBotRuntimeContext(entityManager, { isBot: true }, 1 / 60);

    assert.equal(runtime.observationContext.simulationNowMs, 1250);

    entityManager._simulationClockMs = undefined;
    const withoutClock = createBotRuntimeContext(entityManager, { isBot: true, index: 1 }, 1 / 60);
    assert.equal(withoutClock.observationContext.simulationNowMs, null);
});

test('wall probe cache reuses only when time and probe geometry inputs are unchanged', () => {
    const player = createPlayer();
    const counts = [0, 0];
    const arenas = counts.map((_, index) => ({
        checkCollision() { counts[index] += 1; return false; },
    }));
    const observeAt = (arena, simulationNowMs, overrides) => buildObservation(
        player,
        createProbeContext(player, arena, simulationNowMs, overrides)
    );

    observeAt(arenas[0], 100);
    const firstSampleChecks = counts[0];
    observeAt(arenas[0], 110);
    assert.equal(counts[0], firstSampleChecks, 'same-position probes are reused inside the cache window');

    observeAt(arenas[0], 90);
    const afterBackwardClockChecks = counts[0];
    assert.ok(afterBackwardClockChecks > firstSampleChecks, 'a backwards clock forces a fresh sample');
    observeAt(arenas[0], 91);
    assert.equal(counts[0], afterBackwardClockChecks, 'cache can resume from the new clock baseline');

    observeAt(arenas[1], 91);
    assert.ok(counts[1] > 0, 'the same player and tick resample against a different arena');
    const afterArenaChange = counts[1];
    observeAt(arenas[1], 91, { wallProbeDistance: 60 });
    assert.ok(counts[1] > afterArenaChange, 'a changed probe distance forces a fresh sample');
    const afterDistanceChange = counts[1];
    player.hitboxRadius = 1.2;
    observeAt(arenas[1], 91, { wallProbeDistance: 60 });
    assert.ok(counts[1] > afterDistanceChange, 'a changed effective radius forces a fresh sample');
    const afterRadiusChange = counts[1];
    observeAt(arenas[1], 91, { wallProbeDistance: 60, wallProbeMinSteps: 5, wallProbeMaxSteps: 5 });
    assert.ok(counts[1] > afterRadiusChange, 'changed probe step settings force a fresh sample');

    const playerWithoutClock = createPlayer();
    const observeWithoutClock = () => buildObservation(playerWithoutClock, createProbeContext(playerWithoutClock, arenas[0], undefined));
    observeWithoutClock();
    const firstUncachedChecks = counts[0];
    observeWithoutClock();
    assert.ok(counts[0] > firstUncachedChecks, 'missing simulation time never reuses cached probes');
});

test('observation context rejects unavailable and non-finite simulation time', () => {
    const player = createPlayer();
    let collisionChecks = 0;
    const arena = { checkCollision() { collisionChecks += 1; return false; } };
    for (const simulationNowMs of [undefined, null, NaN, Infinity, '100']) {
        const beforeInvalidSample = collisionChecks;
        buildObservation(player, createProbeContext(player, arena, simulationNowMs));
        const afterFirstSample = collisionChecks;
        assert.ok(afterFirstSample > beforeInvalidSample, `invalid clock ${String(simulationNowMs)} samples probes`);
        buildObservation(player, createProbeContext(player, arena, simulationNowMs));
        assert.ok(collisionChecks > afterFirstSample, `invalid clock ${String(simulationNowMs)} does not reuse probes`);
        assert.equal(
            createBotRuntimeContext({
                players: [], projectiles: [], powerupManager: { items: [] },
                runtimeConfig: { bot: {} }, _simulationClockMs: simulationNowMs,
            }, { isBot: true, index: String(simulationNowMs) }, 1 / 60).observationContext.simulationNowMs,
            null
        );
    }
});
