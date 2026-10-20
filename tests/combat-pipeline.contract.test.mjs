import assert from 'node:assert/strict';
import test from 'node:test';

import { applyHeal, applyHit, finalizeHitDeath } from '../src/entities/combat/CombatPipeline.js';
import { Player } from '../src/entities/Player.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { normalizeCombatHealInput, normalizeCombatHitInput } from '../src/shared/contracts/CombatHitContract.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';

// Clockless callers keep the HealthSystem wall clock fallback (8a2a3b8d, user decision 12.10.).
function stubWallClockSeconds(t, seconds) {
    const originalNow = performance.now;
    const originalDateNow = Date.now;
    performance.now = () => seconds * 1000;
    Date.now = () => seconds * 1000;
    t.after(() => { performance.now = originalNow; Date.now = originalDateNow; });
}

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

function createPlayerFacade(entityManager = null, options = {}) {
    const player = Object.assign(Object.create(Player.prototype), createPlayer(options), {
        entityManager,
        entityRuntimeConfig: null,
        lastDamageTimestamp: -Infinity,
        kill() { this.alive = false; this.hp = 0; },
    });
    return player;
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
        selfDamagePolicy: null,
        deathCause: null,
        emitDamageEvent: true,
        killOnDeath: true,
        ignoreShield: false,
        nowSeconds: undefined,
        shieldContact: false,
    });
    assert.equal(normalizeCombatHitInput({ target, amount: -1 }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: Infinity }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, selfDamagePolicy: 'ALLOW_TEAM_DAMAGE' }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, selfDamagePolicy: true }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, deathCause: false }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, deathCause: ' ' }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, killOnDeath: 'false' }), null);
    assert.equal(normalizeCombatHitInput({ target, amount: 1, killOnDeath: null }), null);
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

test('static turret hits keep their event source and projectile death has no killer credit', () => {
    const turret = { index: -1, staticTurret: true };
    const target = createPlayer({ index: 1, hp: 5 });
    const harness = createWorld(new HuntModeStrategy(), [target]);
    const result = applyHit(harness.world, {
        target,
        amount: 10,
        sourcePlayer: turret,
        cause: 'ROCKET_HEAVY',
        weaponKind: 'ROCKET',
        projectileType: 'ROCKET_HEAVY',
        deathCause: 'PROJECTILE',
    });

    assert.equal(result.isDead, true);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.events[0].sourcePlayer, turret);
    assert.equal(harness.events[0].cause, 'ROCKET_HEAVY');
    assert.equal(harness.kills.length, 1);
    assert.equal(harness.kills[0].cause, 'PROJECTILE');
    assert.equal(harness.kills[0].options.killer, null);
});

test('deferred hit deaths reuse pipeline credit rules and finalize at most once', () => {
    const teammate = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const target = createPlayer({ index: 1, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const harness = createWorld(new HuntModeStrategy(), [teammate, target]);
    const hit = { target, amount: 10, cause: 'PLAYER_CRASH', sourcePlayer: teammate };

    const result = applyHit(harness.world, { ...hit, killOnDeath: false });
    assert.equal(result.hpApplied, 5);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.kills.length, 0, 'the caller can finish the second crash hit first');
    assert.equal(finalizeHitDeath(harness.world, hit, result), true);
    assert.equal(finalizeHitDeath(harness.world, hit, result), false);
    assert.equal(harness.kills.length, 1);
    assert.equal(harness.kills[0].options.killer, null);
    assert.equal(finalizeHitDeath(harness.world, { ...hit, amount: -1 }, result), false);
    assert.equal(finalizeHitDeath(harness.world, hit, {
        blocked: null, isDead: true, hpApplied: 0, absorbedByShield: 0,
    }), false);

    const enemy = createPlayer({ index: 2, teamId: TEAM_IDS.BRAVO, hp: 5 });
    const enemyHarness = createWorld(new HuntModeStrategy(), [teammate, enemy]);
    const enemyHit = { target: enemy, amount: 10, cause: 'PROJECTILE', sourcePlayer: teammate };
    const enemyResult = applyHit(enemyHarness.world, { ...enemyHit, killOnDeath: false });
    assert.equal(finalizeHitDeath(enemyHarness.world, enemyHit, enemyResult), true);
    assert.equal(enemyHarness.kills[0].options.killer, teammate);

    const blockedTarget = createPlayer({ index: 3, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const blockedHarness = createWorld(new HuntModeStrategy(), [teammate, blockedTarget]);
    const blockedHit = { target: blockedTarget, amount: 10, cause: 'PROJECTILE', sourcePlayer: teammate };
    const blockedResult = applyHit(blockedHarness.world, { ...blockedHit, killOnDeath: false });
    assert.equal(blockedResult.blocked, 'TEAM');
    assert.equal(finalizeHitDeath(blockedHarness.world, blockedHit, blockedResult), false);
    assert.equal(blockedHarness.kills.length, 0);
});

test('self blast policy applies only to the source and separates event from death cause', () => {
    const source = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const teammate = createPlayer({ index: 1, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const harness = createWorld(new HuntModeStrategy(), [source, teammate]);
    const hit = {
        amount: 10,
        cause: 'TANK_EXPLOSION',
        projectileType: 'TANK_EXPLOSION',
        sourcePlayer: source,
        selfDamagePolicy: 'ALLOW_WITHOUT_KILL_CREDIT',
        deathCause: 'PROJECTILE',
    };

    const selfResult = applyHit(harness.world, { ...hit, target: source });
    assert.equal(selfResult.isDead, true);
    assert.equal(harness.events.length, 1);
    assert.equal(harness.events[0].cause, 'TANK_EXPLOSION');
    assert.equal(harness.events[0].projectileType, 'TANK_EXPLOSION');
    assert.equal(harness.kills.length, 1);
    assert.equal(harness.kills[0].cause, 'PROJECTILE');
    assert.equal(harness.kills[0].options.killer, null);
    assert.equal(harness.kills[0].options.projectileType, 'TANK_EXPLOSION');

    const teammateResult = applyHit(harness.world, { ...hit, target: teammate });
    assert.equal(teammateResult.blocked, 'TEAM');
    assert.equal(harness.events.length, 1, 'blocked teammate damage emits nothing');
    assert.equal(harness.kills.length, 1, 'blocked teammate damage creates no death');
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

test('legacy Player damage delegates mode math once and leaves event/death publication to its caller', (t) => {
    stubWallClockSeconds(t, 7);
    const huntStrategy = new HuntModeStrategy();
    const hunt = createWorld(huntStrategy, []);
    hunt.world._simulationClockMs = 8_000;
    const target = createPlayerFacade(hunt.world, { index: 1, hp: 100, shieldHP: 10 });
    hunt.world.players.push(target);
    const result = target.takeDamage(15, { cause: 'PROJECTILE', weaponKind: 'ROCKET' });
    assert.equal(result.applied, 15);
    assert.equal(result.absorbedByShield, 10);
    assert.equal(result.hpApplied, 5);
    assert.equal(target.hp, 95);
    assert.equal(target.lastDamageTimestamp, 8);
    assert.equal(hunt.events.length, 0);
    assert.equal(hunt.kills.length, 0);

    const lethalTarget = createPlayerFacade(hunt.world, { index: 2, hp: 5 });
    hunt.world.players.push(lethalTarget);
    const lethal = lethalTarget.takeDamage(10, { cause: 'PROJECTILE' });
    assert.equal(lethal.isDead, true);
    assert.equal(lethalTarget.alive, true, 'the legacy owner still performs the death transition');
    assert.equal(hunt.events.length, 0);
    assert.equal(hunt.kills.length, 0);
    hunt.world._emitHuntDamageEvent({ target: lethalTarget, sourcePlayer: null, cause: 'PROJECTILE', damageResult: lethal });
    hunt.world._killPlayer(lethalTarget, 'PROJECTILE', { killer: null });
    assert.equal(hunt.events.length, 1);
    assert.equal(hunt.kills.length, 1);

    const classic = createWorld(new ClassicModeStrategy(), []);
    const classicPlayer = createPlayerFacade(classic.world, { index: 3, hp: 1, shieldHP: 1 });
    const classicResult = classicPlayer.takeDamage(1);
    assert.equal(classicResult.isDead, true);
    assert.equal(classicPlayer.hp, 0);
    assert.equal(classicPlayer.shieldHP, 0);
    assert.equal(classicPlayer.alive, true);
    assert.equal(classic.events.length, 0);
    assert.equal(classic.kills.length, 0);

    const arcadeStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    arcadeStrategy._sdActive = true;
    arcadeStrategy._sdDamageMultiplier = 2;
    const arcade = createWorld(arcadeStrategy, []);
    const arcadePlayer = createPlayerFacade(arcade.world, { index: 4, hp: 100, shieldHP: 5 });
    const arcadeResult = arcadePlayer.takeDamage(10);
    assert.equal(arcadeResult.applied, 20, 'Sudden Death scales the raw hit exactly once');
    assert.equal(arcadeResult.absorbedByShield, 5);
    assert.equal(arcadeResult.hpApplied, 15);
    assert.equal(arcadePlayer.hp, 85);
    assert.equal(arcadePlayer.lastDamageTimestamp, 7, 'clockless legacy damage keeps the HealthSystem wall clock fallback');
    assert.equal(arcade.events.length, 0);
    assert.equal(arcade.kills.length, 0);
});

test('legacy Player damage preserves guards, team/self exceptions, safe amounts, and simulation time', () => {
    const teammate = createPlayer({ index: 0, teamId: TEAM_IDS.ALPHA });
    const hunt = createWorld(new HuntModeStrategy(), [teammate]);
    hunt.world._simulationClockMs = 12_000;
    const protectedPlayer = createPlayerFacade(hunt.world, { index: 1, hp: 100, spawnProtectionTimer: 2 });
    assert.equal(protectedPlayer.takeDamage(20).blocked, 'SPAWN_PROTECTION');
    assert.equal(protectedPlayer.hp, 100);
    const invulnerablePlayer = createPlayerFacade(hunt.world, { index: 2, hp: 100 });
    invulnerablePlayer.invulnerable = true;
    assert.equal(invulnerablePlayer.takeDamage(20).blocked, 'INVULNERABLE');
    assert.equal(invulnerablePlayer.hp, 100);
    const deadPlayer = createPlayerFacade(hunt.world, { index: 6, hp: 0, alive: false });
    assert.equal(deadPlayer.takeDamage(20).blocked, 'DEAD');
    assert.equal(deadPlayer.hp, 0);

    const teamPlayer = createPlayerFacade(hunt.world, { index: 3, teamId: TEAM_IDS.ALPHA });
    const teamBlocked = teamPlayer.takeDamage(20, {
        sourcePlayer: teammate,
        weaponKind: 'ROCKET',
        cause: 'PROJECTILE',
    });
    assert.equal(teamBlocked.blocked, 'TEAM');
    assert.equal(teamPlayer.hp, 100);
    const blastPlayer = createPlayerFacade(hunt.world, { index: 7, teamId: TEAM_IDS.ALPHA });
    assert.equal(blastPlayer.takeDamage(10, { sourcePlayer: teammate, cause: 'BLAST' }).blocked, null);
    assert.equal(blastPlayer.hp, 90, 'authored BLAST remains an environmental team-damage exception');

    const selfPlayer = createPlayerFacade(hunt.world, { index: 4, teamId: TEAM_IDS.ALPHA, hp: 5 });
    const selfHit = selfPlayer.takeDamage(10, {
        sourcePlayer: selfPlayer,
        cause: 'TANK_EXPLOSION',
        selfDamagePolicy: 'ALLOW_WITHOUT_KILL_CREDIT',
    });
    assert.equal(selfHit.isDead, true);
    assert.equal(selfPlayer.hp, 0);
    assert.equal(selfPlayer.alive, true);

    const timedPlayer = createPlayerFacade(hunt.world, { index: 5, hp: 100 });
    assert.equal(timedPlayer.takeDamage(10, { nowSeconds: 7 }).applied, 10);
    assert.equal(timedPlayer.lastDamageTimestamp, 7, 'explicit time wins over the injected simulation clock');
    timedPlayer.takeDamage(10);
    assert.equal(timedPlayer.lastDamageTimestamp, 12);
    timedPlayer.takeDamage(1, { nowSeconds: '9' });
    assert.equal(timedPlayer.lastDamageTimestamp, 9, 'numeric legacy timestamps remain normalized');
    timedPlayer.takeDamage(1, { nowSeconds: NaN });
    assert.equal(timedPlayer.lastDamageTimestamp, 12, 'invalid legacy timestamps fall back to simulation time');
    const beforeInvalid = timedPlayer.hp;
    assert.equal(timedPlayer.takeDamage(0).applied, 0);
    assert.equal(timedPlayer.takeDamage(NaN).applied, 0);
    assert.equal(timedPlayer.takeDamage('not damage').applied, 0);
    assert.equal(timedPlayer.hp, beforeInvalid);
    assert.equal(hunt.events.length, 0);
    assert.equal(hunt.kills.length, 0);
});

test('legacy Player healing delegates active mode rules and standalone HealthSystem fallback without recursion', (t) => {
    stubWallClockSeconds(t, 7);
    const huntStrategy = new HuntModeStrategy();
    let healingCalls = 0;
    const applyHealing = huntStrategy.applyHealing.bind(huntStrategy);
    huntStrategy.applyHealing = (...args) => {
        healingCalls += 1;
        return applyHealing(...args);
    };
    const hunt = createWorld(huntStrategy, []);
    const protectedPlayer = createPlayerFacade(hunt.world, { index: 1, hp: 95, spawnProtectionTimer: 3 });
    assert.deepEqual(protectedPlayer.heal(20), { healed: 5, hp: 100, blocked: null });
    assert.equal(healingCalls, 1);
    const beforeZero = protectedPlayer.hp;
    assert.deepEqual(protectedPlayer.heal(0), { healed: 0, hp: beforeZero, blocked: null });
    assert.deepEqual(protectedPlayer.heal(null), { healed: 0, hp: beforeZero, blocked: null });
    assert.deepEqual(protectedPlayer.heal(NaN), { healed: 0, hp: beforeZero, blocked: null });
    assert.equal(healingCalls, 1, 'zero and invalid heals are stopped before strategy delegation');

    const deadPlayer = createPlayerFacade(hunt.world, { index: 2, hp: 0, alive: false });
    assert.deepEqual(deadPlayer.heal(20), { healed: 0, hp: 0, blocked: 'DEAD' });

    const classic = createWorld(new ClassicModeStrategy(), []);
    const classicPlayer = createPlayerFacade(classic.world, { index: 3, hp: 0.5 });
    assert.deepEqual(classicPlayer.heal(5), { healed: 1, hp: 1, blocked: null });

    const arcadeStrategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    arcadeStrategy._sdActive = true;
    const arcade = createWorld(arcadeStrategy, []);
    const arcadePlayer = createPlayerFacade(arcade.world, { index: 4, hp: 50 });
    assert.deepEqual(arcadePlayer.heal(20), { healed: 0, hp: 50, blocked: null });

    const standalone = createPlayerFacade(null, { index: 5, hp: 90, shieldHP: 10 });
    standalone.entityRuntimeConfig = {
        PLAYER: {},
        POWERUP: {},
        HUNT: { ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
    };
    assert.equal(standalone.takeDamage(5).hpApplied, 0);
    assert.equal(standalone.hp, 90);
    assert.equal(standalone.lastDamageTimestamp, 7);
    assert.deepEqual(standalone.heal(20), { healed: 10, hp: 100, blocked: null });

    const standaloneClassic = createPlayerFacade(null, { index: 6, hp: 1, shieldHP: 1 });
    standaloneClassic.entityRuntimeConfig = {
        PLAYER: {}, POWERUP: {},
        HUNT: { ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
    };
    assert.equal(standaloneClassic.takeDamage(1).hpApplied, 1);
    assert.equal(standaloneClassic.hp, 0, 'the direct HealthSystem fallback retains Classic instant kill');
    const standaloneClassicHealer = createPlayerFacade(null, { index: 7, hp: 0.5 });
    standaloneClassicHealer.entityRuntimeConfig = standaloneClassic.entityRuntimeConfig;
    assert.deepEqual(standaloneClassicHealer.heal(5), { healed: 1, hp: 1, blocked: null });
});
