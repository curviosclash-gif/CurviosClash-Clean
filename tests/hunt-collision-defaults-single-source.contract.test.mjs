import assert from 'node:assert/strict';
import test from 'node:test';

import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { ARCADE_COLLISION_COOLDOWN, ARCADE_COLLISION_DAMAGE } from '../src/modes/ArcadeRunRulesOps.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { applyPlayerCrashDamage } from '../src/modes/HuntCollisionOps.js';

test('the entity fallback hunt table matches the shipped hunt defaults', () => {
    const fallback = DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT;
    assert.deepEqual({ ...fallback.COLLISION_DAMAGE }, { ...HUNT_CONFIG.COLLISION_DAMAGE });
    assert.deepEqual({ ...fallback.COLLISION_COOLDOWN }, { ...HUNT_CONFIG.COLLISION_COOLDOWN });
    for (const key of ['PLAYER_MAX_HP', 'SHIELD_MAX_HP', 'PLAYER_REGEN_DELAY', 'PLAYER_REGEN_PER_SECOND']) {
        assert.equal(fallback[key], HUNT_CONFIG[key], `${key} must not differ between the two default tables`);
    }
});

test('the arcade gauntlet keeps its own named collision values', () => {
    assert.deepEqual({ ...ARCADE_COLLISION_DAMAGE }, { WALL: 22, TRAIL: 34, PLAYER_CRASH: 40 });
    assert.deepEqual({ ...ARCADE_COLLISION_COOLDOWN }, { WALL: 0.6, PLAYER_CRASH: 0.5 });
    const gauntlet = new ArcadeModeStrategy({ runType: 'gauntlet' });
    assert.equal(gauntlet.resolveCollisionDamage('WALL'), ARCADE_COLLISION_DAMAGE.WALL);
    assert.equal(gauntlet.resolveCollisionDamage('TRAIL_OTHER'), ARCADE_COLLISION_DAMAGE.TRAIL);
    assert.equal(gauntlet.resolveCollisionDamage('PLAYER_CRASH'), ARCADE_COLLISION_DAMAGE.PLAYER_CRASH);
    assert.equal(gauntlet.resolveCollisionCooldown('WALL'), ARCADE_COLLISION_COOLDOWN.WALL);
    assert.equal(gauntlet.resolveCollisionCooldown('PLAYER_CRASH'), ARCADE_COLLISION_COOLDOWN.PLAYER_CRASH);
});

test('a crash bills both vehicles once, reports both hits and names the killer', () => {
    const events = [];
    const kills = [];
    const entityManager = {
        _emitHuntDamageEvent: (event) => events.push([event.target.id, event.sourcePlayer.id, event.cause, event.hitNormal]),
        _killPlayer: (target, cause, options) => kills.push([target.id, cause, options.killer.id]),
    };
    const makePlayer = (id, hp) => ({ id, hp, position: { id } });
    const player = makePlayer('a', 100);
    const other = makePlayer('b', 30);
    const normal = { x: 1 };
    const dealDamage = (target, amount) => {
        target.hp -= amount;
        return { isDead: target.hp <= 0 };
    };

    const playerDied = applyPlayerCrashDamage(player, other, normal, entityManager, { damage: 40, cooldown: 0.5, dealDamage });

    assert.equal(playerDied, false);
    assert.equal(player.hp, 60);
    assert.equal(other.hp, -10);
    assert.equal(player.crashDamageCooldown, 0.5);
    assert.equal(other.crashDamageCooldown, 0.5);
    assert.deepEqual(events, [['a', 'b', 'PLAYER_CRASH', normal], ['b', 'a', 'PLAYER_CRASH', normal]]);
    assert.deepEqual(kills, [['b', 'PLAYER_CRASH', 'a']]);
});
