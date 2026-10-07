import assert from 'node:assert/strict';
import test from 'node:test';

import { applyHeal, applyHit } from '../src/entities/combat/CombatPipeline.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { normalizeCombatHealInput, normalizeCombatHitInput } from '../src/shared/contracts/CombatHitContract.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';

function createPlayer({ index, teamId, hp = 100, shieldHP = 0, alive = true, spawnProtectionTimer = 0 } = {}) {
    return {
        index,
        teamId,
        hp,
        maxHp: 100,
        shieldHP,
        maxShieldHp: Math.max(40, shieldHP),
        hasShield: shieldHP > 0,
        alive,
        spawnProtectionTimer,
        position: { x: index || 0, y: 0, z: 0 },
        kill() { this.alive = false; this.hp = 0; },
    };
}

function createWorld(strategy, players) {
    const events = [];
    const kills = [];
    const scoring = new HuntScoring(() => 12);
    const world = {
        players,
        gameModeStrategy: strategy,
        _huntScoring: scoring,
        _emitHuntDamageEvent(event) {
            events.push(event);
            scoring.registerDamage(event.sourcePlayer, event.target, event.damageResult, 12);
        },
        _killPlayer(target, cause, options) {
            kills.push({ target, cause, options });
            target.kill();
            scoring.registerElimination(target, { killer: options.killer, spawnAgeSeconds: 100 });
        },
    };
    return { world, events, kills, scoring };
}

test('combat input contracts normalize optional metadata and reject invalid hits/heals', () => {
    const target = createPlayer({ index: 1 });
    assert.deepEqual(normalizeCombatHitInput({ target, amount: '3', cause: 'PROJECTILE' }), {
        target,
        amount: 3,
        cause: 'PROJECTILE',
        weaponKind: null,
        sourcePlayer: null,
        impactPoint: null,
        hitNormal: null,
        projectileType: null,
        emitDamageEvent: true,
    });
    assert.equal(normalizeCombatHitInput({ target, amount: -1 }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: Infinity }), null);
    assert.equal(normalizeCombatHitInput({ amount: 1 }), null);
    assert.equal(normalizeCombatHealInput({ target, amount: 4 }).amount, 4);
    assert.equal(normalizeCombatHealInput({ target, amount: NaN }), null);
});

test('team blocks, spawn protection, dead targets, and zero damage publish no events or kills', () => {
    const teammate = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const cases = [
        { target: createPlayer({ index: 1, teamId: TEAM_IDS.ALPHA }), hit: { cause: 'PROJECTILE', weaponKind: 'ROCKET' }, blocked: 'TEAM' },
        { target: createPlayer({ index: 1, spawnProtectionTimer: 2 }), hit: { cause: 'BLAST' }, blocked: 'SPAWN_PROTECTION' },
        { target: createPlayer({ index: 1, alive: false, hp: 0 }), hit: { cause: 'BLAST' }, blocked: 'DEAD' },
    ];
    for (const entry of cases) {
        const harness = createWorld(new HuntModeStrategy(), [teammate, entry.target]);
        const result = applyHit(harness.world, { target: entry.target, amount: 30, sourcePlayer: teammate, ...entry.hit });
        assert.equal(result.blocked, entry.blocked);
        assert.equal(harness.events.length, 0);
        assert.equal(harness.kills.length, 0);
    }

    const target = createPlayer({ index: 1 });
    const harness = createWorld(new HuntModeStrategy(), [teammate, target]);
    const zeroResult = applyHit(harness.world, { target, amount: 0, sourcePlayer: teammate, weaponKind: 'ROCKET' });
    assert.equal(zeroResult.blocked, null);
    assert.equal(zeroResult.applied, 0);
    assert.equal(harness.events.length, 0);
    assert.equal(harness.kills.length, 0);
});

test('real Hunt, Classic, and Arcade strategies retain their own damage and shield rules', () => {
    const huntTarget = createPlayer({ index: 1, hp: 100, shieldHP: 20 });
    const huntStrategy = new HuntModeStrategy();
    let huntDamageCalls = 0;
    const applyHuntDamage = huntStrategy.applyDamage.bind(huntStrategy);
    huntStrategy.applyDamage = (...args) => {
        huntDamageCalls += 1;
        return applyHuntDamage(...args);
    };
    const hunt = createWorld(huntStrategy, [huntTarget]);
    const huntResult = applyHit(hunt.world, { target: huntTarget, amount: 30, cause: 'PROJECTILE' });
    assert.equal(huntDamageCalls, 1);
    assert.equal(huntResult.applied, 30);
    assert.equal(huntResult.absorbedByShield, 20);
    assert.equal(huntResult.hpApplied, 10);
    assert.equal(huntTarget.hp, 90);

    const classicTarget = createPlayer({ index: 1, hp: 1 });
    const classic = createWorld(new ClassicModeStrategy(), [classicTarget]);
    const classicResult = applyHit(classic.world, { target: classicTarget, amount: 25, cause: 'PROJECTILE' });
    assert.equal(classicResult.applied, 25);
    assert.equal(classicResult.hpApplied, 1);
    assert.equal(classicResult.isDead, true);
    assert.equal(classic.kills.length, 1);

    const arcadeTarget = createPlayer({ index: 1, hp: 100, shieldHP: 5 });
    const arcadeStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    arcadeStrategy._sdActive = true;
    arcadeStrategy._sdDamageMultiplier = 2;
    const arcade = createWorld(arcadeStrategy, [arcadeTarget]);
    const arcadeResult = applyHit(arcade.world, { target: arcadeTarget, amount: 10, cause: 'PROJECTILE' });
    assert.equal(arcadeResult.applied, 20);
    assert.equal(arcadeResult.absorbedByShield, 5);
    assert.equal(arcadeResult.hpApplied, 15);
    assert.equal(arcadeTarget.hp, 85);
});

test('overkill reports the real HP delta and scoring does not award excess damage', () => {
    const attacker = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const target = createPlayer({ index: 1, teamId: TEAM_IDS.BRAVO, hp: 10 });
    const harness = createWorld(new HuntModeStrategy(), [attacker, target]);
    const result = applyHit(harness.world, {
        target, amount: 50, cause: 'PROJECTILE', weaponKind: 'ROCKET', sourcePlayer: attacker,
    });
    assert.equal(result.applied, 50);
    assert.equal(result.hpApplied, 10);
    assert.equal(result.remainingHp, 0);
    assert.equal(harness.scoring.getScoreboard([attacker, target])[0].damage, 10);
});

test('a lethal enemy hit emits one metadata-rich damage event and grants one kill', () => {
    const attacker = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const target = createPlayer({ index: 1, teamId: TEAM_IDS.BRAVO, hp: 12 });
    const harness = createWorld(new HuntModeStrategy(), [attacker, target]);
    const impactPoint = { x: 3, y: 4, z: 5 };
    const result = applyHit(harness.world, {
        target,
        amount: 20,
        cause: 'PROJECTILE',
        weaponKind: 'ROCKET',
        sourcePlayer: attacker,
        impactPoint,
        projectileType: 'ROCKET_HEAVY',
    });
    assert.equal(result.isDead, true);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.events[0].projectileType, 'ROCKET_HEAVY');
    assert.equal(harness.events[0].impactPoint, impactPoint);
    assert.equal(harness.kills.length, 1);
    assert.equal(harness.kills[0].options.killer, attacker);
    assert.equal(harness.scoring.getScoreboard([attacker, target])[0].kills, 1);
});

test('team crash damage is applied but teammate death has no killer credit', () => {
    const teammate = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const target = createPlayer({ index: 1, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const harness = createWorld(new HuntModeStrategy(), [teammate, target]);
    const result = applyHit(harness.world, {
        target, amount: 10, cause: 'PLAYER_CRASH', sourcePlayer: teammate,
    });
    assert.equal(result.hpApplied, 5);
    assert.equal(result.isDead, true);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.kills.length, 1);
    assert.equal(harness.kills[0].options.killer, null);
    const rows = harness.scoring.getScoreboard([teammate, target]);
    assert.equal(rows.find((row) => row.playerIndex === teammate.index).kills, 0);
    assert.equal(rows.find((row) => row.playerIndex === teammate.index).points, 0);
    assert.equal(rows.find((row) => row.playerIndex === target.index).deaths, 1);
});

test('healing caps at the active mode maximum, allows spawn-protected targets, and blocks dead targets', () => {
    const protectedTarget = createPlayer({ index: 1, hp: 95, spawnProtectionTimer: 3 });
    const hunt = createWorld(new HuntModeStrategy(), [protectedTarget]);
    assert.deepEqual(applyHeal(hunt.world, { target: protectedTarget, amount: 20 }), {
        healed: 5,
        hp: 100,
        blocked: null,
    });

    const deadTarget = createPlayer({ index: 2, hp: 0, alive: false });
    const blocked = applyHeal(hunt.world, { target: deadTarget, amount: 20 });
    assert.deepEqual(blocked, { healed: 0, hp: 0, blocked: 'DEAD' });

    const classicTarget = createPlayer({ index: 3, hp: 0.5 });
    const classic = createWorld(new ClassicModeStrategy(), [classicTarget]);
    assert.deepEqual(applyHeal(classic.world, { target: classicTarget, amount: 20 }), {
        healed: 1,
        hp: 1,
        blocked: null,
    });

    const arcadeTarget = createPlayer({ index: 4, hp: 50 });
    const arcadeStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    arcadeStrategy._sdActive = true;
    const arcade = createWorld(arcadeStrategy, [arcadeTarget]);
    assert.deepEqual(applyHeal(arcade.world, { target: arcadeTarget, amount: 20 }), {
        healed: 0,
        hp: 50,
        blocked: null,
    });
});

test('zero and null healing are no-ops before Classic, Hunt, or Arcade strategy delegation', () => {
    const classicTarget = createPlayer({ index: 1, hp: 0.5 });
    const classicStrategy = new ClassicModeStrategy();
    let classicCalls = 0;
    const applyClassicHealing = classicStrategy.applyHealing.bind(classicStrategy);
    classicStrategy.applyHealing = (...args) => {
        classicCalls += 1;
        return applyClassicHealing(...args);
    };
    const classic = createWorld(classicStrategy, [classicTarget]);
    const beforeClassic = { hp: classicTarget.hp, maxHp: classicTarget.maxHp };
    assert.deepEqual(applyHeal(classic.world, { target: classicTarget, amount: 0 }), {
        healed: 0,
        hp: beforeClassic.hp,
        blocked: null,
    });
    assert.deepEqual(applyHeal(classic.world, { target: classicTarget, amount: null }), {
        healed: 0,
        hp: beforeClassic.hp,
        blocked: null,
    });
    assert.deepEqual({ hp: classicTarget.hp, maxHp: classicTarget.maxHp }, beforeClassic);
    assert.equal(classicCalls, 0);

    for (const strategy of [new HuntModeStrategy(), new ArcadeModeStrategy({ runType: 'gauntlet' })]) {
        const target = createPlayer({ index: 2, hp: 50 });
        let calls = 0;
        const applyHealing = strategy.applyHealing.bind(strategy);
        strategy.applyHealing = (...args) => {
            calls += 1;
            return applyHealing(...args);
        };
        const harness = createWorld(strategy, [target]);
        assert.deepEqual(applyHeal(harness.world, { target, amount: 0 }), {
            healed: 0,
            hp: 50,
            blocked: null,
        });
        assert.equal(calls, 0);
    }
});

test('invulnerable targets block both hits and healing without side effects', () => {
    const attacker = createPlayer({ index: 0 });
    const target = { ...createPlayer({ index: 1 }), invulnerable: true };
    const harness = createWorld(new HuntModeStrategy(), [attacker, target]);
    assert.equal(applyHit(harness.world, { target, amount: 10, sourcePlayer: attacker }).blocked, 'INVULNERABLE');
    assert.deepEqual(applyHeal(harness.world, { target, amount: 10 }), { healed: 0, hp: 100, blocked: 'INVULNERABLE' });
    assert.equal(harness.events.length, 0);
    assert.equal(harness.kills.length, 0);
});

test('damage-event suppression keeps the hit and its death but emits no damage event', () => {
    const attacker = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const target = createPlayer({ index: 1, teamId: TEAM_IDS.BRAVO, hp: 5 });
    const harness = createWorld(new HuntModeStrategy(), [attacker, target]);
    const result = applyHit(harness.world, {
        target,
        amount: 10,
        sourcePlayer: attacker,
        cause: 'PROJECTILE',
        emitDamageEvent: false,
    });
    assert.equal(result.isDead, true);
    assert.equal(harness.events.length, 0);
    assert.equal(harness.kills.length, 1);
});
