import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import {
    getPickupDefinition,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
} from '../src/entities/PickupRegistry.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('MG turret pickup is a Hunt-only deployable inventory item', () => {
    const definition = getPickupDefinition('ITEM_TURRET');

    assert.equal(definition?.visualKind, 'turret');
    assert.equal(isPickupTypeAllowedForMode('MG_TURRET', 'HUNT'), true);
    assert.equal(isPickupTypeAllowedForMode('MG_TURRET', 'CLASSIC'), false);
    assert.equal(isPickupTypeSelfUsable('MG_TURRET', 'HUNT'), true);
    assert.equal(CONFIG_BASE.POWERUP.TYPES.MG_TURRET?.huntOnly, true);
});

test('using the MG turret pickup deploys and consumes it without adding a timed player effect', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    let deployedFor = null;
    const runtime = {
        services: { entityRuntimeConfig },
        callbacks: {
            getStrategy: () => ({ modeType: 'HUNT', hasMachineGun: () => true }),
            combat: {
                deployMgTurret(player) {
                    deployedFor = player;
                    return {};
                },
            },
        },
        get combat() {
            return this.callbacks.combat;
        },
    };
    const player = {
        inventory: ['MG_TURRET'],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 0,
        applyPowerup() {
            assert.fail('deployable turret must not become a player effect');
        },
    };
    const system = new HuntCombatSystem(runtime);

    const result = system.useInventoryItem(player, 0);

    assert.equal(result.ok, true);
    assert.equal(result.type, 'MG_TURRET');
    assert.equal(deployedFor, player);
    assert.deepEqual(player.inventory, []);
});

test('deployed MG turret prioritizes a nearer enemy trail, then attacks the enemy and expires', () => {
    const ownerPlayer = { index: 0, alive: true, position: new THREE.Vector3(0, 0, 0) };
    const enemy = {
        index: 1,
        alive: true,
        hp: 100,
        position: new THREE.Vector3(18, 0, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { applied: amount, hpApplied: amount, remainingHp: this.hp, isDead: false };
        },
    };
    const trailEntry = {
        playerIndex: 1,
        segmentIdx: 3,
        fromX: 5,
        fromY: 0,
        fromZ: 0,
        toX: 7,
        toY: 0,
        toZ: 0,
        destroyed: false,
    };
    const trailCell = new Set([trailEntry]);
    const spatialGrid = new Map([[(1000 * 2000) + 1000, trailCell]]);
    const trailHits = [];
    const damageEvents = [];
    const manager = {
        renderer: null,
        gameModeStrategy: { modeType: 'HUNT' },
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        arena: { checkCollisionFast: () => false },
        players: [ownerPlayer, enemy],
        humanPlayers: [ownerPlayer],
        _trailSpatialIndex: {
            gridSize: 10,
            spatialGrid,
            damageTrailSegment(entry, damage) {
                trailHits.push({ entry, damage });
                entry.destroyed = true;
                trailCell.delete(entry);
                return { hit: true, destroyed: true, remainingHp: 0 };
            },
        },
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
    };
    const system = new StaticTurretSystem(manager);

    const turret = system.deployForPlayer(ownerPlayer);
    assert.ok(turret);
    system.update(0.23);
    assert.equal(trailHits.length, 1);
    assert.equal(enemy.hp, 100);

    system.update(0.25);
    assert.equal(enemy.hp, 97);
    assert.equal(damageEvents[0]?.sourcePlayer, ownerPlayer);

    system.update(20);
    assert.equal(system.turrets.length, 0);
    system.dispose();
});

test('deployable turret enforces one per owner and can be destroyed', () => {
    const ownerPlayer = { index: 0, alive: true, position: new THREE.Vector3(), color: 0x44aaff };
    const events = [];
    const system = new StaticTurretSystem({
        renderer: null,
        gameModeStrategy: { modeType: 'HUNT' },
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        arena: { checkCollisionFast: () => false },
        players: [ownerPlayer],
        recorder: { logEvent: (...args) => events.push(args) },
    });

    const first = system.deployForPlayer(ownerPlayer);
    const second = system.deployForPlayer(ownerPlayer);

    assert.equal(system.turrets.length, 1);
    assert.notEqual(second.id, first.id);
    assert.equal(second.hp, 45);
    const result = system.damageTurret(second, 45, { sourcePlayer: { index: 1, isBot: true } });
    assert.equal(result.isDead, true);
    assert.equal(system.turrets.length, 0);
    assert.ok(events.some(([type]) => type === 'TURRET_DAMAGED'));
    assert.ok(events.some(([type]) => type === 'TURRET_DESTROYED'));
    system.dispose();
});

test('hand MG resolves an enemy deployable turret before targets behind it', () => {
    const attacker = {
        index: 0,
        isBot: false,
        position: new THREE.Vector3(),
        getAimDirection: (out) => out.set(1, 0, 0),
    };
    const turret = {
        deployed: true,
        ownerIndex: 1,
        hp: 45,
        hitboxRadius: 2,
        position: new THREE.Vector3(10, 0, 0),
    };
    let appliedDamage = 0;
    const resolver = new MGHitResolver({
        players: [attacker],
        combat: {
            getMgTurretTargets: () => [turret],
            damageMgTurret: (_turret, damage) => { appliedDamage = damage; },
        },
        getTrailSpatialIndex: () => null,
    });

    const hit = resolver.resolveHit(attacker, { RANGE: 50, DAMAGE: 10, MIN_FALLOFF: 0.5 });
    assert.equal(hit.turret, turret);
    assert.equal(hit.distance, 5.9);
    resolver.applyTurretHit(attacker, turret, hit.distance, { RANGE: 50, DAMAGE: 10, MIN_FALLOFF: 0.5 });
    assert.ok(appliedDamage > 9 && appliedDamage < 10);
});

test('bot MG aim can select an enemy deployable turret', () => {
    const bot = {
        index: 0,
        isBot: true,
        position: new THREE.Vector3(),
        getAimDirection: (out) => out.set(1, 0, 0),
    };
    const turret = {
        deployed: true,
        ownerIndex: 1,
        hp: 45,
        position: new THREE.Vector3(20, 0, 2),
    };
    const resolver = new MGHitResolver({
        players: [bot],
        combat: { getMgTurretTargets: () => [turret] },
    });
    const aim = resolver.resolveAimDirection(bot, new THREE.Vector3(), { RANGE: 50, AIM_DOT_MIN: 0.9 });

    assert.ok(aim.z > 0.09);
    assert.ok(aim.x > 0.99);
});

test('rocket sweep detonates on an enemy deployable turret', () => {
    let damage = 0;
    let impacts = 0;
    const turret = {
        deployed: true,
        ownerIndex: 1,
        hp: 45,
        hitboxRadius: 2,
        position: new THREE.Vector3(10, 0, 0),
        takeDamage: (amount) => { damage += amount; },
    };
    const system = {
        _tmpVec: new THREE.Vector3(),
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        getTurrets: () => [turret],
        onProjectileHit: () => { impacts += 1; },
    };
    const resolver = new ProjectileHitResolver(system);
    const projectile = {
        type: 'ROCKET_WEAK',
        owner: { index: 0 },
        radius: 0.5,
        previousPosition: new THREE.Vector3(5, 0, 0),
        position: new THREE.Vector3(11, 0, 0),
        mesh: { position: new THREE.Vector3() },
        detonated: false,
    };

    const hit = resolver.resolveProjectileOutcome(
        projectile,
        [],
        null,
        { projectileExpired: false, projectileHitArena: false, bouncedOnFoam: false }
    );

    assert.equal(hit, true);
    assert.equal(projectile.detonated, true);
    assert.equal(impacts, 1);
    assert.ok(damage > 0);
});
