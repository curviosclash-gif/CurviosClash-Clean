import assert from 'node:assert/strict';
import test from 'node:test';

import { applyHit } from '../src/entities/combat/CombatPipeline.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { applyPlayerCrashDamage } from '../src/modes/HuntCollisionOps.js';

function createPlayer({ index, hp = 100, shieldHP = 0, spawnProtectionTimer = 0 } = {}) {
    return {
        index,
        hp,
        maxHp: 100,
        shieldHP,
        maxShieldHp: Math.max(40, shieldHP),
        hasShield: shieldHP > 0,
        alive: true,
        spawnProtectionTimer,
        position: { x: index || 0, y: 0, z: 0 },
        kill() { this.alive = false; this.hp = 0; },
    };
}

function createWorld(players) {
    const events = [];
    return {
        events,
        world: {
            players,
            gameModeStrategy: new HuntModeStrategy(),
            _emitHuntDamageEvent(event) { events.push(event); },
            _killPlayer(target) { target.kill(); },
        },
    };
}

test('spawn protection also keeps the shield against an exclusion zone rocket', () => {
    const target = createPlayer({ index: 1, shieldHP: 40, spawnProtectionTimer: 2 });
    const { world, events } = createWorld([target]);

    const result = applyHit(world, { target, amount: 30, cause: 'EXCLUSION_ZONE' });

    assert.equal(result.blocked, 'SPAWN_PROTECTION');
    assert.equal(target.hasShield, true, 'a fresh spawn keeps its shield');
    assert.equal(target.shieldHP, 40);
    assert.equal(events.length, 0);
});

test('an exclusion zone rocket still takes the shield of an unprotected player', () => {
    const target = createPlayer({ index: 1, shieldHP: 40 });
    const { world } = createWorld([target]);

    const result = applyHit(world, { target, amount: 30, cause: 'EXCLUSION_ZONE' });

    assert.equal(result.absorbedByShield, 1);
    assert.equal(target.hasShield, false);
    assert.equal(target.hp, 100);
});

test('a crash survives a side whose hit was rejected before the pipeline', () => {
    const player = createPlayer({ index: 0, hp: 100 });
    const other = createPlayer({ index: 1, hp: 100 });
    const entityManager = {
        // The pipeline answers null for a target that is no longer valid (e.g. died earlier this tick).
        _applyModeDamage(target, amount) {
            if (target === other) return null;
            target.hp -= amount;
            return { isDead: target.hp <= 0 };
        },
        _killPlayer() {},
    };

    assert.doesNotThrow(() => applyPlayerCrashDamage(player, other, null, entityManager, { damage: 20, cooldown: 0.5 }));
    assert.equal(player.hp, 80);
});
