import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const BOMBER = {
    id: 'crash_bomber', kind: 'bomber', path: [[0, 30, 0], [90, 30, 0]], speed: 30,
    weapons: { bomb: false }, crash: { damage: 50, radius: 20 }, respawnSeconds: 90,
};

function createWorld({ scenarioId = null } = {}) {
    const player = {
        index: 0, alive: true, hp: 100, spawnProtectionTimer: 0,
        position: new THREE.Vector3(0, 0, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
    const loot = [];
    const scored = [];
    const explosions = [];
    const damageEvents = [];
    const killEvents = [];
    const arcadeEvents = [];
    const manager = {
        runtimeConfig: { arcade: { scenarioId } },
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits: [BOMBER] } },
        players: [player], humanPlayers: [player],
        powerupManager: { spawnAtAnchor: (entry) => loot.push(entry) },
        _huntScoring: { registerUnitDestroyed: (index, kind) => scored.push({ index, kind }) },
        particles: { spawnExplosion: (position) => explosions.push(position.clone()), spawnHit() {} },
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
        _killPlayer: (target, cause, options) => killEvents.push({ target, cause, options }),
        _notifyPlayerFeedback() {},
        onArcadeGameplayEvent: (event) => arcadeEvents.push(event),
        _projectileSystem: { spawnBomberBomb: () => ({}) },
    };
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, bomber: system.units[0], player, loot, scored, explosions, damageEvents, killEvents, arcadeEvents };
}

test('a destroyed bomber completes objectives at lethal damage and falls before impact damage, loot and credit', () => {
    const { system, bomber, player, loot, scored, explosions, arcadeEvents } = createWorld({ scenarioId: 'bomber_alarm' });
    const shooter = { index: 3, isBot: false };

    bomber.takeDamage(999, { sourcePlayer: shooter, cause: 'ROCKET_HEAVY' });
    assert.equal(bomber.crashing, true);
    assert.equal(player.hp, 100, 'destruction in the air deals no immediate damage');
    assert.equal(loot.length, 0);
    assert.equal(scored.length, 0);
    assert.equal(explosions.length, 0);
    assert.deepEqual(arcadeEvents, [{ type: 'unit_disabled', playerIndex: 3, count: 1, unitKind: 'bomber' }]);

    system.update(0.5);
    assert.equal(bomber.position.y > 0, true);
    assert.equal(player.hp, 100);
    system.update(2);

    assert.equal(bomber.crashing, false);
    assert.equal(bomber.alive, false);
    assert.equal(player.hp, 50, 'the fifty-damage blast happens on the ground');
    assert.equal(explosions.length, 1);
    assert.equal(loot.length, 1);
    assert.equal(loot[0].y, 0, 'loot stays at the impact point');
    assert.deepEqual(scored, [{ index: 3, kind: 'bomber' }]);
    assert.equal(arcadeEvents.length, 1, 'impact rewards do not count the same objective twice');
});

test('round restart cancels a falling bomber and restores it in the air', () => {
    const { system, bomber } = createWorld();
    bomber.takeDamage(999);
    system.startRound();
    const fresh = system.units[0];
    assert.equal(fresh.crashing, false);
    assert.equal(fresh.alive, true);
    assert.equal(fresh.position.y, 30);
});

test('bomber crashes outside Bomberalarm keep the normal destruction event until impact', () => {
    const { system, bomber, arcadeEvents } = createWorld();
    bomber.takeDamage(999, { sourcePlayer: { index: 3, isBot: false }, cause: 'ROCKET_HEAVY' });
    assert.deepEqual(arcadeEvents, []);
    system.update(2);
    assert.deepEqual(arcadeEvents, [{ type: 'unit_destroyed', playerIndex: 3, count: 1, unitKind: 'bomber' }]);
    system.dispose();
});

test('clients render the authoritative fall without simulating impact damage', () => {
    const host = createWorld();
    const client = createWorld();
    host.bomber.takeDamage(999);
    host.system.update(0.5);

    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.bomber.crashing, true);
    assert.equal(client.bomber.position.y, host.bomber.position.y);
    const replicatedHeight = client.bomber.position.y;
    client.system.update(5);
    assert.equal(client.bomber.position.y, replicatedHeight, 'the client waits for the next host snapshot');
    assert.equal(client.player.hp, 100);

    host.system.update(2);
    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.bomber.crashing, false);
    assert.equal(client.bomber.alive, false);
    assert.equal(client.explosions.length, 1);
    assert.equal(client.player.hp, 100, 'only the host applies crash damage');
});

test('a called bomber crash damages an enemy caller, spares teammates and protected players, and credits the enemy hit', () => {
    const { system, player: caller, damageEvents, killEvents } = createWorld();
    caller.teamId = 'BRAVO';
    caller.hp = 100;
    const ally = {
        index: 1, teamId: 'ALPHA', alive: true, hp: 100, spawnProtectionTimer: 0,
        position: new THREE.Vector3(2, 0, 0),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    };
    const enemy = {
        index: 2, teamId: 'BRAVO', alive: true, hp: 50, spawnProtectionTimer: 0,
        position: new THREE.Vector3(3, 0, 0),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    };
    const protectedEnemy = {
        index: 3, teamId: 'BRAVO', alive: true, hp: 100, spawnProtectionTimer: 1,
        position: new THREE.Vector3(4, 0, 0),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    };
    system.entityManager.players.push(ally, enemy, protectedEnemy);
    system.entityManager.arena.bounds = { minX: -30, maxX: 30, minY: 0, maxY: 50, minZ: -40, maxZ: 40 };

    assert.equal(system.callBomberStrike(caller), true);
    const calledBomber = system.units.find((unit) => unit.summoned);
    calledBomber.position.set(0, 30, 0);
    calledBomber.groundPosition.set(0, 0, 0);
    const shooter = { index: 4, teamId: 'ALPHA', isBot: false };
    calledBomber.takeDamage(999, { sourcePlayer: shooter, cause: 'ROCKET_HEAVY' });
    system.update(2);

    assert.equal(caller.hp, 50, 'caller identity does not grant immunity when the crash source is an enemy');
    assert.equal(ally.hp, 100, 'other teammates of the crash source are protected');
    assert.equal(enemy.hp, 0, 'the crash still damages and kills an enemy');
    assert.equal(protectedEnemy.hp, 100, 'spawn protection still blocks the crash');
    assert.equal(damageEvents.length, 2);
    assert.deepEqual(damageEvents.map(({ target }) => target), [caller, enemy]);
    assert.equal(damageEvents.every(({ sourcePlayer }) => sourcePlayer === shooter), true);
    assert.equal(damageEvents.every(({ cause }) => cause === 'BOMBER_CRASH'), true);
    assert.equal(killEvents.length, 1);
    assert.equal(killEvents[0].target, enemy);
    assert.equal(killEvents[0].options.killer, shooter);
});

for (const { label, teamId } of [
    { label: 'team mode', teamId: 'ALPHA' },
    { label: 'FFA', teamId: undefined },
]) {
    test(`a bomber crash can damage its own ${label} source without self kill credit`, () => {
        const { system, bomber, player, damageEvents, killEvents } = createWorld();
        if (teamId) player.teamId = teamId;
        player.hp = 50;
        bomber.position.set(0, 30, 0);
        bomber.takeDamage(999, { sourcePlayer: player, cause: 'ROCKET_HEAVY' });
        system.update(2);

        assert.equal(player.hp, 0, 'self damage remains part of the crash blast');
        assert.equal(damageEvents.length, 1);
        assert.equal(damageEvents[0].sourcePlayer, player);
        assert.equal(damageEvents[0].target, player);
        assert.equal(killEvents.length, 1);
        assert.equal(killEvents[0].target, player);
        assert.equal(killEvents[0].options.killer, null);
    });
}

test('an unteamed map bomber crash keeps FFA damage and source attribution', () => {
    const { system, bomber, player, damageEvents } = createWorld();
    const shooter = { index: 7, isBot: false };
    bomber.position.set(0, 30, 0);
    bomber.takeDamage(999, { sourcePlayer: shooter, cause: 'ROCKET_HEAVY' });
    system.update(2);

    assert.equal(player.hp, 50, 'unteamed FFA players still take the bomber crash');
    assert.equal(damageEvents[0].sourcePlayer, shooter);
    assert.equal(damageEvents[0].target, player);
});
