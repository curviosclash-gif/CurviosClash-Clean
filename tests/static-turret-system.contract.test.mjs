import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';

function createTarget() {
    return {
        index: 0,
        isBot: false,
        alive: true,
        hp: 100,
        position: new THREE.Vector3(12, 0, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { applied: amount, hpApplied: amount, absorbedByShield: 0, remainingHp: this.hp, isDead: false };
        },
    };
}

test('StaticTurretSystem fires authored MG and rocket emplacements only in Hunt', () => {
    const target = createTarget();
    const rockets = [];
    const damageEvents = [];
    const manager = {
        renderer: null,
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [
                    { id: 'mg', weapon: 'mg', pos: [0, 0, 0], range: 40, cooldown: 1, damage: 5 },
                    { id: 'rocket', weapon: 'rocket', pos: [0, 0, 8], range: 50, cooldown: 3, rocketType: 'ROCKET_MEDIUM' },
                ],
            },
            checkCollisionFast: () => false,
        },
        humanPlayers: [target],
        particles: null,
        _projectileSystem: {
            spawnExternalProjectile: (options) => {
                rockets.push(options);
                return {};
            },
        },
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
    };
    const system = new StaticTurretSystem(manager);

    assert.equal(system.startRound(), 2);
    assert.deepEqual(system.turrets.map((entry) => entry.source.combatLabel), ['MG-Geschütz', 'Raketenwerfer']);
    system.update(0.25);

    assert.equal(target.hp, 95);
    assert.equal(damageEvents.length, 1);
    assert.equal(rockets.length, 1);
    assert.equal(rockets[0].type, 'ROCKET_MEDIUM');
    assert.equal(rockets[0].target, target);
    assert.deepEqual(system.turrets.map((entry) => entry.shotsFired), [1, 1]);

    system.dispose();
    assert.equal(system.turrets.length, 0);
});

test('StaticTurretSystem stays inactive outside Hunt', () => {
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'CLASSIC' },
        arena: { currentMapDefinition: { staticTurrets: [{ pos: [0, 0, 0] }] } },
    });

    assert.equal(system.startRound(), 0);
    system.dispose();
});

test('StaticTurretSystem skips a blocked near target and attacks the nearest visible target', () => {
    const blocked = createTarget();
    blocked.position.set(10, 0, 0);
    const visible = createTarget();
    visible.index = 1;
    visible.position.set(20, 0, 10);
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'mg', weapon: 'mg', pos: [0, 0, 0], range: 40, cooldown: 1, damage: 5 }],
            },
            checkCollisionFast(point) {
                return point.x >= 4.5 && point.x <= 5.5 && Math.abs(point.z) < 1;
            },
        },
        humanPlayers: [blocked, visible],
        _emitHuntDamageEvent() {},
    });

    system.startRound();
    system.update(0.25);

    assert.equal(blocked.hp, 100);
    assert.equal(visible.hp, 95);
    system.dispose();
});

test('StaticTurretSystem line-of-sight sampling detects thin walls at long range', () => {
    const target = createTarget();
    target.position.set(58, 0, 0);
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'mg', weapon: 'mg', pos: [0, 0, 0], range: 60, cooldown: 1, damage: 5 }],
            },
            checkCollisionFast(point) {
                return point.x >= 2.45 && point.x <= 2.55;
            },
        },
        humanPlayers: [target],
    });

    system.startRound();
    system.update(0.1);

    assert.equal(target.hp, 100);
    assert.equal(system.turrets[0].shotsFired, 0);
    system.dispose();
});

test('StaticTurretSystem line-of-sight sampling also blocks targets closer than four units', () => {
    const target = createTarget();
    target.position.set(3, 0, 0);
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'close', weapon: 'mg', pos: [0, 0, 0], range: 10, cooldown: 1, damage: 5 }],
            },
            checkCollisionFast: (point) => point.x >= 1.4 && point.x <= 1.6,
        },
        humanPlayers: [target],
    });

    system.startRound();
    system.update(0.25);

    assert.equal(target.hp, 100);
    assert.equal(system.turrets[0].shotsFired, 0);
    system.dispose();
});

test('StaticTurretSystem does not deploy through a wall and throttles idle trail scans', () => {
    class CountingMap extends Map {
        get(key) {
            this.reads += 1;
            return super.get(key);
        }
    }
    const spatialGrid = new CountingMap();
    spatialGrid.reads = 0;
    const player = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        getAimDirection: (out) => out.set(-1, 0, 0),
    };
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: { checkCollisionFast: (point) => point.x > 1.2 && point.x < 2 },
        players: [player],
        _trailSpatialIndex: { gridSize: 10, spatialGrid },
    });

    const turret = system.deployForPlayer(player);
    assert.equal(turret.position.x, 0);
    for (let frame = 0; frame < 60; frame += 1) system.update(1 / 60);

    assert.ok(spatialGrid.reads < 2000, `expected throttled scans, received ${spatialGrid.reads}`);
    system.dispose();
});

test('StaticTurretSystem round-trips authoritative deployed turret state', () => {
    const player = { index: 0, alive: true, position: new THREE.Vector3(), color: 0x44aaff };
    const host = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        entityRuntimeConfig: { HUNT: { MG_TURRET: {} } },
        arena: { checkCollisionFast: () => false },
        players: [player],
    });
    const deployed = host.deployForPlayer(player);
    deployed.hp = 31;
    deployed.aimDirection.set(0, 0, 1);
    const snapshot = host.createNetworkSnapshot();

    const replica = new StaticTurretSystem({ renderer: null });
    replica.applyNetworkSnapshot(snapshot, [player]);

    assert.equal(replica.networkReplica, true);
    assert.equal(replica.turrets.length, 1);
    assert.equal(replica.turrets[0].id, deployed.id);
    assert.equal(replica.turrets[0].hp, 31);
    assert.deepEqual(replica.turrets[0].aimDirection.toArray(), [0, 0, 1]);
    replica.applyNetworkSnapshot([], [player]);
    assert.equal(replica.turrets.length, 0);
    host.dispose();
    replica.dispose();
});

test('StaticTurretSystem publishes smoothly turning aim before its acquisition delay can fire', () => {
    const target = createTarget();
    target.position.set(0, 0, 20);
    const system = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'turning', weapon: 'mg', pos: [0, 0, 0], range: 40, cooldown: 1, damage: 5 }],
            },
            checkCollisionFast: () => false,
        },
        humanPlayers: [target],
    });
    system.startRound();
    system.update(0.1);

    const snapshot = system.createNetworkSnapshot()[0];
    assert.equal(snapshot.shotsFired, 0);
    assert.ok(snapshot.aim[0] > 0);
    assert.ok(snapshot.aim[2] > 0);
    system.dispose();
});

test('StaticTurretSystem preserves rocket types and emits replica shot feedback once per counter advance', () => {
    const target = createTarget();
    const host = new StaticTurretSystem({
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'rocket', weapon: 'rocket', rocketType: 'ROCKET_MEDIUM', pos: [0, 0, 0], range: 40 }],
            },
            checkCollisionFast: () => false,
        },
        humanPlayers: [target],
    });
    host.startRound();
    const snapshot = host.createNetworkSnapshot();
    assert.equal(snapshot[0].rocketType, 'ROCKET_MEDIUM');

    const replica = new StaticTurretSystem({ renderer: null });
    let replicatedShots = 0;
    replica._playReplicatedShot = () => { replicatedShots += 1; };
    replica.applyNetworkSnapshot(snapshot);
    replica.applyNetworkSnapshot([{ ...snapshot[0], shotsFired: 1 }]);
    replica.applyNetworkSnapshot([{ ...snapshot[0], shotsFired: 1 }]);

    assert.equal(replica.turrets[0].rocketType, 'ROCKET_MEDIUM');
    assert.equal(replicatedShots, 1);
    host.dispose();
    replica.dispose();
});
