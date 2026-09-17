import test from 'node:test';
import assert from 'node:assert/strict';

import { MapDestructibleBlastSystem } from '../src/entities/systems/MapDestructibleBlastSystem.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { EntityManager } from '../src/entities/EntityManager.js';

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

test('a target exactly at the blast radius takes no minimum damage', () => {
    const definition = createDefinitionWithBlast();
    const elapsedSecondsBox = { value: 10 };
    const { owner, calls } = createOwner(definition, elapsedSecondsBox);
    const edge = { index: 3, alive: true, position: { x: 25, y: 0, z: 0 } };
    owner.players.push(edge);
    const system = new MapDestructibleBlastSystem(owner);

    system.schedulePendingBlast({ segmentId: 'reactor_dome', kind: 'leg_lower', atSeconds: 10, yaw: 0 });
    elapsedSecondsBox.value = 13;
    system.update();

    assert.equal(calls.some((call) => call.target === edge), false);
});

test('EntityManager preserves reactor feedback while its break callback schedules and applies the blast', () => {
    const definition = createDefinitionWithBlast();
    const manager = new EntityManager(null, null, null, null, null, null);
    const elapsed = { value: 10 };
    manager.arena = {
        currentMapKey: 'reactor_site',
        currentMapDefinition: { destructibles: definition },
        get glbAnimationElapsedSeconds() { return elapsed.value; },
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    manager.gameModeStrategy = { modeType: 'HUNT' };
    const target = { index: 0, alive: true, position: { x: 5, y: 0, z: 0 } };
    manager.players = [target];
    const damage = [];
    manager._applyModeDamage = (player, amount, cause) => {
        damage.push({ player, amount, cause });
        return { isDead: false };
    };

    manager._mapDestructibleSystem.startRound();
    manager._mapDestructibleSystem.applyMeshHit('dome', 500);
    elapsed.value = 13;
    manager._mapDestructibleBlastSystem.update();

    assert.deepEqual(damage, [{ player: target, amount: 64, cause: 'BLAST' }]);
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

test('a replicated break still reaches its callback but never schedules local blast damage', () => {
    const definition = createDefinitionWithBlast();
    const hostClock = { value: 10 };
    const { owner: hostOwner } = createOwner(definition, hostClock);
    hostOwner.arena = {
        currentMapDefinition: { destructibles: definition },
        glbAnimationElapsedSeconds: hostClock.value,
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    hostOwner.gameModeStrategy = { modeType: 'HUNT' };
    const host = new MapDestructibleSystem(hostOwner);
    host.startRound();
    host.applyMeshHit('dome', 500);

    const replicaClock = { value: 20 };
    const { owner: replicaOwner, calls } = createOwner(definition, replicaClock);
    replicaOwner.arena = {
        currentMapDefinition: { destructibles: definition },
        glbAnimationElapsedSeconds: replicaClock.value,
        resetMapDestructibleScenes() {},
        applyMapDestructibleEvents() {},
    };
    replicaOwner.gameModeStrategy = { modeType: 'HUNT' };
    const replica = new MapDestructibleSystem(replicaOwner);
    replicaOwner._mapDestructibleSystem = replica;
    const blast = new MapDestructibleBlastSystem(replicaOwner);
    let breakCallbacks = 0;
    replicaOwner.onMapDestructibleBreak = (event, context) => {
        breakCallbacks += 1;
        assert.equal(context.replicated, true);
        blast.schedulePendingBlast(event, context);
    };
    replica.startRound();
    replica.setNetworkReplica(true);
    replica.applyNetworkState(host.serializeNetworkState());
    blast.update();

    assert.equal(breakCallbacks, 1, 'the replica still presents the host break event');
    assert.equal(calls.length, 0, 'the replica never applies a damaging local blast');
});
