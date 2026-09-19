import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { LightningStrikeSystem } from '../src/hunt/LightningStrikeSystem.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createPlayers() {
    return [0, 1, 2].map((index) => ({
        index,
        alive: true,
        isBot: index === 1,
        hp: 100,
        shieldHP: 0,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(index * 10, 20 + index * 30, 0),
        taken: [],
        takeDamage(amount) { this.taken.push(amount); this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: false }; },
    }));
}

function createSide() {
    const players = createPlayers();
    const feedback = [];
    const strikes = [];
    const manager = {
        huntEnabled: true,
        players,
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        _notifyPlayerFeedback: (player, text) => feedback.push({ index: player.index, text }),
    };
    const system = new LightningStrikeSystem(manager);
    system._showStrike = (targets) => strikes.push(targets.map((player) => player.index));
    manager._lightningStrikeSystem = system;
    return { manager, system, players, feedback, strikes };
}

test('nothing is sent while nothing happens', () => {
    const host = createSide();
    assert.equal(createHuntNetworkState(host.manager).lightning, null);
});

test('clients mirror the warning, hear the message once and replay the strike without damage', () => {
    const host = createSide();
    const client = createSide();
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));

    host.system.activate(host.players[0]);
    host.system.update(0.5);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(client.system.getWarningState(), { remainingSeconds: 1.5, durationSeconds: 2, count: 1 });
    assert.deepEqual(client.feedback.map((entry) => entry.index), [0, 2], 'the humans on the client are warned');
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(client.feedback.length, 2, 'the same warning is announced only once');

    client.system.update(5);
    assert.equal(client.players.every((player) => player.taken.length === 0), true, 'a client never deals the strike');
    assert.notEqual(client.system.getWarningState(), null, 'the client waits for the host');

    host.system.update(2);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(client.system.getWarningState(), null, 'the warning left the client sky');
    assert.deepEqual(client.strikes, [[2]], 'the strike is replayed on the host target');
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(client.strikes, [[2]], 'and only once');
    assert.equal(client.players[2].taken.length, 0);
});

test('Arcade lightning colors never enter the network snapshot', () => {
    const host = createSide();
    host.players[0].arcadeCosmeticLoadout = { weaponStyleIds: { lightning: 'nova' } };
    host.system.activate(host.players[0]);
    const warning = createHuntNetworkState(host.manager).lightning.pending[0];
    assert.deepEqual(Object.keys(warning).sort(), ['duration', 'id', 'remaining']);
    host.system.update(2);
    const strike = createHuntNetworkState(host.manager).lightning.strikes[0];
    assert.deepEqual(Object.keys(strike).sort(), ['id', 'targetIndices']);
});

test('a client joining after a strike does not replay the old one', () => {
    const host = createSide();
    host.system.activate(host.players[0]);
    host.system.update(2);
    const late = createSide();
    applyHuntNetworkState(late.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(late.strikes, []);

    host.system.activate(host.players[0]);
    host.system.update(2);
    applyHuntNetworkState(late.manager, createHuntNetworkState(host.manager));
    assert.equal(late.strikes.length, 1, 'the next strike is shown');
});

test('review fix: two strikes between two snapshots are both shown', () => {
    const host = createSide();
    const client = createSide();
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    host.system.activate(host.players[0]);
    host.system.activate(host.players[1]);
    host.system.update(2);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(client.strikes.length, 2);
});

test('review fix: an instance that stops being a replica forgets the mirrored warnings', () => {
    const client = createSide();
    client.system.applyNetworkState({ pending: [{ id: 4, remaining: 1, duration: 2 }], strikes: [] });
    client.system.setNetworkReplica(false);
    assert.equal(client.system.getWarningState(), null);
    client.system.update(2);
    assert.equal(client.players.every((player) => player.taken.length === 0), true);
});
