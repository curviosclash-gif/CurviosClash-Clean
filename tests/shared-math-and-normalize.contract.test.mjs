import assert from 'node:assert/strict';
import test from 'node:test';

import { clamp, clamp01, toFiniteNumber } from '../src/shared/utils/MathOps.js';
import { normalizeString, normalizeText } from '../src/shared/contracts/ContractNormalizeUtils.js';

// Diese Datei nagelt das Randverhalten der geteilten Helfer fest, bevor die
// verstreuten Eigenfassungen darauf umgestellt werden. Ohne diese Zusagen waere
// jede Ersetzung ein blinder Tausch.

test('clamp keeps finite values inside the bounds', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-3, 0, 10), 0);
    assert.equal(clamp(42, 0, 10), 10);
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
});

test('clamp substitutes min for non-finite input instead of passing NaN on', () => {
    // Der entscheidende Unterschied zu den lokalen Eigenfassungen: die uebliche
    // Form Math.min(max, Math.max(min, value)) liefert hier NaN.
    assert.equal(clamp(Number.NaN, 2, 8), 2);
    assert.equal(clamp(Number.POSITIVE_INFINITY, 2, 8), 2);
    assert.equal(clamp(Number.NEGATIVE_INFINITY, 2, 8), 2);
    assert.equal(clamp(undefined, 2, 8), 2);
    assert.equal(clamp(null, 2, 8), 2);
    assert.equal(clamp('7', 2, 8), 2, 'strings are not coerced; clamp expects a number');

    const localForm = (value, min, max) => Math.min(max, Math.max(min, value));
    assert.ok(Number.isNaN(localForm(Number.NaN, 2, 8)));
    assert.notEqual(clamp(Number.NaN, 2, 8), localForm(Number.NaN, 2, 8));
});

test('clamp01 is clamp against the unit range', () => {
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(Number.NaN), 0);
});

test('toFiniteNumber coerces and falls back on anything non-finite', () => {
    assert.equal(toFiniteNumber(3), 3);
    assert.equal(toFiniteNumber('3'), 3, 'numeric strings are coerced');
    assert.equal(toFiniteNumber('3.5'), 3.5);
    assert.equal(toFiniteNumber(''), 0, 'the empty string coerces to 0, not to the fallback');
    assert.equal(toFiniteNumber('abc', 7), 7);
    assert.equal(toFiniteNumber(Number.NaN, 7), 7);
    assert.equal(toFiniteNumber(Number.POSITIVE_INFINITY, 7), 7);
    assert.equal(toFiniteNumber(null, 7), 0, 'null coerces to 0 before the finite check');
    assert.equal(toFiniteNumber(undefined, 7), 7);
    assert.equal(toFiniteNumber({}, 7), 7);
});

test('toFiniteNumber defaults its fallback to zero', () => {
    assert.equal(toFiniteNumber('abc'), 0);
    assert.equal(toFiniteNumber(undefined), 0);
});

test('normalizeString trims and falls back on empty results', () => {
    assert.equal(normalizeString('  hallo  '), 'hallo');
    assert.equal(normalizeString('hallo'), 'hallo');
    assert.equal(normalizeString('   ', 'ersatz'), 'ersatz');
    assert.equal(normalizeString('', 'ersatz'), 'ersatz');
    assert.equal(normalizeString(null, 'ersatz'), 'ersatz');
    assert.equal(normalizeString(undefined, 'ersatz'), 'ersatz');
    assert.equal(normalizeString(42, 'ersatz'), 'ersatz', 'numbers are not coerced to text');
    assert.equal(normalizeString(''), '', 'the fallback defaults to the empty string');
});

test('normalizeString does not lowercase', () => {
    // Zwei Eigenfassungen im Baum tun das zusaetzlich. Wer sie ersetzt, muss
    // toLowerCase an der Aufrufstelle nachziehen.
    assert.equal(normalizeString('Arcade'), 'Arcade');
    assert.equal(normalizeText('Arcade'), 'Arcade');
});

test('normalizeText behaves exactly like normalizeString', () => {
    for (const value of ['  text  ', '', '   ', null, undefined, 7, 'Text']) {
        assert.equal(normalizeText(value, 'ersatz'), normalizeString(value, 'ersatz'));
    }
});
