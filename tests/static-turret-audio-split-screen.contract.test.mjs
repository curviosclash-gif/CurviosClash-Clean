import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';

function createPlayer(index) {
    return {
        index,
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

// Only the second human is close to the turret, so the tone depends on whether the
// system looks past the first local slot.
function createManager(session, player) {
    const audioCalls = [];
    return {
        audioCalls,
        renderer: null,
        gameModeStrategy: { modeType: 'HUNT' },
        runtimeConfig: { session },
        audio: { play: (type) => audioCalls.push(type) },
        arena: {
            currentMapDefinition: {
                staticTurrets: [{ id: 'mg', weapon: 'mg', pos: [0, 0, 0], range: 40, cooldown: 1, damage: 5 }],
            },
            checkCollisionFast: () => false,
        },
        players: [player],
        humanPlayers: [player],
        particles: null,
        _emitHuntDamageEvent: () => {},
    };
}

test('split screen player two hears the turret even without localHumanCount', () => {
    const player = createPlayer(1);
    const manager = createManager({ numHumans: 2 }, player);
    const system = new StaticTurretSystem(manager);

    assert.equal(system.startRound(), 1);
    system.update(0.25);

    assert.deepEqual(manager.audioCalls, ['MG_SHOOT']);
    system.dispose();
});

test('a remote player two stays silent on a network client', () => {
    const player = createPlayer(1);
    const manager = createManager({ networkEnabled: true, localHumanCount: 1, numHumans: 2 }, player);
    const system = new StaticTurretSystem(manager);

    assert.equal(system.startRound(), 1);
    system.update(0.25);

    assert.deepEqual(manager.audioCalls, []);
    system.dispose();
});
