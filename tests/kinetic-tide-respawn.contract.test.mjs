import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { KINETIC_TIDE_MAP } from '../src/core/config/maps/presets/kinetic_tide.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';

function crossCheckpoint(system, player, entry, nowMs) {
    const length = Math.hypot(...entry.forward) || 1;
    const forward = entry.forward.map((value) => value / length);
    const distance = entry.radius * 0.5;
    const previousPosition = {
        x: entry.pos[0] - forward[0] * distance,
        y: entry.pos[1] - forward[1] * distance,
        z: entry.pos[2] - forward[2] * distance,
    };
    player.position.set(
        entry.pos[0] + forward[0] * distance,
        entry.pos[1] + forward[1] * distance,
        entry.pos[2] + forward[2] * distance,
    );
    return system.updatePlayerProgress(player, previousPosition, nowMs);
}

function createProgressHarness() {
    const map = KINETIC_TIDE_MAP.kinetic_tide;
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hitboxRadius: 1.1,
        position: new THREE.Vector3(),
    };
    const feedback = [];
    const entityManager = {
        arena: { currentMapDefinition: map },
        entityRuntimeConfig: CONFIG_SECTIONS,
        players: [player],
        _simulationClockMs: 0,
        _notifyPlayerFeedback(_player, message) { feedback.push(message); },
        recorder: { logEvent() {} },
    };
    const system = new ParcoursProgressSystem(entityManager);
    system.startRound([player]);
    return { feedback, map, player, system };
}

test('Kinetic Tide respawns three times at the last checkpoint, then restarts at checkpoint one', () => {
    const { feedback, player, system } = createProgressHarness();
    const route = system.getRouteSnapshot();
    const cp01 = route.checkpoints.find((entry) => entry.id === 'CP01');
    const cp02 = route.checkpoints.find((entry) => entry.id === 'CP02');

    assert.equal(route.rules.respawnOnDeath, true);
    assert.equal(route.rules.lastCheckpointRespawns, 3);
    assert.equal(crossCheckpoint(system, player, cp01, 100)?.checkpointId, 'CP01');
    assert.equal(crossCheckpoint(system, player, cp02, 600)?.checkpointId, 'CP02');

    for (let death = 1; death <= 3; death += 1) {
        system.onPlayerDeath(player, { cause: 'WALL' });
        const plan = system.takeRespawnPlan(player);
        const progress = system.getPlayerProgressSnapshot(player.index);

        assert.equal(plan?.kind, 'parcours');
        assert.equal(plan?.checkpointId, 'CP02');
        assert.equal(plan?.restartAtFirstCheckpoint, false);
        assert.equal(plan?.checkpointRespawnsUsed, death);
        assert.equal(progress?.nextCheckpointIndex, 1, 'the last checkpoint must be crossed again');
        assert.equal(progress?.checkpointRespawnsUsed, death);
        assert.equal(crossCheckpoint(system, player, cp02, 600 + death * 500)?.checkpointId, 'CP02');
    }

    system.onPlayerDeath(player, { cause: 'WALL' });
    const restartPlan = system.takeRespawnPlan(player);
    const restarted = system.getPlayerProgressSnapshot(player.index);

    assert.equal(restartPlan?.checkpointId, 'CP01');
    assert.equal(restartPlan?.restartAtFirstCheckpoint, true);
    assert.equal(restarted?.nextCheckpointIndex, 0);
    assert.equal(restarted?.checkpointRespawnsUsed, 0);
    assert.deepEqual(restarted?.passedCheckpointIds, []);
    assert.match(feedback.at(-1), /Checkpoint 1/);
});

test('Parcours RespawnSystem uses the authored checkpoint position and keeps Arcade out of deathmatch rules', () => {
    const spawnCalls = [];
    const recorderEvents = [];
    const spawnReasons = [];
    const plan = {
        kind: 'parcours',
        checkpointId: 'CP07',
        delaySeconds: 0.1,
        position: [12, 34, 56],
        forward: [1, 0, 0],
    };
    const strategy = {
        isRespawnEnabled: () => false,
        resetPlayerHealth(player) {
            player.maxHp = 125;
            player.hp = 125;
        },
    };
    const runtime = {
        callbacks: {
            getStrategy: () => strategy,
            getSimulationNowMs: () => 5000,
            parcours: {
                isRespawnEnabled: () => true,
                takeRespawnPlan: () => plan,
                onPlayerSpawn: (_player, options) => spawnReasons.push(options.reason),
            },
            combat: { resetRespawnCombatState() {} },
        },
        services: {
            entityRuntimeConfig: CONFIG_SECTIONS,
            recorder: {
                markPlayerSpawn() {},
                logEvent(...args) { recorderEvents.push(args); },
            },
        },
        spawn: {
            findSpawnPosition() { throw new Error('checkpoint respawn must not choose a random position'); },
            findSafeSpawnDirection() { throw new Error('checkpoint respawn supplies its direction'); },
        },
        events: { emitHuntFeed() {} },
    };
    const player = {
        index: 0,
        alive: false,
        isBot: false,
        hitboxRadius: 1.1,
        position: new THREE.Vector3(),
        inventory: ['SPEED_UP'],
        spawn(position, direction) {
            this.position.copy(position);
            this.alive = true;
            spawnCalls.push({ position: position.toArray(), direction: direction.toArray() });
        },
    };
    const respawnSystem = new RespawnSystem(runtime);

    assert.equal(respawnSystem.onPlayerDied(player), true);
    respawnSystem.update(0.1);

    assert.deepEqual(spawnCalls, [{ position: [12, 34, 56], direction: [1, 0, 0] }]);
    assert.equal(player.hp, 125);
    assert.deepEqual(player.inventory, ['SPEED_UP'], 'parcours respawn keeps the current inventory');
    assert.deepEqual(spawnReasons, ['parcours_respawn']);
    assert.match(recorderEvents[0]?.[2] || '', /kind=parcours/);

    const outcome = new RoundOutcomeSystem({
        getPlayers: () => [player],
        isRespawnEnabled: () => false,
        isEliminationSuppressed: () => true,
        // The moment between death and respawn: onPlayerDied above queued a checkpoint plan.
        isRespawnPending: () => true,
    });
    player.alive = false;
    assert.deepEqual(outcome.resolve(), {
        shouldEnd: false,
        winner: null,
        reason: '',
        parcours: null,
    });
});
