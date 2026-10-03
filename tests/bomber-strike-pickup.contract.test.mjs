import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { updateBomberBombs } from '../src/entities/systems/map-units/MapUnitBombOps.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { BOMBER_STRIKE_FORMATION, resolveBomberStrikeFormation } from '../src/shared/contracts/BomberStrikeFormationContract.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { usePlayerInventoryItem } from '../src/entities/player/PlayerInventoryOps.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import {
    BOMBER_STRIKE_PICKUP_DEFINITIONS,
} from '../src/shared/contracts/BomberStrikePickupDefinitionsContract.js';
import { getPickupDefinition } from '../src/entities/PickupRegistry.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';

function createPlayer(index, x = 0) {
    return {
        index, alive: true, hp: 100, maxHp: 100, spawnProtectionTimer: 0,
        position: new THREE.Vector3(x, 0, 0), teamId: index === 0 ? 'ALPHA' : 'BRAVO',
        hitboxRadius: 1.5, activeEffects: [], inventory: ['BOMBER_STRIKE'], selectedItemIndex: 0,
        takeDamage(amount) {
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
        applyPowerup(type) { applyPlayerPowerup(this, type); },
    };
}

function createWorld() {
    const caller = createPlayer(0);
    const enemy = createPlayer(1);
    const manager = {
        huntEnabled: true,
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            bounds: { minX: -45, maxX: 45, minY: 0, maxY: 60, minZ: -45, maxZ: 45 },
            currentMapDefinition: { mapUnits: [] },
        },
        players: [caller, enemy], humanPlayers: [caller],
        particles: { spawnExplosion() {}, spawnHit() {} },
        _emitHuntDamageEvent() {}, _killPlayer() {}, _notifyPlayerFeedback() {},
    };
    manager.arena.getCollisionInfo = (position) => position.y <= 0
        ? { hit: true, kind: 'floor' } : null;
    manager.arena.raycast = () => ({ hit: false });
    manager._projectileSystem = new ProjectileSystem({
        getArena: () => manager.arena,
        getPlayers: () => manager.players,
        onProjectileHit: () => {},
        onProjectileDamage: (target, source, type, damageResult, projectile) => {
            manager._emitHuntDamageEvent({ target, sourcePlayer: source, cause: type, damageResult, impactPoint: projectile.position });
            if (damageResult?.isDead) manager._killPlayer(target, 'PROJECTILE', { killer: source, impactPoint: projectile.position, projectileType: type });
        },
    });
    caller.entityManager = manager;
    enemy.entityManager = manager;
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { manager, system, caller, enemy };
}

test('the bomber strike is a rare combat pickup', () => {
    assert.deepEqual(BOMBER_STRIKE_PICKUP_DEFINITIONS.BOMBER_STRIKE.allowedModes, ['ARCADE', 'HUNT']);
    const definition = getPickupDefinition('BOMBER_STRIKE');
    assert.equal(definition.selfUsable, true);
    assert.match(definition.description, /fünf Bomber/);
    assert.equal(definition.spawnWeights.CLASSIC, 0);
    assert.equal(definition.spawnWeights.HUNT, 0.225);
});

test('formation contracts accept nested bounds and compress without crossing the map footprint', () => {
    const formation = resolveBomberStrikeFormation({
        min: { x: -21, y: 0, z: -28 }, max: { x: 21, y: 30, z: 28 },
    }, new THREE.Vector3(0, 0, 8));
    assert.equal(formation.length, BOMBER_STRIKE_FORMATION.count);
    for (const bomber of formation) {
        for (const [x, y, z] of bomber.path) {
            assert.ok(x - BOMBER_STRIKE_FORMATION.hitboxRadius >= -21 - 0.001);
            assert.ok(x + BOMBER_STRIKE_FORMATION.hitboxRadius <= 21 + 0.001);
            assert.ok(y - BOMBER_STRIKE_FORMATION.hitboxRadius >= -0.001);
            assert.ok(y + BOMBER_STRIKE_FORMATION.hitboxRadius <= 30 + 0.001);
            assert.ok(z - BOMBER_STRIKE_FORMATION.hitboxRadius >= -28 - 0.001);
            assert.ok(z + BOMBER_STRIKE_FORMATION.hitboxRadius <= 28 + 0.001);
        }
    }
});

test('formation recentres at both edges and rejects bounds too small for distinct aircraft', () => {
    for (const callerZ of [-200, 200]) {
        const formation = resolveBomberStrikeFormation({ minX: -50, maxX: 50, minY: 0, maxY: 50, minZ: -30, maxZ: 30 },
            new THREE.Vector3(0, 0, callerZ));
        assert.equal(formation.length, 5);
        for (const bomber of formation) {
            for (const [, , z] of bomber.path) {
                assert.ok(z - BOMBER_STRIKE_FORMATION.hitboxRadius >= -30);
                assert.ok(z + BOMBER_STRIKE_FORMATION.hitboxRadius <= 30);
            }
        }
    }
    assert.equal(resolveBomberStrikeFormation({ minX: -15, maxX: 15, minY: 0, maxY: 20, minZ: -10, maxZ: 10 },
        new THREE.Vector3()), null);
    assert.equal(resolveBomberStrikeFormation({ minX: -50, maxX: 50, minY: 0, maxY: 12, minZ: -40, maxZ: 40 },
        new THREE.Vector3()), null);
});

test('failed authority or missing projectile support leaves the bomber item untouched', () => {
    const { manager, caller } = createWorld();
    manager.isFightOutcomeAuthority = false;
    assert.equal(usePlayerInventoryItem(caller, 'HUNT').ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
    manager.isFightOutcomeAuthority = true;
    manager._projectileSystem.spawnBomberBomb = null;
    assert.equal(usePlayerInventoryItem(caller, 'HUNT').ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
});

test('an arena too small for five separate bomber footprints refuses item use', () => {
    const { manager, caller } = createWorld();
    manager.arena.bounds = { minX: -15, maxX: 15, minY: 0, maxY: 20, minZ: -10, maxZ: 10 };
    const result = usePlayerInventoryItem(caller, 'HUNT');
    assert.equal(result.ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
});

test('a mid-formation visual failure removes every partial plane and keeps the item', () => {
    const { manager, system, caller } = createWorld();
    const roots = [];
    manager.renderer = {
        addToScene(root) {
            roots.push(root);
            if (roots.length === 5) throw new Error('injected fifth plane renderer failure');
        },
        removeFromScene(root) {
            const index = roots.indexOf(root);
            if (index >= 0) roots.splice(index, 1);
        },
    };
    const result = usePlayerInventoryItem(caller, 'HUNT');
    assert.equal(result.ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
    assert.equal(system.units.length, 0);
    assert.equal(roots.length, 0);
});

test('a later bomber visual update failure also rolls back its newly registered root', () => {
    const { manager, system, caller } = createWorld();
    const roots = [];
    manager.renderer = {
        addToScene: (root) => roots.push(root),
        removeFromScene: (root) => { const index = roots.indexOf(root); if (index >= 0) roots.splice(index, 1); },
    };
    const updateVisual = system._updateVisual.bind(system);
    let calls = 0;
    system._updateVisual = (unit, dt) => {
        calls += 1;
        if (calls === 3) throw new Error('injected third plane visual update failure');
        return updateVisual(unit, dt);
    };
    const result = usePlayerInventoryItem(caller, 'HUNT');
    assert.equal(result.ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
    assert.equal(system.units.length, 0);
    assert.equal(roots.length, 0);
});

test('the HUNT action consumes the pickup only after its formation activates', () => {
    const { manager, caller } = createWorld();
    let attempts = 0;
    const combat = new HuntCombatSystem({
        entityRuntimeConfig: { POWERUP: { TYPES: { BOMBER_STRIKE: {} } }, PLAYER: {} },
        callbacks: { getStrategy: () => manager.gameModeStrategy },
        combat: { callBomberStrike: () => { attempts += 1; return false; } },
        players: [caller],
    });
    const failed = combat.useInventoryItem(caller);
    assert.equal(failed.ok, false);
    assert.deepEqual(caller.inventory, ['BOMBER_STRIKE']);
    assert.equal(attempts, 1);

    combat.runtime.combat.callBomberStrike = () => { attempts += 1; return true; };
    const used = combat.useInventoryItem(caller);
    assert.equal(used.ok, true);
    assert.deepEqual(caller.inventory, []);
    assert.equal(attempts, 2, 'the HUNT path activates exactly once');
});

/**
 * Builds the entity runtime exactly as EntityRuntimeAssembler does, so the HUNT item action
 * reaches the bomber through the same runtime context the game hands to HuntCombatSystem â€”
 * a hand-made context would hide a callback that the real assembly never provides.
 */
function createAssembledHuntWorld() {
    const { manager, caller } = createWorld();
    manager.entityRuntimeConfig = {
        ...CONFIG_BASE,
        HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
    };
    const support = createEntityRuntimeSupport(manager);
    manager._projectileSystem = support.projectileSystem;
    const systems = createEntityRuntimeSystems(manager, support.runtimeContext, support);
    systems.mapUnitSystem.startRound();
    return { manager, caller, combat: systems.huntCombatSystem, mapUnits: systems.mapUnitSystem };
}

test('using the bomber item through the assembled HUNT runtime calls five bombers', () => {
    const { caller, combat, mapUnits } = createAssembledHuntWorld();
    const result = combat.useInventoryItem(caller);
    assert.equal(result.ok, true, `the HUNT item key triggers the strike, got: ${result.reason}`);
    assert.deepEqual(caller.inventory, [], 'a successful strike consumes the item');
    assert.equal(mapUnits.units.filter((unit) => unit.summoned).length, 5, 'five bombers take off');
});

test('a refused bomber strike through the assembled HUNT runtime keeps the item', () => {
    const { manager, caller, combat, mapUnits } = createAssembledHuntWorld();
    caller.inventory = ['SHIELD', 'BOMBER_STRIKE'];
    caller.selectedItemIndex = 1;
    manager.isFightOutcomeAuthority = false;
    const result = combat.useInventoryItem(caller);
    assert.equal(result.ok, false);
    assert.deepEqual(caller.inventory, ['SHIELD', 'BOMBER_STRIKE'], 'the inventory is restored in order');
    assert.equal(caller.selectedItemIndex, 1, 'the selection stays on the bomber');
    assert.equal(mapUnits.units.length, 0);
});

test('bomber blast checks 3D distance, solid cover, allies, source and spawn protection', () => {
    const { manager, caller, enemy } = createWorld();
    const ally = createPlayer(2, 0);
    ally.teamId = caller.teamId;
    const protectedEnemy = createPlayer(3, 0);
    protectedEnemy.spawnProtectionTimer = 2;
    const elevated = createPlayer(4, 0);
    elevated.position.y = 16;
    manager.players.push(ally, protectedEnemy, elevated);
    enemy.position.set(5, 0, 0);
    manager.arena.raycast = (_origin, direction) => direction.x > 0.5
        ? { hit: true, distance: 1 } : { hit: false };
    const bomb = manager._projectileSystem.spawnBomberBomb(caller,
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(), { damage: 50, blastRadius: 15 });
    manager._projectileSystem.update(0.01);
    assert.equal(manager._projectileSystem.projectiles.length, 0, 'the first arena contact consumes the projectile');
    assert.equal(enemy.hp, 100, 'solid arena cover blocks the blast');
    assert.equal(ally.hp, 100, 'friendly players are protected');
    assert.equal(protectedEnemy.hp, 100, 'spawn protection blocks the blast');
    assert.equal(elevated.hp, 100, 'the blast radius is three-dimensional');

    manager.arena.raycast = () => ({ hit: false });
    const clearBomb = manager._projectileSystem.spawnBomberBomb(caller,
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(), { damage: 50, blastRadius: 15 });
    manager._projectileSystem.update(0.01);
    assert.equal(manager._projectileSystem.projectiles.length, 0, 'a second impact also removes exactly once');
    assert.ok(enemy.hp < 100, 'an unobstructed enemy in range takes blast damage');
    assert.equal(enemy.hp, 50, 'the default blast preserves the configured 50 damage throughout its radius');
    assert.equal(caller.hp, 100, 'the item source is protected from its own bomb');
});

test('an expired bomb without physical contact is removed without an explosion or damage', () => {
    const { manager, caller, enemy } = createWorld();
    const hitEvents = [];
    manager._projectileSystem.onProjectileHit = (...args) => hitEvents.push(args);
    const bomb = manager._projectileSystem.spawnBomberBomb(
        caller, new THREE.Vector3(0, 30, 0), new THREE.Vector3(),
    );
    bomb.ttl = 0.01;
    manager._projectileSystem.update(0.02);
    assert.equal(manager._projectileSystem.projectiles.includes(bomb), false);
    assert.equal(enemy.hp, 100);
    assert.deepEqual(hitEvents, []);
});

test('thin solid cover immediately before a player still blocks the blast', () => {
    const { manager, caller, enemy } = createWorld();
    enemy.position.set(5, 0, 0);
    manager.arena.raycast = (_origin, direction, distance) => direction.x > 0.5
        ? { hit: true, distance: distance - 0.2 } : { hit: false };
    manager._projectileSystem.spawnBomberBomb(caller, new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    manager._projectileSystem.update(0.01);
    assert.equal(enemy.hp, 100, 'cover 0.2 units before the target cannot be skipped by a broad tolerance');
});

test('Arcade part sweeps ignore miss sentinels and accept a contact at segment start', () => {
    const { manager, caller, enemy } = createWorld();
    enemy.position.set(30, 10, 0);
    enemy.quaternion = new THREE.Quaternion();
    enemy.arcadeHitbox = { full: { boxes: new Float32Array([0, 0, 0, 0.5, 0.5, 0.5]), count: 1 } };
    const bomb = manager._projectileSystem.spawnBomberBomb(
        caller, new THREE.Vector3(0, 10, 0), new THREE.Vector3(),
    );
    manager._projectileSystem.update(0.01);
    assert.equal(manager._projectileSystem.projectiles.includes(bomb), true, 'a -1 Arcade miss sentinel is not contact');

    enemy.position.set(0, 10, 0);
    manager._projectileSystem.update(0.01);
    assert.equal(manager._projectileSystem.projectiles.length, 0, 'entry at t=0 is a valid immediate contact');
});

test('the first player surface hit wins over a later wall and target array order', () => {
    const { manager, caller } = createWorld();
    const fartherLarge = createPlayer(2);
    fartherLarge.position.set(6, 9.88, 0);
    fartherLarge.hitboxRadius = 3;
    const nearerSmall = createPlayer(3);
    nearerSmall.position.set(5, 9.88, 0);
    nearerSmall.hitboxRadius = 1.5;
    manager.players.push(fartherLarge, nearerSmall);
    let impactX = Infinity;
    manager._projectileSystem.onProjectileHit = (position) => { impactX = position.x; };
    const bomb = manager._projectileSystem.spawnBomberBomb(caller,
        new THREE.Vector3(0, 10, 0), new THREE.Vector3(100, 0, 0));
    manager._projectileSystem.update(0.1);
    assert.equal(manager._projectileSystem.projectiles.includes(bomb), false);
    assert.ok(impactX > 2.3 && impactX < 2.6, `larger farther-centred target should enter first near x=2.45, got ${impactX}`);

    const wallWorld = createWorld();
    const wallEnemy = createPlayer(2);
    wallEnemy.position.set(3, 9.88, 0);
    wallWorld.manager.players.push(wallEnemy);
    wallWorld.manager.arena.getCollisionInfo = (position) => position.x >= 5
        ? { hit: true, kind: 'wall' }
        : (position.y <= 0 ? { hit: true, kind: 'floor' } : null);
    let wallImpactX = Infinity;
    wallWorld.manager._projectileSystem.onProjectileHit = (position) => { wallImpactX = position.x; };
    wallWorld.manager._projectileSystem.spawnBomberBomb(wallWorld.caller,
        new THREE.Vector3(0, 10, 0), new THREE.Vector3(100, 0, 0));
    wallWorld.manager._projectileSystem.update(0.1);
    assert.ok(wallImpactX < 2, `enemy contact should precede the x=5 wall, got ${wallImpactX}`);
});

test('a low-frame-rate update still catches a fast bomb crossing a player', () => {
    const { manager, caller, enemy } = createWorld();
    enemy.position.set(100, 9.5, 0);
    const bomb = manager._projectileSystem.spawnBomberBomb(
        caller, new THREE.Vector3(0, 10, 0), new THREE.Vector3(1000, 0, 0),
    );
    manager._projectileSystem.update(0.25);
    assert.equal(manager._projectileSystem.projectiles.includes(bomb), false);
    assert.ok(enemy.hp < 100, 'swept collision catches the player despite a 250-unit frame displacement');
});

test('using the item calls five bombers that drop pooled bombs aimed at the enemy after 0.75 seconds', () => {
    const { manager, system, caller, enemy } = createWorld();
    // Straight ahead of the formation, where the leader's first bomb lands (hunting strikes only aim).
    enemy.position.set(61, 0, 0);
    const result = usePlayerInventoryItem(caller, 'HUNT');
    assert.equal(result.ok, true);
    assert.deepEqual(caller.inventory, [], 'one use consumes the item');
    assert.equal(system.units.length, 5);
    const [leader, ...followers] = system.units;
    assert.equal(leader.summoned, true);
    assert.equal(leader.calledByIndex, caller.index);
    assert.equal(leader.maxHp, 120);
    assert.equal(leader.speed, 30);
    assert.deepEqual(leader.definition.path, [[-18.25, 45, 0], [38.25, 45, 0]]);
    assert.deepEqual(followers.map((unit) => [unit.path[0][0] - leader.path[0][0], unit.path[0][2] - leader.path[0][2]]),
        [[-10, -12], [-10, 12], [-20, -24], [-20, 24]]);

    system.update(0.74);
    assert.equal(manager._projectileSystem.projectiles.length, 0);
    system.update(0.01);
    const released = manager._projectileSystem.projectiles.length;
    assert.ok(released >= 1, 'the leader releases its first real projectile once its cadence is up');
    assert.equal(leader.bombsFired, 1);
    assert.ok(manager._projectileSystem.projectiles.every((projectile) => projectile.type === 'BOMBER_BOMB'
        && projectile.mesh?.visible && projectile.gravity < 0 && projectile.blastDamage === 50
        && projectile.blastRadius === 15));
    assert.equal(system.units.reduce((sum, unit) => sum + unit.bombsFired, 0), released);
    manager._projectileSystem.update(2);
    assert.equal(caller.hp, 100);
    assert.ok(enemy.hp < 100, 'the leading bomb damages only when it reaches the target after falling');
});

test('ordinary map bombers retain custom damage and scale their blast radius with the unit', () => {
    const { manager, system, caller } = createWorld();
    let spawned;
    manager._projectileSystem.spawnBomberBomb = (...args) => { spawned = args; return {}; };
    const unit = {
        definition: { weapons: { bomb: { damage: 37, cooldown: 1.5, radius: 9 } } },
        bombCooldownRemaining: 0, bombsFired: 0, fromIndex: 0, toIndex: 1,
        path: [[0, 20, 0], [100, 20, 0]], speed: 30, scale: 2,
        position: new THREE.Vector3(4, 20, 2), attackSourcePlayer: caller,
    };
    updateBomberBombs(system, unit, 0, true);
    assert.equal(spawned[0], caller);
    assert.equal(spawned[3].damage, 37);
    assert.equal(spawned[3].blastRadius, 18);
    assert.equal(unit.bombsFired, 1);
});

test('a late client creates all five summoned bombers and never drops authoritative bombs', () => {
    const host = createWorld();
    const client = createWorld();
    applyPlayerPowerup(host.caller, 'BOMBER_STRIKE');
    host.system.update(0.5);

    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.system.units.length, 5);
    assert.equal(client.system.units.every((unit) => unit.summoned), true);
    const enemyHp = client.enemy.hp;
    client.system.update(2);
    assert.equal(client.enemy.hp, enemyHp);
});

test('late projectile snapshots restore visible bombs and preserve host-only damage', () => {
    const host = createWorld();
    const client = createWorld();
    host.enemy.position.set(61, 0, 0);
    assert.equal(host.system.callBomberStrike(host.caller), true);
    host.system.update(0.75);
    host.manager.projectiles = host.manager._projectileSystem.projectiles;
    const snapshot = createGameStateSnapshot(host.manager, { frame: 1 });
    const released = host.manager._projectileSystem.projectiles.length;
    assert.ok(released >= 1);
    assert.equal(snapshot.projectiles.length, released);
    assert.ok(snapshot.projectiles.every((entry) => entry.type === 'BOMBER_BOMB'
        && entry.blastDamage === 50 && entry.blastRadius === 15 && entry.gravity < 0));

    client.manager._projectileSystem.applyNetworkSnapshot(snapshot.projectiles, client.manager.players);
    assert.equal(client.manager._projectileSystem.projectiles.length, released);
    assert.ok(client.manager._projectileSystem.projectiles.every((entry) => entry.mesh.visible));
    const enemyHp = client.enemy.hp;
    client.manager._projectileSystem.update(3);
    assert.equal(client.enemy.hp, enemyHp, 'the replica animates falling bombs without resolving damage');
});

test('dropped bombs survive owner cleanup and the full projectile reset removes them', () => {
    const { manager, caller } = createWorld();
    const bomb = manager._projectileSystem.spawnBomberBomb(
        caller, new THREE.Vector3(0, 20, 0), new THREE.Vector3(30, 0, 0),
    );
    manager._projectileSystem.clearForOwner(caller);
    assert.equal(manager._projectileSystem.projectiles.includes(bomb), true);
    manager._projectileSystem.clear();
    assert.equal(manager._projectileSystem.projectiles.length, 0);
});

test('the client retires a called bomber only on an explicit empty map-unit snapshot', () => {
    const host = createWorld();
    const client = createWorld();
    assert.equal(host.system.callBomberStrike(host.caller), true);
    const liveFight = createHuntNetworkState(host.manager);
    applyHuntNetworkState(client.manager, liveFight);
    const bomber = client.system.units.find((unit) => unit.summoned);
    assert.ok(bomber, 'the client creates the called bomber from the host snapshot');

    const detached = [];
    const explosions = [];
    const root = { userData: {} };
    bomber.root = root;
    bomber.crashing = true;
    client.manager.renderer = { removeFromScene: (removedRoot) => detached.push(removedRoot) };
    client.manager.particles = { spawnExplosion: (...args) => explosions.push(args) };

    applyHuntNetworkState(client.manager, { ...liveFight, mapUnits: undefined });
    assert.equal(client.system.units.includes(bomber), true, 'undefined is not an authoritative empty snapshot');
    const legacyFight = { ...liveFight };
    delete legacyFight.mapUnits;
    applyHuntNetworkState(client.manager, legacyFight);
    assert.equal(client.system.units.includes(bomber), true, 'a missing legacy field does not delete a live unit');

    applyHuntNetworkState(client.manager, { ...liveFight, mapUnits: null });
    assert.equal(client.system.units.includes(bomber), false, 'explicit null means the host has no map units');
    assert.equal(bomber.root, null, 'the stale client visual is detached');
    assert.deepEqual(detached, [root]);
    assert.equal(explosions.length, 1, 'the client plays the final crash effect when the terminal snapshot omits the bomber');
});
