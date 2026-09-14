import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { resolveItemSlotIndex } from '../src/entities/ai/observation/ItemSlotEncoder.js';
import { INVENTORY_COUNT_RATIO, ITEM_SLOT_00 } from '../src/entities/ai/observation/ObservationSchemaV1.js';
import { buildObservation } from '../src/entities/ai/observation/ObservationSystem.js';
import {
    addPlayerInventoryItem,
    cyclePlayerInventoryItem,
    ensurePlayerInventoryCollections,
} from '../src/entities/player/PlayerInventoryOps.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { resolveInventoryActionAvailability } from '../src/shared/contracts/GameplayActionAvailabilityContract.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';

function createProjectilePlayer() {
    return {
        index: 0,
        inventory: ['SLOW_DOWN'],
        rocketInventory: ['ROCKET_WEAK', 'ROCKET_HEAVY'],
        selectedItemIndex: 0,
        shootCooldown: 0,
        activeEffects: [],
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        getAimDirection(out) { return out.set(0, 0, -1); },
    };
}

function createProjectileSystem() {
    const itemTarget = { index: 1, alive: true, position: new THREE.Vector3(0, 0, -40) };
    const system = new ProjectileSystem({
        entityRuntimeConfig: CONFIG,
        getStrategy: () => ({
            getPickupModeType: () => 'HUNT',
            resolveRocketProjectileParams: (type) => (String(type).startsWith('ROCKET_') ? {
                visualScale: 1,
                collisionRadiusMultiplier: 1,
                homingTurnRate: 3,
                homingLockOnAngle: 15,
                homingRange: 100,
                homingReacquireInterval: 0.2,
            } : null),
        }),
        peekInventoryItem: (player, index) => ({ ok: true, type: player.inventory[index], meta: { index } }),
        takeInventoryItem: (player, index) => ({ ok: true, type: player.inventory.splice(index, 1)[0] }),
        resolveLockOn: (_player, profile) => (profile === 'item' ? itemTarget : null),
    });
    system._acquireProjectileMesh = () => new THREE.Group();
    system._rocketTrailSystem.initializeProjectile = () => {};
    return system;
}

test('pickups fill two independent five-slot inventories and rockets never enter selection', () => {
    const player = { inventory: [], rocketInventory: [], selectedItemIndex: 0, entityRuntimeConfig: CONFIG };
    for (let i = 0; i < 5; i += 1) {
        assert.equal(addPlayerInventoryItem(player, 'SHIELD'), true);
        assert.equal(addPlayerInventoryItem(player, 'ROCKET_WEAK'), true);
    }
    assert.equal(addPlayerInventoryItem(player, 'SHIELD'), false);
    assert.equal(addPlayerInventoryItem(player, 'ROCKET_HEAVY'), false);
    assert.deepEqual(player.inventory, Array(5).fill('SHIELD'));
    assert.deepEqual(player.rocketInventory, Array(5).fill('ROCKET_WEAK'));
    cyclePlayerInventoryItem(player);
    assert.equal(player.selectedItemIndex, 1);

    const legacy = { inventory: ['SHIELD', 'ROCKET_HEAVY', 'EMP'], selectedItemIndex: 1 };
    ensurePlayerInventoryCollections(legacy);
    assert.deepEqual(legacy.inventory, ['SHIELD', 'EMP']);
    assert.deepEqual(legacy.rocketInventory, ['ROCKET_HEAVY']);
    assert.equal(legacy.selectedItemIndex, 1);
});

test('rocket shots are FIFO, blocked shots consume nothing, then nonrocket projectiles remain shootable', () => {
    const player = createProjectilePlayer();
    const system = createProjectileSystem();

    player.shootCooldown = 0.5;
    assert.equal(system.shootItemProjectile(player, -1, true).ok, false);
    assert.deepEqual(player.rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);
    assert.deepEqual(player.inventory, ['SLOW_DOWN']);

    player.shootCooldown = 0;
    assert.equal(system.shootItemProjectile(player, 0).type, 'SLOW_DOWN');
    assert.deepEqual(player.inventory, []);
    assert.deepEqual(player.rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);
    player.shootCooldown = 0;
    assert.equal(system.shootItemProjectile(player, -1, true).type, 'ROCKET_WEAK');
    assert.deepEqual(player.rocketInventory, ['ROCKET_HEAVY']);
    player.shootCooldown = 0;
    assert.equal(system.shootItemProjectile(player, -1, true).type, 'ROCKET_HEAVY');
    assert.deepEqual(player.rocketInventory, []);
    player.shootCooldown = 0;
    player.inventory.push('SLOW_DOWN');
    const projectileCount = system.projectiles.length;
    assert.equal(system.shootItemProjectile(player, -1, true).ok, false);
    assert.deepEqual(player.inventory, ['SLOW_DOWN']);
    assert.equal(system.projectiles.length, projectileCount);
});

test('failed rocket projectile creation leaves the FIFO queue untouched', () => {
    const player = createProjectilePlayer();
    const system = createProjectileSystem();
    system._acquireProjectileMesh = () => { throw new Error('mesh pool unavailable'); };
    assert.throws(() => system.shootItemProjectile(player, -1, true), /mesh pool unavailable/);
    assert.deepEqual(player.rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);
    assert.equal(system.projectiles.length, 0);
});

test('action availability keeps selected item use while exposing the next queued rocket shot', () => {
    const action = resolveInventoryActionAvailability({
        player: {
            inventory: ['SHIELD'],
            rocketInventory: ['ROCKET_MEDIUM'],
            selectedItemIndex: 0,
            shootCooldown: 0,
            itemUseCooldownRemaining: 0,
        },
        modeType: 'HUNT',
    });
    assert.equal(action.rawType, 'SHIELD');
    assert.equal(action.nextRocketType, 'ROCKET_MEDIUM');
    assert.equal(action.canUseNow, true);
    assert.equal(action.canShootNow, true);
    assert.equal(action.canCycle, false);
});

test('bot observation still reports queued rockets after they left the item inventory', () => {
    const player = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        speed: 35,
        baseSpeed: 35,
        hitboxRadius: 0.8,
        inventory: ['SHIELD'],
        rocketInventory: ['ROCKET_HEAVY'],
        selectedItemIndex: 0,
        getDirection(out) { return out.set(0, 0, -1); },
    };
    const observation = buildObservation(player, { players: [player], wallProbeCacheWindowMs: 0 });
    assert.equal(observation[ITEM_SLOT_00 + resolveItemSlotIndex('SHIELD')], 1);
    assert.equal(observation[ITEM_SLOT_00 + resolveItemSlotIndex('ROCKET_HEAVY')], 1);

    const itemsOnly = buildObservation({ ...player, rocketInventory: [] }, { players: [player], wallProbeCacheWindowMs: 0 });
    assert.ok(observation[INVENTORY_COUNT_RATIO] > itemsOnly[INVENTORY_COUNT_RATIO]);
});

test('network snapshots, reconciliation and runtime projections preserve both inventories', () => {
    const player = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        inventory: ['SHIELD'],
        rocketInventory: ['ROCKET_WEAK', 'ROCKET_HEAVY'],
        activeEffects: [],
    };
    const snapshot = createGameStateSnapshot({ players: [player] }, { frame: 1 });
    assert.deepEqual(snapshot.players[0].rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);

    const replica = {
        index: 0,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        inventory: [],
        rocketInventory: [],
        activeEffects: [],
        view: { setVisible() {} },
    };
    const reconciler = new StateReconciler({ positionSnapThreshold: 0, rotationSnapThreshold: 0 });
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile([replica], {});
    assert.deepEqual(replica.inventory, ['SHIELD']);
    assert.deepEqual(replica.rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);

    const projection = createMatchRuntimePlayerProjection(player);
    assert.deepEqual(projection.inventory, ['SHIELD']);
    assert.deepEqual(projection.rocketInventory, ['ROCKET_WEAK', 'ROCKET_HEAVY']);
});
