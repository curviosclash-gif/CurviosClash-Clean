// Playtest 03.10.2026: a hunting Bomber Strike flew over every enemy for 30 seconds and dropped 64
// bombs, but none hurt anybody. Enemies fly 30-60 units up and keep moving; a bomb only exploded on
// direct contact or on the floor, and every release aimed at where the enemy was, not where it would
// be. Hunting bombs now lead a moving enemy and burst when they pass one inside the blast radius.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { shouldDropHuntingBomb } from '../src/entities/systems/map-units/BomberHuntOps.js';

const BOUNDS = { minX: -200, maxX: 200, minY: 0, maxY: 80, minZ: -200, maxZ: 200 };

function createPlayer(index, teamId, x, y, z) {
    return {
        index, teamId, alive: true, hp: 1e6, maxHp: 1e6, spawnProtectionTimer: 0, hitboxRadius: 1.5,
        damageTaken: 0,
        position: new THREE.Vector3(x, y, z),
        velocity: new THREE.Vector3(),
        takeDamage(amount) {
            this.hp -= amount;
            this.damageTaken += amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: false };
        },
    };
}

function createWorld(players) {
    const manager = {
        huntEnabled: true,
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            bounds: BOUNDS,
            currentMapDefinition: { mapUnits: [] },
            getCollisionInfo: (position) => (position.y <= 0 ? { hit: true, kind: 'floor' } : null),
            raycast: () => ({ hit: false }),
        },
        players, humanPlayers: players.slice(0, 1),
        particles: { spawnExplosion() {}, spawnHit() {} },
        _emitHuntDamageEvent() {}, _killPlayer() {}, _notifyPlayerFeedback() {},
    };
    manager._projectileSystem = new ProjectileSystem({
        getArena: () => manager.arena,
        getPlayers: () => manager.players,
        onProjectileHit: () => {},
        onProjectileDamage: () => {},
    });
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, manager };
}

// Enemies circle at flight height, as bots do in a Fight round.
function circling(index, centerX, centerZ, radius, height, speed, phase) {
    const enemy = createPlayer(index, 'BRAVO', 0, height, 0);
    const angularSpeed = speed / radius;
    enemy.fly = (time) => {
        const angle = phase + angularSpeed * time;
        enemy.position.set(centerX + Math.cos(angle) * radius, height, centerZ + Math.sin(angle) * radius);
        enemy.velocity.set(-Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
    };
    enemy.fly(0);
    return enemy;
}

test('a hunting strike hurts enemies that fly and keep moving', () => {
    const caller = createPlayer(0, 'ALPHA', -150, 20, 0);
    const enemies = [
        circling(1, 80, 80, 40, 35, 22, 0),
        circling(2, 80, -80, 50, 45, 20, 1.5),
        circling(3, -60, 90, 45, 30, 25, 3),
        circling(4, -60, -90, 35, 55, 20, 4.5),
    ];
    const { system, manager } = createWorld([caller, ...enemies]);
    assert.equal(system.callBomberStrike(caller), true);
    const step = 1 / 30;
    for (let time = 0; time < 30; time += step) {
        for (const enemy of enemies) enemy.fly(time);
        system.update(step);
        manager._projectileSystem.update(step);
    }
    const hurt = enemies.filter((enemy) => enemy.damageTaken > 0);
    assert.ok(hurt.length >= 2, `the strike damaged ${hurt.length} of 4 flying enemies (${enemies.map((e) => e.damageTaken).join(', ')})`);
    assert.equal(caller.damageTaken, 0, 'the caller is never hit by its own strike');
});

test('a hunting bomb leads a moving enemy instead of aiming at where it was', () => {
    const caller = createPlayer(0, 'ALPHA', -150, 20, 0);
    const enemy = createPlayer(1, 'BRAVO', 0, 30, 0);
    const { system } = createWorld([caller, enemy]);
    // The aircraft flies along +z at 30 units/s, 38 units above the enemy: a bomb falls about 1.8 s
    // and lands about 53 units ahead of the release point.
    const unit = { bomberHunt: { exiting: false }, attackSourcePlayer: caller, speed: 30, yaw: 0,
        position: new THREE.Vector3(0, 69, -53) };
    enemy.velocity.set(25, 0, 0);
    assert.equal(shouldDropHuntingBomb(system, unit, 15), false,
        'the enemy will be 45 units to the side when the bomb arrives, so nothing is dropped');
    enemy.position.x = -45;
    assert.equal(shouldDropHuntingBomb(system, unit, 15), true,
        'an enemy that flies into the impact point is bombed although it is not there yet');
});

test('a bomb of a fixed bomber still only bursts on contact or on the floor', () => {
    const caller = createPlayer(0, 'ALPHA', -150, 20, 0);
    const enemy = createPlayer(1, 'BRAVO', 8, 30, 0);
    const { manager } = createWorld([caller, enemy]);
    const bomb = manager._projectileSystem.spawnBomberBomb(caller,
        new THREE.Vector3(0, 40, 0), new THREE.Vector3(), { damage: 50, blastRadius: 15 });
    for (let index = 0; index < 30; index += 1) manager._projectileSystem.update(1 / 30);
    assert.ok(bomb.position.y < 30 || !manager._projectileSystem.projectiles.includes(bomb));
    assert.equal(enemy.damageTaken, 0, 'without a proximity fuse the bomb falls past an enemy 8 units aside');
});
