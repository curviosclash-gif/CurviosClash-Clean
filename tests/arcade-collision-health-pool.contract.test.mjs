import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { applyDamage as healthSystemApplyDamage } from '../src/hunt/HealthSystem.js';

/**
 * Stands in for Player: takeDamage delegates to HealthSystem exactly like Player.js does.
 * That legacy path only knows Hunt and Classic, so in Arcade it reports an instant kill —
 * which is precisely what the arcade collision handlers must not rely on.
 */
function createPlayer(strategy, overrides = {}) {
    const player = {
        playerIndex: 0,
        index: 0,
        alive: true,
        isBot: false,
        hasShield: false,
        position: { x: 0, y: 0, z: 0 },
        baseSpeed: 18,
        speed: 18,
        wallDamageCooldown: 0,
        crashDamageCooldown: 0,
        takeDamage(amount, options = {}) {
            return healthSystemApplyDamage(this, amount, options);
        },
        ...overrides,
    };
    strategy.resetPlayerHealth(player);
    return player;
}

function createEntityManager() {
    const events = [];
    const kills = [];
    return {
        events,
        kills,
        _emitHuntDamageEvent(event) { events.push(event); },
        _killPlayer(player, cause) { kills.push({ index: player.index, cause }); player.alive = false; },
        _pushPlayerOutOfCollision() {},
        audio: null,
        particles: null,
        _tmpDir: { multiplyScalar() { return this; } },
    };
}

function createStrategy() {
    return new ArcadeModeStrategy({ random: () => 0.5 });
}

test('a wall hit costs health instead of ending the run at once', () => {
    const strategy = createStrategy();
    const player = createPlayer(strategy);
    const entityManager = createEntityManager();
    const maxHp = player.maxHp;
    assert.equal(maxHp, 100, 'the arcade player starts on the arcade health pool');

    const died = strategy.handleWallCollision(player, { normal: null }, entityManager);

    assert.equal(died, false, 'one wall hit does not end the run');
    assert.equal(player.hp, maxHp - strategy.resolveCollisionDamage('WALL'));
    assert.equal(entityManager.kills.length, 0);
    assert.equal(entityManager.events.length, 1, 'the hit still reports a damage event');
});

test('repeated wall hits do end the run once the pool is empty', () => {
    const strategy = createStrategy();
    const player = createPlayer(strategy);
    const entityManager = createEntityManager();
    const damage = strategy.resolveCollisionDamage('WALL');
    const expectedHits = Math.ceil(player.maxHp / damage);

    let hits = 0;
    let died = false;
    while (!died && hits < 50) {
        player.wallDamageCooldown = 0;
        died = strategy.handleWallCollision(player, { normal: null }, entityManager);
        hits += 1;
    }

    assert.equal(died, true);
    assert.equal(hits, expectedHits, `the pool lasts ${expectedHits} wall hits`);
    assert.equal(entityManager.kills.length, 1);
});

test('a trail hit costs its own damage value from the pool', () => {
    const strategy = createStrategy();
    const player = createPlayer(strategy);
    const entityManager = createEntityManager();

    const died = strategy.handleTrailCollision(player, null, 'TRAIL_OTHER', null, entityManager);

    assert.equal(died, false);
    assert.equal(player.hp, player.maxHp - strategy.resolveCollisionDamage('TRAIL'));
});

test('a head-on crash costs both pilots health without killing either outright', () => {
    const strategy = createStrategy();
    const entityManager = createEntityManager();
    const player = createPlayer(strategy, { index: 0, playerIndex: 0 });
    const other = createPlayer(strategy, { index: 1, playerIndex: 1 });

    const died = strategy.handlePlayerCrash(player, other, null, entityManager);

    assert.equal(died, false);
    const crashDamage = strategy.resolveCollisionDamage('PLAYER_CRASH');
    assert.equal(player.hp, player.maxHp - crashDamage);
    assert.equal(other.hp, other.maxHp - crashDamage);
    assert.equal(entityManager.kills.length, 0);
});

test('the shield absorbs a hit before the health pool is touched', () => {
    const strategy = createStrategy();
    const player = createPlayer(strategy, { hasShield: true });
    strategy.grantShield(player);
    const entityManager = createEntityManager();
    const hpBefore = player.hp;

    strategy.handleWallCollision(player, { normal: null }, entityManager);

    assert.equal(player.hp, hpBefore, 'the shield took the hit');
    assert.equal(player.shieldHP, 40 - strategy.resolveCollisionDamage('WALL'));
});

test('an upgraded health pool survives one wall hit more', () => {
    const plain = createStrategy();
    const plainPlayer = createPlayer(plain);

    const upgraded = createStrategy();
    upgraded.applyVehicleUpgrades({ turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 30 });
    const upgradedPlayer = createPlayer(upgraded);

    const damage = plain.resolveCollisionDamage('WALL');
    assert.equal(Math.ceil(plainPlayer.maxHp / damage), 5);
    assert.equal(Math.ceil(upgradedPlayer.maxHp / damage), 6, 'the core upgrade buys one more crash');
});
