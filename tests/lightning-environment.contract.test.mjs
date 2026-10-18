import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { LightningStrikeSystem } from '../src/hunt/LightningStrikeSystem.js';

function world(heights = [10, 20, 30, 40, 50]) {
    const config = { ...CONFIG_BASE, HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' } };
    const kills = [], damage = [], notices = [], recorded = [];
    const players = heights.map((height, index) => ({
        index, alive: true, isBot: index > 0, hp: 100, maxHp: 100, shieldHP: 0,
        spawnProtectionTimer: 0, position: new THREE.Vector3(0, height, 0), entityRuntimeConfig: config,
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    }));
    const manager = { players, entityRuntimeConfig: config, gameModeStrategy: new HuntModeStrategy({ entityRuntimeConfig: config }),
        _simulationClockMs: 5000, _killPlayer(target, cause, options) { target.alive = false; kills.push({ target, cause, options }); },
        _emitHuntDamageEvent: event => damage.push(event), _notifyPlayerFeedback: (...args) => notices.push(args),
        recorder: { logEvent: (...args) => recorded.push(args) } };
    return { players, kills, damage, notices, recorded, system: new LightningStrikeSystem(manager) };
}

test('environmental warnings include the human and select the highest fifth only at impact', () => {
    const w = world();
    assert.equal(w.system.activate(null), false, 'item casts still require a real caster');
    assert.equal(w.system.activateEnvironment(), true);
    assert.equal(w.notices.length, 1);
    assert.deepEqual(w.system.getWarningState(), { remainingSeconds: 2, durationSeconds: 2, count: 1 });
    w.system.update(1.5); assert.ok(w.players.every(p => p.hp === 100));
    w.players[4].position.y = 0;
    w.system.update(0.5);
    assert.deepEqual(w.players.map(p => p.hp), [100, 100, 100, 65, 100]);
    assert.equal(w.damage[0].sourcePlayer, null);
    assert.equal(w.system.lastStrike.casterIndex, -1);
    assert.equal(w.recorded[0][1], -1);
});

test('an environmental kill has no shooter credit and preserves the 30 HP survival boundary', () => {
    for (const hp of [29, 30, 31]) {
        const w = world([100]); w.players[0].hp = hp;
        w.system.activateEnvironment(); w.system.update(2);
        assert.equal(w.players[0].hp, hp < 30 ? 0 : 1);
        assert.equal(w.kills.length, hp < 30 ? 1 : 0);
        if (w.kills.length) assert.equal(w.kills[0].options.killer, null);
    }
});

test('weather retains normal shield, protection, inactive-slot and living-player policies', () => {
    const w = world();
    w.players[4].spawnProtectionTimer = 1;
    w.players[3].alive = false;
    w.players[2].entitySlotActive = false;
    w.players[1].shieldHP = 40; w.players[1].hasShield = true;
    w.system.activateEnvironment(); w.system.update(2);
    assert.equal(w.players[1].hp, 100); assert.equal(w.players[1].shieldHP, 5);
    assert.deepEqual(w.system.lastStrike.targetIndices, [1]);
});

test('replicas cannot cast weather and a reset cancels pending environmental damage', () => {
    const w = world();
    w.system.setNetworkReplica(true);
    assert.equal(w.system.activateEnvironment(), false);
    w.system.setNetworkReplica(false);
    w.system.activateEnvironment(); w.system.reset(); w.system.update(5);
    assert.equal(w.system.getWarningState(), null);
    assert.ok(w.players.every(p => p.hp === 100));
    w.system.dispose(); w.system.dispose();
});

test('weather handles an empty arena without inventing an attacker or target', () => {
    const w = world([]); w.system.activateEnvironment(); w.system.update(2);
    assert.deepEqual(w.system.lastStrike.targetIndices, []);
    assert.deepEqual(w.kills, []);
});
