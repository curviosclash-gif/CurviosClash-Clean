import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ALLOWED_HEALTH_WRITES,
    collectHealthWrites,
    evaluateHealthWrites,
    hasHealthBoundaryErrors,
    scanPlayerHealthBoundary,
    scanPlayerHealthSources,
} from '../scripts/check-player-health-boundary.mjs';

test('AST guard detects direct, aliased, bracket, parenthesized-key, compound, and update writes', () => {
    const { writes, diagnostics } = collectHealthWrites([
        'function direct(player) { player.hp -= 3; }',
        'function alias(target) { const victim = target; victim.hp *= 0.5; }',
        'function bracket(player) { player["hp"]++; }',
        'function shield(player) { ++player.shieldHP; }',
        'function parenthesizedKeys(player) { player[("hp")] = 1; player[(("shieldHP") as const)] -= 2; (player[("hp")]) = 3; (player["shieldHP"] as number) = 4; }',
    ].join('\n'), 'src/fixture.mjs');
    const violations = evaluateHealthWrites(writes, []);

    assert.equal(diagnostics.length, 0);
    assert.equal(writes.length, 8);
    assert.equal(violations.length, 8);
    assert.deepEqual(writes.map((write) => write.operator), ['-=', '*=', '++', '++', '=', '-=', '=', '=']);
    assert.deepEqual(writes.map((write) => write.property), ['hp', 'hp', 'hp', 'shieldHP', 'hp', 'shieldHP', 'hp', 'shieldHP']);
});

test('AST guard visits nested object, array, default, and loop assignment targets only on the LHS', () => {
    const source = [
        'function objectTarget(player, state) { ({ hp: player.hp } = state); }',
        'function computedTarget(player, state) { ({ ["shieldHP"]: (player)["shieldHP"] } = state); }',
        'function nestedTarget(player, state) { ({ nested: [[player.hp]] } = state); }',
        'function defaultTarget(player, state) { ({ hp: player.hp = 2 } = state); }',
        'function aliasTarget(player, state) { const currentPlayer = player; ({ hp: currentPlayer.hp } = state); }',
        'function loopTargets(player, values, state) { for (player.hp of values) {} for (player.shieldHP in state) {} }',
        'function readsOnly(player, state, copy) { const snapshot = { hp: player.hp, shieldHP: player.shieldHP }; ({ hp: copy.hp } = { hp: player.hp, shieldHP: player.shieldHP }); return state.hp + snapshot.hp; }',
    ].join('\n');
    const { writes, diagnostics } = collectHealthWrites(source, 'src/fixture.mjs');
    const violations = evaluateHealthWrites(writes, []);

    assert.equal(diagnostics.length, 0);
    assert.equal(writes.length, 8);
    assert.equal(violations.length, 8);
    assert.deepEqual(writes.map((write) => write.property), ['hp', 'shieldHP', 'hp', 'hp', 'hp', 'hp', 'shieldHP', 'hp']);
    assert.ok(writes.some((write) => write.receiver === '(player)' && write.property === 'shieldHP'));
});

test('AST parser diagnostics make the guard fail closed', () => {
    const result = scanPlayerHealthSources([{ file: 'src/broken.mjs', source: 'function broken( {' }], []);

    assert.ok(result.diagnostics.length > 0);
    assert.equal(hasHealthBoundaryErrors(result), true);
});

test('AST guard accepts a specifically fingerprinted object HP policy and rejects a duplicate writer', () => {
    const statement = 'unit.hp = Math.max(0, unit.hp - 1)';
    const allowedWrites = [{
        file: 'src/fixture.mjs',
        functionPath: 'damageUnit',
        receiver: 'unit',
        property: 'hp',
        operator: '=',
        value: 'Math.max(0, unit.hp - 1)',
        reason: 'map-unit object HP, not player health',
    }];
    const { writes, diagnostics } = collectHealthWrites(
        `function damageUnit(unit) { ${statement}; ${statement}; }`, 'src/fixture.mjs'
    );
    const violations = evaluateHealthWrites(writes, allowedWrites);

    assert.equal(diagnostics.length, 0);
    assert.equal(writes.length, 2);
    assert.equal(violations.length, 1, 'the exact allowed object write has a count of one');
    assert.equal(violations[0].statement, statement);
});

test('the low-level regen exception is bound to its HealthSystem source path', () => {
    const fallback = ALLOWED_HEALTH_WRITES.find((entry) => (
        entry.file === 'src/hunt/HealthSystem.js' && entry.functionPath === 'updatePlayerHealthRegen'
    ));
    assert.ok(fallback, 'the exact strategyless Player.update fallback is retained');
    const { writes } = collectHealthWrites(
        'function updatePlayerHealthRegen(player) { player.hp = Math.min(maxHp, player.hp + regenPerSecond * Math.max(0, dt)); }',
        'src/modes/OtherMode.js',
    );
    const violations = evaluateHealthWrites(writes, [fallback]);

    assert.ok(violations.some((entry) => entry.reason === 'unapproved player/object health write'));
    assert.ok(violations.some((entry) => entry.reason === 'approved source fingerprint is missing or changed'));
});

test('direct regeneration added back to HuntModeStrategy remains unapproved', () => {
    const source = 'function updateHealthRegen(player) { player.hp = Math.min(maxHp, player.hp + regenPerSecond * Math.max(0, dt)); }';
    const { writes } = collectHealthWrites(source, 'src/modes/HuntModeStrategy.js');
    const violations = evaluateHealthWrites(writes, ALLOWED_HEALTH_WRITES);

    assert.equal(writes.length, 1);
    assert.ok(violations.some((entry) => entry.functionPath === 'updateHealthRegen'
        && entry.reason === 'unapproved player/object health write'));
});

test('production inventory has only the two separately migrating mode regeneration writers', () => {
    const result = scanPlayerHealthBoundary();
    const expected = new Set([
        'src/modes/HuntModeStrategy.js|updateHealthRegen|player.hp',
        'src/modes/ArcadeBaseRegenOps.js|updateArcadeBaseRegen|player.hp',
    ]);

    assert.equal(result.diagnostics.length, 0);
    assert.ok(result.violations.length <= expected.size);
    for (const violation of result.violations) {
        assert.ok(expected.has(`${violation.file}|${violation.functionPath}|${violation.receiver}.${violation.property}`));
    }
    assert.equal(ALLOWED_HEALTH_WRITES.some((entry) => entry.file === 'src/modes/HuntModeStrategy.js'
        && entry.functionPath === 'updateHealthRegen'), false);
    assert.ok(ALLOWED_HEALTH_WRITES.every((entry) => entry.reason), 'every retained exception states its policy');
});
