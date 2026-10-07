import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { EXCLUSION_ZONE_PHASES, ExclusionZoneSystem } from '../src/entities/systems/ExclusionZoneSystem.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const HUNT_RUNTIME_CONFIG = createEntityRuntimeConfig(null, {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, RESPAWN_ENABLED: true, WIN_CONDITION: 'score' },
});

function createMatch({ respawnKind = 'hunt', includeExclusionLifecycle = true } = {}) {
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: HUNT_RUNTIME_CONFIG, random: () => 0.5 });
    const runtimeStrategy = Object.create(strategy);
    runtimeStrategy.isRespawnEnabled = () => respawnKind === 'hunt';
    const players = [];
    const entityManager = {
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        gameModeStrategy: runtimeStrategy,
        players,
        arena: {
            bounds: { minX: -10, maxX: 10, minY: 0, maxY: 40, minZ: -10, maxZ: 10 },
            openFaces: ['maxX'],
            checkWorldGeometryCollision: () => false,
        },
        _simulationClockMs: 0,
        getTrailSpatialIndex() { return null; },
    };
    entityManager._overheatGunSystem = new OverheatGunSystem(entityManager);
    const player = new Player({ addToScene() {}, removeFromScene() {} }, 0, 0x33aaff, false, { entityManager });
    players.push(player);
    const zoneProjectiles = [];
    const exclusionZoneSystem = new ExclusionZoneSystem(entityManager, {
        projectileSystem: {
            spawnExternalProjectile(projectile) {
                zoneProjectiles.push(projectile);
                return projectile;
            },
            trimZoneProjectiles() {},
        },
    });
    entityManager._exclusionZoneSystem = exclusionZoneSystem;
    const runtimeSupport = createEntityRuntimeSupport(entityManager);
    const spawnOps = new EntitySpawnOps(entityManager);
    const respawns = new RespawnSystem({
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        callbacks: {
            getStrategy: () => runtimeStrategy,
            getSimulationNowMs: () => 0,
            ...(includeExclusionLifecycle ? { lifecycle: runtimeSupport.runtimeContext.callbacks.lifecycle } : {}),
            parcours: respawnKind === 'parcours' ? {
                isRespawnEnabled: () => true,
                takeRespawnPlan: () => ({
                    delaySeconds: 0.1,
                    position: [0, 20, 0],
                    forward: [0, 0, -1],
                }),
                onPlayerSpawn() {},
            } : {},
        },
        spawn: {
            findSpawnPosition: () => SPAWN_POS.clone(),
            findSafeSpawnDirection: () => new THREE.Vector3(0, 0, 1),
        },
        combat: { resetRespawnCombatState: (target) => entityManager._overheatGunSystem.resetPlayer(target.index) },
        events: { emitHuntFeed() {} },
    });
    return { player, spawnOps, respawns, entityManager, exclusionZoneSystem, zoneProjectiles };
}

const SPAWN_POS = new THREE.Vector3(0, 20, 0);
const SPAWN_DIR = new THREE.Vector3(0, 0, -1);

// Everything a fight leaves behind that a new life must not inherit.
function dirtyCombatState(player, entityManager) {
    player.flameActive = true;
    player.hasFlamethrower = true;
    player.hasRailgun = true;
    player.flameFuelSeconds = 3;
    player.railShots = 2;
    player.slowTimeExemptsOwner = true;
    player.arcadeBurstShots = 2;
    player.shootCooldownCarry = 0.04;
    player.shootCooldown = 0.3;
    player.fightLastAttackerIndex = 3;
    player.fightLastThreatSourceIndex = 3;
    player.fightLastThreatAtSeconds = 12;
    player.fightTargetPlayerIndex = 3;
    player.fightTargetLockRemaining = 2;
    player.itemUseCooldownRemaining = 1.5;
    player.steeringLockTimer = 0.4;
    player.activeEffects = [{ type: 'FLAMETHROWER', remaining: 20, fuelSeconds: 3 }];
    entityManager._overheatGunSystem._state.setOverheatValue(player.index, 95.3);
    entityManager._overheatGunSystem._state.lockoutByPlayer[player.index] = 0.67;
}

const COMBAT_FIELDS = [
    'flameActive', 'hasFlamethrower', 'hasRailgun', 'flameFuelSeconds', 'railShots',
    'slowTimeExemptsOwner', 'arcadeBurstShots', 'shootCooldownCarry', 'shootCooldown',
    'fightLastAttackerIndex', 'fightLastThreatSourceIndex', 'fightLastThreatAtSeconds',
    'fightTargetPlayerIndex', 'fightTargetLockRemaining', 'itemUseCooldownRemaining',
    'steeringLockTimer',
];
// Left out on purpose: hasShield (a respawn grants the configured recovery shield, a round
// start does not) and spawnProtectionTimer (respawn invulnerability is its own setting).

function enterExclusionPhase(exclusionZoneSystem, player, phase) {
    player.position.set(20, 20, 0);
    player.alive = true;
    player.spawnProtectionTimer = 0;
    exclusionZoneSystem.update(1);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.GRACE);
    if (phase === EXCLUSION_ZONE_PHASES.SALVO) exclusionZoneSystem.update(4);
    assert.equal(player.exclusionZoneState.phase, phase);
    assert.equal(exclusionZoneSystem.states.has(player.index), true);
}

function captureCombatState(player, entityManager) {
    const state = {};
    for (const field of COMBAT_FIELDS) state[field] = player[field];
    state.activeEffects = player.activeEffects.length;
    state.heat = entityManager._overheatGunSystem.getOverheatValue(player.index);
    state.lockout = entityManager._overheatGunSystem._state.lockoutByPlayer[player.index] || 0;
    return state;
}

test('killing a player puts out its flame', () => {
    const { player } = createMatch();
    player.flameActive = true;
    player.kill();
    assert.equal(player.flameActive, false, 'a dead player must not keep a burning jet in the snapshot');
});

test('a spawn clears the weapon fields derived from the dropped effects', () => {
    const { player, entityManager } = createMatch();
    dirtyCombatState(player, entityManager);

    player.spawn(SPAWN_POS, SPAWN_DIR);

    assert.equal(player.hasFlamethrower, false);
    assert.equal(player.hasRailgun, false);
    assert.equal(player.flameFuelSeconds, 0);
    assert.equal(player.railShots, 0);
    assert.equal(player.slowTimeExemptsOwner, false);
    assert.equal(player.arcadeBurstShots, 0);
    assert.equal(player.shootCooldownCarry, 0);
    assert.equal(player.flameActive, false);
});

test('respawn and round start reset the same combat and timer fields', () => {
    const roundStart = createMatch();
    roundStart.spawnOps.spawnPlayerAt(roundStart.player, SPAWN_POS, SPAWN_DIR);
    dirtyCombatState(roundStart.player, roundStart.entityManager);
    roundStart.spawnOps.spawnPlayerAt(roundStart.player, SPAWN_POS, SPAWN_DIR);

    const respawn = createMatch();
    respawn.spawnOps.spawnPlayerAt(respawn.player, SPAWN_POS, SPAWN_DIR);
    dirtyCombatState(respawn.player, respawn.entityManager);
    respawn.player.alive = false;
    assert.equal(respawn.respawns.onPlayerDied(respawn.player), true);
    respawn.respawns.update(60);
    assert.equal(respawn.player.alive, true);

    const atRoundStart = captureCombatState(roundStart.player, roundStart.entityManager);
    const atRespawn = captureCombatState(respawn.player, respawn.entityManager);
    assert.deepEqual(atRespawn, atRoundStart);
    assert.equal(atRoundStart.heat, 0);
    assert.equal(atRoundStart.lockout, 0);
});

test('inventory is the one deliberate difference: respawn empties it, round start keeps it (D3)', () => {
    const roundStart = createMatch();
    roundStart.player.inventory.push('SHIELD', 'EMP');
    roundStart.spawnOps.spawnPlayerAt(roundStart.player, SPAWN_POS, SPAWN_DIR);
    assert.deepEqual(roundStart.player.inventory, ['SHIELD', 'EMP'], 'a round start keeps the carried items');

    const respawn = createMatch();
    respawn.player.inventory.push('SHIELD', 'EMP');
    respawn.player.alive = false;
    respawn.respawns.onPlayerDied(respawn.player);
    respawn.respawns.update(60);
    assert.ok(!respawn.player.inventory.includes('EMP'), 'a respawn drops the carried items');
});

for (const respawnKind of ['hunt', 'parcours']) {
    for (const phase of [EXCLUSION_ZONE_PHASES.GRACE, EXCLUSION_ZONE_PHASES.SALVO]) {
        test(`${respawnKind} respawn clears real exclusion-zone ${phase} state`, () => {
            const match = createMatch({ respawnKind });
            enterExclusionPhase(match.exclusionZoneSystem, match.player, phase);
            const projectilesBeforeRespawn = match.zoneProjectiles.length;

            match.player.alive = false;
            assert.equal(match.respawns.onPlayerDied(match.player), true);
            match.respawns.update(60);
            assert.equal(match.player.alive, true);
            assert.deepEqual(match.player.exclusionZoneState, {
                phase: EXCLUSION_ZONE_PHASES.SAFE,
                elapsedSeconds: 0,
                countdownSeconds: 0,
                stage: '',
            });
            assert.equal(match.exclusionZoneSystem.states.has(match.player.index), false);

            match.exclusionZoneSystem.update(1);
            assert.equal(match.zoneProjectiles.length, projectilesBeforeRespawn,
                'spawn protection must keep the reset player from launching another salvo');
        });
    }
}

test('round-start spawn remains an exclusion-zone reset control path', () => {
    const match = createMatch();
    enterExclusionPhase(match.exclusionZoneSystem, match.player, EXCLUSION_ZONE_PHASES.SALVO);

    match.spawnOps.spawnPlayerAt(match.player, SPAWN_POS, SPAWN_DIR);

    assert.deepEqual(match.player.exclusionZoneState, {
        phase: EXCLUSION_ZONE_PHASES.SAFE,
        elapsedSeconds: 0,
        countdownSeconds: 0,
        stage: '',
    });
    assert.equal(match.exclusionZoneSystem.states.has(match.player.index), false);
});

test('respawn contexts without the optional exclusion lifecycle callback remain compatible', () => {
    const match = createMatch({ includeExclusionLifecycle: false });
    match.player.alive = false;
    assert.equal(match.respawns.onPlayerDied(match.player), true);

    match.respawns.update(60);

    assert.equal(match.player.alive, true);
});
