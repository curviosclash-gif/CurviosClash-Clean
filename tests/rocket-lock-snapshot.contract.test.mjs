import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { RocketThreatTracker, ROCKET_THREAT_SOURCES } from '../src/entities/systems/projectile/RocketThreatTracker.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const STEP_SECONDS = 1 / 60;

function createRenderer() {
    const sceneObjects = new Set();
    return {
        sceneObjects,
        addToScene(object) { sceneObjects.add(object); },
        removeFromScene(object) { sceneObjects.delete(object); },
    };
}

function createPlayer({ index, position = [0, 0, 0], alive = true } = {}) {
    return {
        index,
        alive,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(),
        hitboxRadius: 0.8,
    };
}

/**
 * Stands for a live projectile on the host: only the fields the snapshot writer and
 * the threat tracker read. `owner` is a player object, a turret marker or null,
 * exactly like the real pooled state.
 */
function createHostRocket({
    id = 'projectile:1',
    type = 'ROCKET_WEAK',
    owner = null,
    position = [10, 0, 0],
    velocity = [-30, 0, 0],
    lockedPlayerIndex = -1,
    environmentProjectile = false,
    zoneProjectile = false,
} = {}) {
    return {
        traversalId: id,
        type,
        owner,
        lockedPlayerIndex,
        environmentProjectile,
        zoneProjectile,
        targetPlayerIndex: -1,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
        ttl: 4,
        radius: 0.5,
    };
}

function snapshotOf(projectiles, players) {
    return createGameStateSnapshot({ players, projectiles }, null);
}

function createReplica(players) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    return new ProjectileSystem({ renderer: createRenderer(), entityRuntimeConfig, players });
}

/** Moves the host projectiles by one frame, so host and replica compare at the same time. */
function stepHostProjectiles(projectiles, dt) {
    for (const projectile of projectiles) {
        projectile.position.addScaledVector(projectile.velocity, dt);
    }
}

test('a locked rocket carries its target player index into the snapshot', () => {
    const players = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const locked = createHostRocket({ id: 'projectile:locked', owner: players[0], lockedPlayerIndex: 1 });
    const loose = createHostRocket({ id: 'projectile:loose', owner: players[0], lockedPlayerIndex: -1 });
    const bullet = createHostRocket({ id: 'projectile:bullet', type: 'SPEED_UP', owner: players[0], lockedPlayerIndex: 1 });

    const snapshot = snapshotOf([locked, loose, bullet], players);
    const [lockedEntry, looseEntry, bulletEntry] = snapshot.projectiles;

    assert.equal(lockedEntry.lockedPlayerIndex, 1, 'a locked rocket tells the clients who it chases');
    assert.equal('lockedPlayerIndex' in looseEntry, false, 'a rocket without a lock stays out of the wire format');
    assert.equal('lockedPlayerIndex' in bulletEntry, false, 'only rocket tier projectiles can lock on');
});

test('only turret and zone rockets spend a byte on their threat source', () => {
    const players = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const playerRocket = createHostRocket({ id: 'projectile:player', owner: players[0], lockedPlayerIndex: 1 });
    const turretRocket = createHostRocket({
        id: 'projectile:turret',
        owner: { staticTurret: true },
        lockedPlayerIndex: 1,
    });
    const zoneRocket = createHostRocket({
        id: 'projectile:zone',
        owner: null,
        lockedPlayerIndex: 1,
        environmentProjectile: true,
        zoneProjectile: true,
    });

    const snapshot = snapshotOf([playerRocket, turretRocket, zoneRocket], players);
    const [playerEntry, turretEntry, zoneEntry] = snapshot.projectiles;

    assert.equal('threatSource' in playerEntry, false, 'a player rocket is the default source and needs no field');
    assert.equal(turretEntry.threatSource, ROCKET_THREAT_SOURCES.TURRET, 'a turret rocket keeps its source on the wire');
    assert.equal(zoneEntry.threatSource, ROCKET_THREAT_SOURCES.ZONE, 'a zone rocket keeps its source on the wire');
});

test('a replica takes over the lock and the threat source of an incoming rocket', () => {
    const players = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const turretRocket = createHostRocket({
        id: 'projectile:turret',
        owner: { staticTurret: true },
        lockedPlayerIndex: 1,
    });

    const snapshot = snapshotOf([turretRocket], players);
    const replicaPlayers = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const replica = createReplica(replicaPlayers);
    replica.applyNetworkSnapshot(snapshot.projectiles, replicaPlayers);

    const applied = replica.projectiles[0];
    assert.equal(applied.lockedPlayerIndex, 1, 'the replica knows who the rocket chases');
    assert.equal(applied.threatSource, ROCKET_THREAT_SOURCES.TURRET, 'the replica keeps the turret source');
    assert.equal(applied.owner, null, 'the turret itself is not a player, so the replica has no owner object');

    replica.dispose();
});

test('host and replica report the same rocket warning for the same frame', () => {
    const hostPlayers = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const hostRockets = [
        createHostRocket({ id: 'projectile:near', owner: { staticTurret: true }, position: [14, 0, 0], lockedPlayerIndex: 1 }),
        createHostRocket({ id: 'projectile:far', owner: hostPlayers[0], position: [40, 0, 0], lockedPlayerIndex: 1 }),
    ];

    const snapshot = snapshotOf(hostRockets, hostPlayers);

    const replicaPlayers = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const replica = createReplica(replicaPlayers);
    replica.applyNetworkSnapshot(snapshot.projectiles, replicaPlayers);
    replica.update(STEP_SECONDS);

    stepHostProjectiles(hostRockets, STEP_SECONDS);
    const hostTracker = new RocketThreatTracker({ entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE) });
    hostTracker.update(hostRockets, hostPlayers);

    const hostThreat = hostTracker.getThreat(1);
    const replicaThreat = replica.getRocketThreat(1);

    assert.equal(hostThreat.active, true, 'the host warns the chased player');
    assert.equal(replicaThreat.active, hostThreat.active, 'the replica warns the same player');
    assert.equal(replicaThreat.count, hostThreat.count, 'both count the same number of inbound rockets');
    assert.equal(replicaThreat.nearestSource, ROCKET_THREAT_SOURCES.TURRET, 'the nearest rocket is a turret rocket');
    assert.equal(replicaThreat.nearestSource, hostThreat.nearestSource, 'both name the same source');
    assert.equal(replicaThreat.nearestProjectileId, hostThreat.nearestProjectileId, 'both pick the same nearest rocket');
    assert.ok(
        Math.abs(replicaThreat.nearestDistance - hostThreat.nearestDistance) < 0.0001,
        'both measure the same distance'
    );

    replica.dispose();
});

test('a snapshot from an older host without the lock fields stays harmless', () => {
    const replicaPlayers = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const replica = createReplica(replicaPlayers);
    // Exactly the wire format before this change: no lockedPlayerIndex, no threatSource.
    replica.applyNetworkSnapshot([{
        id: 'projectile:legacy',
        pos: [14, 0, 0],
        vel: [-30, 0, 0],
        owner: 0,
        type: 'ROCKET_WEAK',
        ttl: 4,
        radius: 0.5,
    }], replicaPlayers);
    replica.update(STEP_SECONDS);

    assert.equal(replica.projectiles[0].lockedPlayerIndex, -1, 'a missing field means no lock, not undefined');
    assert.equal(replica.getRocketThreat(1).active, false, 'an old host never triggers a warning');

    replica.dispose();
});

test('the warning disappears as soon as the next snapshot drops the lock', () => {
    const players = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const rocket = createHostRocket({ id: 'projectile:turn', owner: players[0], position: [14, 0, 0], lockedPlayerIndex: 1 });

    const replicaPlayers = [createPlayer({ index: 0 }), createPlayer({ index: 1, position: [4, 0, 0] })];
    const replica = createReplica(replicaPlayers);
    replica.applyNetworkSnapshot(snapshotOf([rocket], players).projectiles, replicaPlayers);
    replica.update(STEP_SECONDS);
    assert.equal(replica.getRocketThreat(1).active, true, 'the locked rocket warns the replica player');

    rocket.lockedPlayerIndex = -1;
    replica.applyNetworkSnapshot(snapshotOf([rocket], players).projectiles, replicaPlayers);
    replica.update(STEP_SECONDS);
    assert.equal(replica.getRocketThreat(1).active, false, 'a dropped lock clears the warning again');
    assert.equal(replica.projectiles[0].lockedPlayerIndex, -1, 'the reused projectile state forgets the old lock');

    replica.dispose();
});
