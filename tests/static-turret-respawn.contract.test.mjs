import test from 'node:test';
import assert from 'node:assert/strict';

import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { migrateMapDocument } from '../src/entities/MapSchema.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';

/**
 * Stands for the renderer: the system only ever adds a turret root to the scene and removes it
 * again, so the set of added roots answers the one question a player would ask - does the guard
 * stand there again?
 */
function createRenderer() {
    const inScene = new Set();
    return {
        inScene,
        addToScene(object) { inScene.add(object); },
        removeFromScene(object) { inScene.delete(object); },
    };
}

/**
 * A map with a single authored guard. No human players, so the turret never fires and the only
 * thing the tick has to do is count down the respawn.
 */
function createSystem(respawnSeconds) {
    const renderer = createRenderer();
    const authored = {
        id: 'guard',
        weapon: 'mg',
        pos: [0, 0, 0],
        range: 40,
        cooldown: 1,
        damage: 5,
        destructible: true,
        maxHp: 45,
    };
    if (respawnSeconds !== undefined) authored.respawnSeconds = respawnSeconds;
    const system = new StaticTurretSystem({
        renderer,
        gameModeStrategy: { modeType: 'HUNT' },
        arena: {
            currentMapDefinition: { staticTurrets: [authored] },
            checkCollisionFast: () => false,
        },
        humanPlayers: [],
    });
    system.startRound();
    return { system, renderer };
}

function destroyTurret(system) {
    const turret = system.turrets[0];
    system.damageTurret(turret, turret.maxHp, { cause: 'TEST' });
    return turret;
}

function step(system, seconds, fps = 60) {
    const dt = 1 / fps;
    const frames = Math.round(seconds * fps);
    for (let frame = 0; frame < frames; frame += 1) system.update(dt);
}

test('the map schema keeps respawnSeconds and forces an unusable value to zero', () => {
    assert.equal(normalizeStaticTurretDefinition({ pos: [0, 0, 0], respawnSeconds: 45 }).respawnSeconds, 45);
    assert.equal(normalizeStaticTurretDefinition({ pos: [0, 0, 0] }).respawnSeconds, 0);
    assert.equal(normalizeStaticTurretDefinition({ pos: [0, 0, 0], respawnSeconds: 'soon' }).respawnSeconds, 0);
    assert.equal(normalizeStaticTurretDefinition({ pos: [0, 0, 0], respawnSeconds: -5 }).respawnSeconds, 0);

    // What a map author writes down has to survive the way a saved map takes home again.
    const { map } = migrateMapDocument({
        schemaVersion: 3,
        arenaSize: { width: 200, height: 60, depth: 200 },
        staticTurrets: [{ id: 'guard', pos: [1, 2, 3], destructible: true, respawnSeconds: 45 }],
    });
    assert.equal(map.staticTurrets[0].respawnSeconds, 45, 'the schema round trip keeps the delay');
});

test('a destroyed turret without respawnSeconds stays destroyed', () => {
    const { system } = createSystem(undefined);
    destroyTurret(system);
    assert.equal(system.turrets.length, 0, 'the turret is gone right after it was destroyed');

    step(system, 120);

    assert.equal(system.turrets.length, 0, 'without the field a destroyed turret never returns');
    system.dispose();
});

test('a destroyed turret returns with full health after the authored delay', () => {
    const { system, renderer } = createSystem(45);
    const destroyed = destroyTurret(system);
    assert.equal(renderer.inScene.has(destroyed.root), false, 'the wreck left the scene');

    step(system, 44.9);
    assert.equal(system.turrets.length, 0, 'the guard is still gone shortly before its delay is up');

    step(system, 0.1);

    assert.equal(system.turrets.length, 1, 'the guard returned once the delay was up');
    const returned = system.turrets[0];
    assert.equal(returned.id, 'guard');
    assert.equal(returned.hp, returned.maxHp, 'it returns with full health');
    assert.equal(returned.destroyed !== true, true, 'it is not marked destroyed any more');
    assert.equal(renderer.inScene.has(returned.root), true, 'its mesh stands in the scene again');
    assert.equal(system.getDestructibleTargets().includes(returned), true, 'it can be shot at again');
    system.dispose();
});

test('the respawn delay measures the same second at 30, 60 and 144 frames per second', () => {
    for (const fps of [30, 60, 144]) {
        const { system } = createSystem(45);
        destroyTurret(system);

        step(system, 44, fps);
        assert.equal(system.turrets.length, 0, `still destroyed after 44 s at ${fps} fps`);

        step(system, 1, fps);
        assert.equal(system.turrets.length, 1, `back after 45 s at ${fps} fps`);
        system.dispose();
    }
});

test('a turret destroyed again starts a fresh delay', () => {
    const { system } = createSystem(45);
    destroyTurret(system);
    step(system, 45);
    assert.equal(system.turrets.length, 1);

    destroyTurret(system);
    step(system, 44.9);
    assert.equal(system.turrets.length, 0, 'the second destruction waits the full delay again');

    step(system, 0.1);
    assert.equal(system.turrets.length, 1, 'and the guard returns a second time');
    system.dispose();
});

test('a new round drops a pending respawn instead of spawning a second guard', () => {
    const { system } = createSystem(45);
    destroyTurret(system);
    step(system, 10);

    assert.equal(system.startRound(), 1, 'the round starts with the authored guard');
    step(system, 60);

    assert.equal(system.turrets.length, 1, 'the leftover countdown did not add another guard');
    system.dispose();
});

test('a replica neither counts a respawn down nor revives a turret on its own', () => {
    const { system: host } = createSystem(45);
    const destroyed = destroyTurret(host);
    assert.equal(destroyed.hp, 0);

    const replica = new StaticTurretSystem({ renderer: createRenderer() });
    replica.applyNetworkSnapshot(host.createNetworkSnapshot(), []);
    assert.equal(replica.turrets.length, 0, 'the host snapshot no longer carries the wreck');

    step(replica, 120);
    assert.equal(replica.turrets.length, 0, 'the replica never revives a turret by itself');

    step(host, 45);
    replica.applyNetworkSnapshot(host.createNetworkSnapshot(), []);

    assert.equal(replica.turrets.length, 1, 'the replica follows the host back');
    assert.equal(replica.turrets[0].id, 'guard');
    assert.equal(replica.turrets[0].hp, replica.turrets[0].maxHp, 'and shows it at full health');
    host.dispose();
    replica.dispose();
});
