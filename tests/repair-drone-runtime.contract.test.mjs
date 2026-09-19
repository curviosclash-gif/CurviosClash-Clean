import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { RepairDroneSystem } from '../src/entities/systems/RepairDroneSystem.js';

function createWorld() {
    const removed = [];
    const player = {
        index: 0,
        alive: true,
        hp: 50,
        maxHp: 100,
        position: new THREE.Vector3(4, 2, 8),
        quaternion: new THREE.Quaternion(),
        activeEffects: [{ type: 'REPAIR_DRONE', remaining: 20 }],
    };
    const nearTank = {
        kind: 'tank', alive: true, hp: 90, maxHp: 150,
        position: new THREE.Vector3(10, 2, 8),
    };
    const farTank = {
        kind: 'tank', alive: true, hp: 70, maxHp: 150,
        position: new THREE.Vector3(80, 2, 8),
    };
    const manager = {
        players: [player],
        renderer: {
            addToScene() {},
            removeFromScene(root) { removed.push(root); },
        },
        gameModeStrategy: {
            applyHealing(target, amount) {
                const before = target.hp;
                target.hp = Math.min(target.maxHp, target.hp + amount);
                return { healed: target.hp - before, hp: target.hp };
            },
        },
        _mapUnitSystem: { units: [nearTank, farTank] },
    };
    return { manager, player, nearTank, farTank, removed };
}

test('the repair drone follows its owner and heals only to normal maximum', () => {
    const { manager, player, nearTank, farTank } = createWorld();
    const system = new RepairDroneSystem(manager);

    system.update(1);

    assert.equal(system.drones.length, 1);
    const drone = system.drones[0];
    assert.equal(drone.ownerIndex, 0);
    assert.equal(drone.hp, 20);
    assert.equal(drone.position.distanceTo(player.position) <= 5, true, 'the drone stays beside its owner');
    assert.equal(player.hp, 53, 'the owner receives 3 HP per second');
    assert.equal(nearTank.hp, 95, 'a nearby escort tank receives 5 HP per second');
    assert.equal(farTank.hp, 70, 'distant tanks are not repaired');

    player.hp = 99;
    nearTank.hp = 149;
    system.update(1);
    assert.equal(player.hp, 100, 'healing never exceeds the normal player maximum');
    assert.equal(nearTank.hp, 150, 'tank healing never exceeds its maximum');
});

test('the repair drone is targetable and destruction consumes its effect', () => {
    const { manager, player } = createWorld();
    const system = new RepairDroneSystem(manager);
    system.update(0);
    const drone = system.drones[0];

    assert.deepEqual(system.getTargets(), [drone]);
    assert.equal(drone.takeDamage(7).remainingHp, 13);
    assert.equal(drone.takeDamage(13).isDead, true);
    assert.deepEqual(system.getTargets(), []);
    assert.equal(player.activeEffects.some((effect) => effect.type === 'REPAIR_DRONE'), false);

    system.update(1);
    assert.equal(system.drones.length, 0, 'a shot-down drone does not return from the spent effect');
});

test('expiry, owner death and round cleanup leave no repair drone behind', () => {
    const { manager, player, removed } = createWorld();
    const system = new RepairDroneSystem(manager);
    system.update(0);

    player.activeEffects.length = 0;
    system.update(0);
    assert.equal(system.drones.length, 0, 'effect expiry removes the drone');

    player.activeEffects.push({ type: 'REPAIR_DRONE', remaining: 10 });
    system.update(0);
    player.alive = false;
    system.update(0);
    assert.equal(system.drones.length, 0, 'owner death removes the drone');
    assert.equal(player.activeEffects.length, 0, 'owner death consumes the stale effect');

    player.alive = true;
    player.activeEffects.push({ type: 'REPAIR_DRONE', remaining: 10 });
    system.update(0);
    system.clear();
    assert.equal(system.drones.length, 0, 'round restart clears the runtime list');
    assert.equal(removed.length >= 3, true, 'every created visual was detached');
});
