import assert from 'node:assert/strict';
import test from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { applyHeal, applyHealTo, applyHit, applyHitTo, finalizeHitDeath } from '../src/entities/combat/CombatPipeline.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { normalizeCombatHitInput } from '../src/shared/contracts/CombatHitContract.js';

// AGENTS.md rule 7: heat stress, boost tax, hazard proximity and the base regen run every frame
// for every vehicle. These guards pin the pipeline to the objects the mode rule itself returns,
// so the per-frame path creates no option copies, normalized inputs or result copies.

function createTarget(index = 1) {
    return {
        index,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hasShield: false,
        alive: true,
        spawnProtectionTimer: 0,
        position: { x: index, y: 0, z: 0 },
        kill() { this.alive = false; this.hp = 0; },
    };
}

// Records what the pipeline hands to the mode rule and what the rule returns.
function createRecordingStrategy() {
    const seenOptions = [];
    const returned = [];
    return {
        seenOptions,
        returned,
        applyDamage(target, amount, options) {
            seenOptions.push(options);
            target.hp = Math.max(0, target.hp - amount);
            const result = { applied: amount, absorbedByShield: 0, remainingHp: target.hp, isDead: target.hp <= 0 };
            returned.push(result);
            return result;
        },
        applyHealing(target, amount) {
            const before = target.hp;
            target.hp = Math.min(target.maxHp, target.hp + amount);
            const result = { healed: target.hp - before, hp: target.hp };
            returned.push(result);
            return result;
        },
    };
}

function createWorld(strategy) {
    return { gameModeStrategy: strategy, _emitHuntDamageEvent() {}, _killPlayer(target) { target.kill(); } };
}

test('a per-frame hit hands the mode rule one reused option object', () => {
    const strategy = createRecordingStrategy();
    const world = createWorld(strategy);
    const target = createTarget();
    const options = { ignoreShield: true, emitDamageEvent: false };

    applyHitTo(world, target, 0.5, 'BOOST_TAX', options);
    applyHitTo(world, target, 0.5, 'BOOST_TAX', options);

    assert.equal(strategy.seenOptions.length, 2);
    assert.equal(strategy.seenOptions[0], strategy.seenOptions[1], 'the strategy options are not rebuilt per hit');
    assert.equal(strategy.seenOptions[1].ignoreShield, true, 'the reused options still carry the caller rule');
    assert.equal(target.hp, 99);
});

test('a hit returns the result of the mode rule instead of copying it twice', () => {
    const strategy = createRecordingStrategy();
    const target = createTarget();

    const result = applyHit(createWorld(strategy), { target, amount: 3, cause: 'HEAT_STRESS', emitDamageEvent: false });

    assert.equal(result, strategy.returned[0], 'the completed mode result is the returned result');
    assert.equal(result.hpApplied, 3);
    assert.equal(result.blocked, null);
});

test('a heal returns the result of the mode rule instead of a copy', () => {
    const strategy = createRecordingStrategy();
    const target = Object.assign(createTarget(), { hp: 50 });

    const result = applyHealTo(createWorld(strategy), target, 2);

    assert.equal(result, strategy.returned[0], 'the completed heal result is the returned result');
    assert.equal(result.healed, 2);
    assert.equal(result.blocked, null);
    assert.equal(applyHeal(createWorld(strategy), { target, amount: 1 }).hp, 53, 'the input form keeps working');
});

test('the contract normalizes into a caller-owned object and resets what the last hit left', () => {
    const target = createTarget();
    const scratch = {};

    const first = normalizeCombatHitInput({ target, amount: 2, ignoreShield: true, killOnDeath: false }, scratch);
    const second = normalizeCombatHitInput({ target, amount: 1 }, scratch);

    assert.equal(first, scratch);
    assert.equal(second, scratch);
    assert.equal(second.ignoreShield, false, 'a flag from the previous hit does not leak');
    assert.equal(second.killOnDeath, true, 'a flag from the previous hit does not leak');
    assert.equal(normalizeCombatHitInput({ target, amount: -1 }, scratch), null);
});

test('arcade heat stress and boost tax reuse their damage options every frame', () => {
    const strategy = new ArcadeModeStrategy();
    const seen = [];
    const entityManager = { _applyModeDamage(_player, _amount, _cause, options) { seen.push(options); return null; } };
    const player = Object.assign(createTarget(0), { isBoosting: true });
    strategy._getAggregatedModifierEffects = () => ({ hpDrainPerSecond: 2, boostHpCostPerSecond: 3 });

    strategy.updateHealthRegen(player, 0.016, entityManager);
    strategy.updateHealthRegen(player, 0.016, entityManager);
    strategy.applyBoostTick(player, 0.016, entityManager);
    strategy.applyBoostTick(player, 0.016, entityManager);

    assert.equal(seen.length, 4);
    assert.equal(seen[0], seen[1], 'heat stress options are shared');
    assert.equal(seen[2], seen[3], 'boost tax options are shared');
    assert.equal(seen[0].ignoreShield, false, 'heat stress still hits the shield first');
    assert.equal(seen[2].ignoreShield, true, 'boost tax still bypasses the shield');
    assert.equal(seen[2].emitDamageEvent, false);
});

test('the module scratch does not keep a player alive after a rejected death finalization', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    const strategy = createRecordingStrategy();
    // Scoped so only the pipeline scratch could still reach the player afterwards.
    const ref = (() => {
        const target = createTarget(7);
        finalizeHitDeath(createWorld(strategy), { target, amount: 1 }, null);
        return new WeakRef(target);
    })();

    await new Promise((resolve) => setImmediate(resolve));
    gc();

    assert.equal(ref.deref(), undefined, 'the rejected finalization released its normalized target');
});

test('a hit nested in a kill keeps both results correct', () => {
    const strategy = createRecordingStrategy();
    const victim = Object.assign(createTarget(1), { hp: 5 });
    const bystander = createTarget(2);
    let nested = null;
    const world = {
        gameModeStrategy: strategy,
        _emitHuntDamageEvent() {},
        // A kill that sets off a blast: the second hit runs while the first is still open.
        _killPlayer(target) {
            target.kill();
            nested = applyHitTo(world, bystander, 30, 'BLAST', { ignoreShield: false });
        },
    };

    const outer = applyHitTo(world, victim, 10, 'BLAST', { ignoreShield: true });

    assert.equal(outer.hpApplied, 5, 'the outer result still describes the victim');
    assert.equal(outer.isDead, true);
    assert.equal(nested.hpApplied, 30, 'the nested result describes the bystander');
    assert.equal(strategy.seenOptions[0].ignoreShield, true, 'the outer options survive the nested hit');
    assert.notEqual(outer, nested);
    assert.equal(bystander.hp, 70);
});
