import test from 'node:test';
import assert from 'node:assert/strict';

import { StateReconciler } from '../src/network/StateReconciler.js';
import { killPlayer } from '../src/entities/EntityPlayerDeathOps.js';

/**
 * Stands in for Player.js on a network replica: alive/hp/view mirror the real
 * fields killPlayer() touches, without pulling in the full Three.js-backed class.
 */
function createReplicaPlayer(index, alive = true) {
    return {
        index,
        alive,
        isBot: false,
        hp: alive ? 100 : 0,
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        inventory: [],
        rocketInventory: [],
        activeEffects: [],
        hasShield: false,
        shieldHP: 0,
        view: { setVisible(visible) { this.visible = visible; } },
        kill() {
            this.alive = false;
            this.hp = 0;
            this.view.setVisible(false);
        },
    };
}

/**
 * A replica's EntityManager only needs the fields killPlayer() touches without
 * optional chaining; everything else it reaches through `?.` and may stay absent.
 */
function createReplicaManager(player) {
    const explosions = [];
    const manager = {
        players: [player],
        particles: { spawnExplosion(_position, _color, options) { explosions.push(options); } },
        audio: { play() {} },
        _respawnSystem: { onPlayerDied() {} },
        _eventBus: { emitPlayerDied() {} },
        applyNetworkSnapshot() {},
    };
    manager._killPlayer = (targetPlayer, cause, options) => killPlayer(manager, targetPlayer, cause, options);
    return { manager, explosions };
}

function createReconciler() {
    return new StateReconciler({
        positionSnapThreshold: 0,
        rotationSnapThreshold: 0,
        velocitySnapThreshold: 0,
    });
}

test('a client replays the explosion for a remote death it could not simulate itself', () => {
    const player = createReplicaPlayer(1, true);
    const { manager, explosions } = createReplicaManager(player);
    const reconciler = createReconciler();

    // The host resolved a rocket hit that this replica never runs itself -
    // ProjectileSystem.update() skips resolveProjectileOutcome while networkReplica is set.
    reconciler.receiveServerState({
        state: {
            players: [{
                index: 1,
                alive: false,
                deathCause: 'PROJECTILE',
                deathProjectileType: 'ROCKET_HEAVY',
                pos: [1, 2, 3],
                rot: [0, 0, 0, 1],
                vel: [0, 0, 0],
            }],
        },
    });
    reconciler.reconcile([player], manager);

    assert.equal(player.alive, false, 'the player is marked dead');
    assert.equal(explosions.length, 1, 'the explosion presentation ran exactly once');
    assert.deepEqual(explosions[0], { cause: 'PROJECTILE', projectileType: 'ROCKET_HEAVY' });
});

test('a death the local simulation already resolved is not replayed a second time', () => {
    // e.g. this peer already ran _killPlayer itself for a locally detected WALL hit.
    const player = createReplicaPlayer(2, false);
    const { manager, explosions } = createReplicaManager(player);
    const reconciler = createReconciler();

    reconciler.receiveServerState({
        state: {
            players: [{
                index: 2,
                alive: false,
                deathCause: 'WALL',
                pos: [1, 2, 3],
                rot: [0, 0, 0, 1],
                vel: [0, 0, 0],
            }],
        },
    });
    reconciler.reconcile([player], manager);

    assert.equal(explosions.length, 0, 'a death already resolved locally is not replayed again');
});

test('a respawn reported by the host makes the replica visible again without an explosion', () => {
    const player = createReplicaPlayer(3, false);
    const { manager, explosions } = createReplicaManager(player);
    const reconciler = createReconciler();

    reconciler.receiveServerState({
        state: {
            players: [{
                index: 3,
                alive: true,
                pos: [4, 5, 6],
                rot: [0, 0, 0, 1],
                vel: [0, 0, 0],
            }],
        },
    });
    reconciler.reconcile([player], manager);

    assert.equal(player.alive, true, 'the player is marked alive again');
    assert.equal(player.view.visible, true, 'the view becomes visible again');
    assert.equal(explosions.length, 0, 'a respawn never triggers an explosion');
});
