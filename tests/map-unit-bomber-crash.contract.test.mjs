import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const BOMBER = {
    id: 'crash_bomber', kind: 'bomber', path: [[0, 30, 0], [90, 30, 0]], speed: 30,
    weapons: { bomb: false }, crash: { damage: 50, radius: 20 }, respawnSeconds: 90,
};

function createWorld() {
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
    const manager = {
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits: [BOMBER] } },
        players: [player], humanPlayers: [player],
        powerupManager: { spawnAtAnchor: (entry) => loot.push(entry) },
        _huntScoring: { registerUnitDestroyed: (index, kind) => scored.push({ index, kind }) },
        particles: { spawnExplosion: (position) => explosions.push(position.clone()), spawnHit() {} },
        _emitHuntDamageEvent() {}, _killPlayer() {}, _notifyPlayerFeedback() {},
    };
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, bomber: system.units[0], player, loot, scored, explosions };
}

test('a destroyed bomber falls before impact damage, loot and credit', () => {
    const { system, bomber, player, loot, scored, explosions } = createWorld();
    const shooter = { index: 3, isBot: false };

    bomber.takeDamage(999, { sourcePlayer: shooter, cause: 'ROCKET_HEAVY' });
    assert.equal(bomber.crashing, true);
    assert.equal(player.hp, 100, 'destruction in the air deals no immediate damage');
    assert.equal(loot.length, 0);
    assert.equal(scored.length, 0);
    assert.equal(explosions.length, 0);

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
