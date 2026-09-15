import test from 'node:test';
import assert from 'node:assert/strict';

import { MapDestructibleBlastSystem } from '../src/entities/systems/MapDestructibleBlastSystem.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';

/**
 * Stands in for EntityManager: only the two seams MapDestructibleBlastSystem actually touches
 * (the destructible definition/clock, and _applyModeDamage) - see EntityRuntimeSupportAssembly's
 * applyEnvironmentProjectileDamage for the same pattern with a real EntityManager.
 */
function createOwner(definition, elapsedSecondsBox) {
    const calls = [];
    const players = [
        { index: 0, alive: true, position: { x: 5, y: 0, z: 0 } }, // inside the 25m blast radius
        { index: 1, alive: true, position: { x: 50, y: 0, z: 0 } }, // outside the radius
        { index: 2, alive: false, position: { x: 5, y: 0, z: 0 } }, // dead already, never re-damaged
    ];
    const owner = {
        players,
        _mapDestructibleSystem: {
            anchorScale: 1,
            getDefinition: () => definition,
            getElapsedSeconds: () => elapsedSecondsBox.value,
        },
        _applyModeDamage(target, amount, cause, options) {
            calls.push({ target, amount, cause, options });
            return { isDead: false };
        },
    };
    return { owner, calls };
}

function createDefinitionWithBlast() {
    return normalizeMapDestructibles({
        segments: [{
            id: 'reactor_dome', kind: 'leg_lower', hp: 500, meshPrefixes: ['dome'], anchor: [0, 0, 0],
        }],
        breakScenes: [{
            id: 'mushroom_cloud',
            trigger: { segmentId: 'reactor_dome' },
            modelId: 'mushroom_cloud',
            blast: { radius: 25, damage: 80, delaySeconds: 3 },
        }],
    });
}

test('a break scene with a blast damages nearby alive players once its delay has elapsed', () => {
    const definition = createDefinitionWithBlast();
    const elapsedSecondsBox = { value: 10 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast(
        { segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 10, yaw: 0 },
        { sourcePlayer: null },
    );

    system.update();
    assert.equal(calls.length, 0, 'the blast is not applied before its delay has elapsed');

    elapsedSecondsBox.value = 13;
    system.update();
    assert.equal(calls.length, 1, 'the blast applies exactly once, to the player inside its radius');
    assert.equal(calls[0].target, owner.players[0]);
    assert.equal(calls[0].cause, 'BLAST');
    assert.ok(calls[0].amount > 0 && calls[0].amount <= 80, 'damage falls off from the 80 center value');

    system.update();
    assert.equal(calls.length, 1, 'an already-applied blast is never applied a second time');
});

test('a break scene without an authored blast schedules nothing', () => {
    const definition = normalizeMapDestructibles({
        segments: [{
            id: 'tower_leg', kind: 'leg_mid', hp: 300, meshPrefixes: ['leg'], anchor: [0, 0, 0],
        }],
        breakScenes: [{
            id: 'tower_fall',
            trigger: { segmentId: 'tower_leg' },
            modelId: 'tower_fall',
        }],
    });
    const elapsedSecondsBox = { value: 0 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast({ segmentId: 'tower_leg', kind: 'leg_mid', atSeconds: 0, yaw: 0 });
    elapsedSecondsBox.value = 100;
    system.update();

    assert.equal(calls.length, 0, 'a fall without an authored blast never damages anyone');
});
