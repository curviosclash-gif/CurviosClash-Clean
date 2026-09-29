import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const HUNT_RUNTIME_CONFIG = createEntityRuntimeConfig(null, {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, RESPAWN_ENABLED: true, WIN_CONDITION: 'score' },
});

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

// A real Fight vehicle carrying a combat hangar loadout. The round start goes through the
// real EntitySpawnOps and the respawn through the real RespawnSystem, both with the real
// Hunt strategy, so the two spawn paths are compared exactly as the match runs them.
function createFightMatch() {
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: HUNT_RUNTIME_CONFIG, random: () => 0.5 });
    const entityManager = {
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        gameModeStrategy: strategy,
        _simulationClockMs: 0,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), 0, 0x33aaff, false, { entityManager });
    player.fightLoadout = { maxHpBonus: 40, speedBonusPct: 10, turningBonusPct: 10 };
    new EntitySpawnOps(entityManager).spawnPlayerAt(
        player,
        new THREE.Vector3(0, 20, 0),
        new THREE.Vector3(0, 0, -1),
    );
    const respawns = new RespawnSystem({
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        callbacks: { getStrategy: () => strategy, getSimulationNowMs: () => 0 },
        spawn: {
            findSpawnPosition: () => new THREE.Vector3(30, 20, 0),
            findSafeSpawnDirection: () => new THREE.Vector3(0, 0, 1),
        },
        events: { emitHuntFeed() {} },
    });
    return { player, respawns };
}

function dieAndRespawn(player, respawns) {
    player.alive = false;
    assert.equal(respawns.onPlayerDied(player), true, 'the Fight round schedules a respawn');
    respawns.update(60);
    assert.equal(player.alive, true, 'the vehicle is back in the round');
}

test('the combat hangar health bonus survives a respawn', () => {
    const { player, respawns } = createFightMatch();
    assert.equal(player.maxHp, 140, 'the round start grants the loadout health bonus');

    dieAndRespawn(player, respawns);

    assert.equal(player.maxHp, 140, 'the respawned vehicle keeps its loadout health bonus');
    assert.equal(player.hp, 140, 'the respawned vehicle starts with full bonus health');
});

test('repeated respawns neither lose nor stack the loadout speed and turning bonuses', () => {
    const { player, respawns } = createFightMatch();
    const startSpeed = player.baseSpeed;
    const startTurnSpeed = player.turnSpeed;

    dieAndRespawn(player, respawns);
    dieAndRespawn(player, respawns);

    assert.equal(player.maxHp, 140, 'two respawns do not stack the health bonus');
    assert.equal(player.baseSpeed, startSpeed, 'the speed bonus stays exactly as at round start');
    assert.equal(player.turnSpeed, startTurnSpeed, 'the turning bonus stays exactly as at round start');
});
