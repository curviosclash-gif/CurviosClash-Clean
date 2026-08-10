import assert from 'node:assert/strict';
import test from 'node:test';

import { findDeterminismViolations, maskComments } from '../scripts/check-runtime-determinism.mjs';

function details(source) {
    return findDeterminismViolations(source).map((violation) => violation.detail);
}

test('a call to the wall clock or the global roll is reported', () => {
    assert.deepEqual(details('const t = Date.now();'), ['Date.now(']);
    assert.deepEqual(details('const r = Math.random();'), ['Math.random(']);
    assert.deepEqual(details('const p = performance.now();'), ['performance.now(']);
});

// Das war die Luecke: der alte Ausdruck verlangte die oeffnende Klammer, deshalb blieb
// jede Zuweisung unsichtbar, obwohl sie denselben ungesetzten Wuerfel weiterreicht.
test('handing the global roll on as a value is reported too', () => {
    assert.deepEqual(details('this._random = Math.random;'), ['Math.random (handed on as a value)']);
    assert.deepEqual(
        details('const now = typeof options.now === \'function\' ? options.now : Date.now;'),
        ['Date.now (handed on as a value)']
    );
    assert.deepEqual(
        details('function pick(entries, random = Math.random) {}'),
        ['Math.random (handed on as a value)']
    );
});

test('a capability check asks about the platform and is not a use', () => {
    assert.deepEqual(details('if (typeof performance.now === \'function\') {}'), []);
    assert.deepEqual(
        details('if (typeof performance !== \'undefined\' && typeof performance.now === \'function\') {}'),
        []
    );
});

test('a capability check does not excuse the call that follows it', () => {
    const source = [
        'if (typeof performance !== \'undefined\' && typeof performance.now === \'function\') {',
        '    return performance.now() * 0.001;',
        '}',
    ].join('\n');

    assert.deepEqual(details(source), ['performance.now(']);
});

test('a comment naming the global roll does not trip the guard', () => {
    assert.deepEqual(details('// falls back to Math.random when unseeded'), []);
    assert.deepEqual(details('/* Date.now is deliberately avoided here */'), []);
});

test('masking keeps the reported line pointing at the real source line', () => {
    const source = [
        '/*',
        ' * Math.random must not appear in a report.',
        ' */',
        'const seed = 1;',
        'const roll = Math.random();',
    ].join('\n');
    const violations = findDeterminismViolations(source);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 5);
});

test('masking replaces comments without shifting any offsets', () => {
    const source = 'const a = 1; // Math.random\nconst b = 2;';
    const masked = maskComments(source);

    assert.equal(masked.length, source.length);
    assert.equal(masked.split('\n').length, source.split('\n').length);
    assert.doesNotMatch(masked, /Math\.random/);
});

test('several uses on one line are each reported', () => {
    assert.deepEqual(
        details('const x = Math.random() > 0.5 ? Date.now() : 0;'),
        ['Math.random(', 'Date.now(']
    );
});
