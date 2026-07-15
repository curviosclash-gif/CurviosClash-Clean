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
    system.update(0.1);

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
