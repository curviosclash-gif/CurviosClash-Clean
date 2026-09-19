import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { RailgunSystem } from '../src/hunt/RailgunSystem.js';
import { applyPlayerPowerup, recomputePlayerEffectState } from '../src/entities/player/PlayerEffectOps.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createPlayer(index) {
    return {
        index, alive: true, isBot: false, hp: 100, position: new THREE.Vector3(0, 10, index * -40),
        quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [], inventory: [], rocketInventory: [], getAimDirection: (out) => out.set(0, 0, -1),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: false }; },
    };
}

function createSide(authority) {
    const shooter = createPlayer(0);
    const target = createPlayer(1);
    const manager = { huntEnabled: true, players: [shooter, target], isFightOutcomeAuthority: authority, entityRuntimeConfig: HUNT_MODE_CONFIG };
    shooter.entityManager = manager;
    target.entityManager = manager;
    const system = new RailgunSystem(manager);
    manager._railgunSystem = system;
    const beams = [];
    system._showBeam = (beam) => beams.push(beam.id);
    return { manager, shooter, target, system, beams };
}

test('shots and charge reach the replica so its item bar shows the same', () => {
    const host = createSide(true);
    applyPlayerPowerup(host.shooter, 'RAILGUN');
    host.system.fire(host.shooter, 0.6, true);
    const client = createSide(false);
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: { players: [serializePlayer(host.shooter)] } });
    reconciler.reconcile([client.shooter], client.manager);
    assert.equal(client.shooter.activeEffects[0].shots, 5);
    assert.ok(Math.abs(client.shooter.railCharge - 0.6) < 1e-9);
    recomputePlayerEffectState(client.shooter);
    assert.equal(client.shooter.hasRailgun, true, 'the replica derives the armed state from the shots');
});

test('the client draws each new host beam once and never shoots itself', () => {
    const host = createSide(true);
    const client = createSide(false);
    applyPlayerPowerup(host.shooter, 'RAILGUN');
    applyPlayerPowerup(client.shooter, 'RAILGUN');
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));

    client.system.fire(client.shooter, 1, true);
    assert.equal(client.system.fire(client.shooter, 0.016, false), false, 'a replica never fires');
    assert.equal(client.target.hp, 100);

    host.system.fire(host.shooter, 1, true);
    host.system.fire(host.shooter, 0.016, false);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(client.beams, [1], 'drawn once');
    assert.equal(client.target.hp, 100, 'the damage stays on the host');
    assert.ok(host.target.hp < 100);
});

test('Arcade railgun colors never enter the network snapshot', () => {
    const host = createSide(true);
    host.shooter.arcadeCosmeticLoadout = { weaponStyleIds: { railgun: 'nova' } };
    applyPlayerPowerup(host.shooter, 'RAILGUN');
    host.system.fire(host.shooter, 0.5, true);
    host.system.fire(host.shooter, 0.016, false);
    const beam = createHuntNetworkState(host.manager).railgunBeams[0];
    assert.deepEqual(Object.keys(beam).sort(), ['damage', 'from', 'id', 'ownerIndex', 'targetCount', 'to']);
});

test('a client joining after a shot does not redraw it', () => {
    const host = createSide(true);
    applyPlayerPowerup(host.shooter, 'RAILGUN');
    host.system.fire(host.shooter, 0.2, true);
    host.system.fire(host.shooter, 0.016, false);
    const late = createSide(false);
    applyHuntNetworkState(late.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(late.beams, []);
});

test('review fix: two beams between two snapshots are both drawn', () => {
    const host = createSide(true);
    const client = createSide(false);
    applyPlayerPowerup(host.shooter, 'RAILGUN');
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    for (let i = 0; i < 2; i += 1) {
        host.system.fire(host.shooter, 0.3, true);
        host.system.fire(host.shooter, 0.016, false);
    }
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.deepEqual(client.beams, [1, 2]);
});
