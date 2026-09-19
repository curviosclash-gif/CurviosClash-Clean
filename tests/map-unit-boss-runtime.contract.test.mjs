import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { rewardMapUnitDestruction } from '../src/entities/systems/map-units/MapUnitRewardOps.js';

const BOSS = Object.freeze({
    id: 'vault_boss',
    kind: 'boss',
    secretRoomId: 'vault',
    path: [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]],
    weapons: { mg: false, rocket: false },
});

function createManager() {
    const scene = new THREE.Scene();
    const room = { room: { id: 'vault' }, clockPaused: false };
    const spawned = [];
    const scored = [];
    const manager = {
        renderer: {
            addToScene: (object) => scene.add(object),
            removeFromScene: (object) => scene.remove(object),
        },
        arena: { currentMapDefinition: { mapUnits: [BOSS] } },
        gameModeStrategy: {
            modeType: 'HUNT',
            getPickupModeType: () => 'HUNT',
            runtimeRng: { next: () => 0 },
        },
        players: [],
        _secretRoomSystem: { getRooms: () => [room] },
        _targetableRegistry: { collect: () => [] },
        _huntScoring: { registerUnitDestroyed: (index, kind) => scored.push({ index, kind }) },
        powerupManager: { spawnAtAnchor: (anchor) => spawned.push(anchor) },
    };
    return { manager, room, scene, spawned, scored };
}

test('a living boss pauses its secret-room clock and death starts the twenty seconds', () => {
    const { manager, room } = createManager();
    const system = new MapUnitSystem(manager);

    system.startRound();
    assert.equal(room.clockPaused, true);
    system.units[0].takeDamage(9999, { sourcePlayer: { index: 0, isBot: false } });
    assert.equal(room.clockPaused, false);
});

test('the boss uses a visibly larger tank model', () => {
    const { manager } = createManager();
    const system = new MapUnitSystem(manager);
    system.startRound();

    assert.equal(system.units[0].root.scale.x, 1.6);
    assert.equal(system.units[0].root.scale.y, 1.6);
    assert.equal(system.units[0].root.scale.z, 1.6);
    system.dispose();
});

test('boss destruction drops three items including one guaranteed XL rocket', () => {
    const { manager, spawned, scored } = createManager();
    const system = { entityManager: manager };
    const unit = {
        id: 'vault_boss', deaths: 1, definition: {
            kind: 'boss', loot: { ROCKET_MEDIUM: 1 }, lootCount: 3, guaranteedLoot: ['ROCKET_MEGA'],
        },
        position: new THREE.Vector3(2, -8, 4),
        groundPosition: new THREE.Vector3(2, -10, 4),
    };

    rewardMapUnitDestruction(system, unit, { index: 0, isBot: false });

    assert.equal(spawned.length, 3);
    assert.equal(spawned[0].type, 'ROCKET_MEGA');
    assert.deepEqual(spawned.slice(1).map((entry) => entry.type), ['ROCKET_MEDIUM', 'ROCKET_MEDIUM']);
    assert.equal(new Set(spawned.map((entry) => entry.ownerId)).size, 3);
    assert.deepEqual(scored, [{ index: 0, kind: 'boss' }]);
});
