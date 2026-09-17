// Contract test for the German number formatting of the post-match scoreboard (P2).
//
// The v2 stats contract (src/shared/contracts/PostMatchStatsContract.js) carries raw numbers plus a
// type. Everything that turns such a row into visible text must go through one module, otherwise the
// round board, the match board and the arcade panels drift apart again ("12.5s" vs "12,5 s").
// These assertions therefore pin the exact output string, including the non-breaking space that
// keeps the unit glued to its number.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    POST_MATCH_VALUE_PLACEHOLDER,
    formatCount,
    formatDistance,
    formatDuration,
    formatPercent,
    formatPostMatchValue,
    formatRatio,
    formatText,
    getPostMatchNumberFormatter,
} from '../src/ui/postmatch/PostMatchFormat.js';

const NBSP = ' ';

test('the placeholder is the en dash, never "NaN"', () => {
    assert.equal(POST_MATCH_VALUE_PLACEHOLDER, '–', 'broken values show an en dash');
});

test('a duration below a minute is written with one decimal and a glued unit', () => {
    assert.equal(formatDuration(12.5), `12,5${NBSP}s`, '12.5 seconds read as "12,5 s"');
    assert.equal(formatDuration(0), `0,0${NBSP}s`, 'zero stays a duration, not a placeholder');
    assert.equal(formatDuration(59.94), `59,9${NBSP}s`, 'just below the rounding edge stays in seconds');
});

test('a duration never prints "60,0 s" but flips into the m:ss form', () => {
    assert.equal(formatDuration(59.96), '1:00', '59.96 rounds up and must become 1:00');
    assert.equal(formatDuration(60), '1:00', 'exactly one minute is 1:00');
    assert.equal(formatDuration(65), '1:05', 'the seconds part is zero padded');
});

test('a duration of an hour or more is written as h:mm:ss', () => {
    assert.equal(formatDuration(3599.6), '1:00:00', '59:59.6 rounds into the full hour');
    assert.equal(formatDuration(3600), '1:00:00', 'exactly one hour is 1:00:00');
    assert.equal(formatDuration(3725), '1:02:05', 'minutes and seconds are both zero padded');
});

test('the m:ss form never shows a sixtieth second', () => {
    for (const seconds of [119.6, 179.96, 3599.96, 7199.7]) {
        assert.ok(!formatDuration(seconds).includes(':60'), `${seconds} must not print ":60"`);
    }
});

test('a broken or negative duration becomes the placeholder', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, -1, 'abc']) {
        assert.equal(formatDuration(value), POST_MATCH_VALUE_PLACEHOLDER, `${String(value)} has no duration`);
    }
});

test('the row precision beats the type default for durations', () => {
    assert.equal(formatDuration(1.25, 2), `1,25${NBSP}s`, 'two decimals are kept');
    assert.equal(formatDuration(12.7, 0), `13${NBSP}s`, 'zero decimals round to a whole second');
});

test('percent takes a fraction, not an already multiplied number', () => {
    assert.equal(formatPercent(0.256), `26${NBSP}%`, '0.256 is 26 percent');
    assert.equal(formatPercent(0.256, 1), `25,6${NBSP}%`, 'the row precision wins');
    assert.equal(formatPercent(0), `0${NBSP}%`, 'zero percent stays visible');
    assert.equal(formatPercent(1), `100${NBSP}%`, 'a full fraction is 100 percent');
    assert.equal(formatPercent(Number.NaN), POST_MATCH_VALUE_PLACEHOLDER, 'a broken share is a placeholder');
});

test('counts are whole numbers with a German thousands dot', () => {
    assert.equal(formatCount(1250), '1.250', 'thousands are separated by a dot');
    assert.equal(formatCount(0), '0', 'zero counts are printed');
    assert.equal(formatCount(12.7), '13', 'a fractional count is rounded');
    assert.equal(formatCount(Number.POSITIVE_INFINITY), POST_MATCH_VALUE_PLACEHOLDER, 'infinity is a placeholder');
});

test('distance uses metres up to the kilometre threshold', () => {
    assert.equal(formatDistance(1250), `1.250${NBSP}m`, 'metres keep the thousands dot');
    assert.equal(formatDistance(9999), `9.999${NBSP}m`, 'just below the threshold stays in metres');
});

test('distance switches to kilometres from 10000 metres with one decimal', () => {
    assert.equal(formatDistance(10000), `10,0${NBSP}km`, 'the threshold itself is already kilometres');
    assert.equal(formatDistance(12500), `12,5${NBSP}km`, '12500 metres read as 12,5 km');
    assert.equal(formatDistance(9999.6), `10,0${NBSP}km`, 'rounding across the threshold switches the unit');
    assert.equal(formatDistance(null), POST_MATCH_VALUE_PLACEHOLDER, 'a missing distance is a placeholder');
});

test('ratios keep their sign', () => {
    assert.equal(formatRatio(1.25), '1,3', 'a positive ratio rounds to one decimal');
    assert.equal(formatRatio(-1.25), '-1,3', 'a negative ratio keeps the minus');
    assert.equal(formatRatio(0), '0,0', 'zero is printed with its decimal');
    assert.equal(formatRatio(2.5, 0), '3', 'the row precision wins');
    assert.equal(formatRatio(1.23456, 9), '1,235', 'an absurd precision is clamped to three decimals');
});

test('text is passed through untouched', () => {
    assert.equal(formatText('Sieg durch Treffer'), 'Sieg durch Treffer', 'text stays as written');
    assert.equal(formatText(''), '', 'an empty text stays empty');
    assert.equal(formatText(null), POST_MATCH_VALUE_PLACEHOLDER, 'a missing text is a placeholder');
});

test('every unit is glued to its number with a non-breaking space', () => {
    for (const formatted of [formatDuration(12.5), formatPercent(0.5), formatDistance(120), formatDistance(12000)]) {
        assert.ok(formatted.includes(NBSP), `"${formatted}" uses U+00A0`);
        assert.ok(!formatted.includes(' '), `"${formatted}" uses no ordinary space`);
    }
});

test('formatPostMatchValue dispatches on the row type', () => {
    assert.equal(formatPostMatchValue({ value: 65, type: 'duration', precision: 1 }), '1:05', 'duration row');
    assert.equal(formatPostMatchValue({ value: 0.25, type: 'percent', precision: 0 }), `25${NBSP}%`, 'percent row');
    assert.equal(formatPostMatchValue({ value: 1250, type: 'count' }), '1.250', 'count row');
    assert.equal(formatPostMatchValue({ value: 12500, type: 'distance' }), `12,5${NBSP}km`, 'distance row');
    assert.equal(formatPostMatchValue({ value: -1.5, type: 'ratio', precision: 1 }), '-1,5', 'ratio row');
    assert.equal(formatPostMatchValue({ value: 'Zeit aus', type: 'text' }), 'Zeit aus', 'text row');
});

test('formatPostMatchValue lets the row precision win over the type default', () => {
    assert.equal(
        formatPostMatchValue({ value: 0.256, type: 'percent', precision: 1 }),
        `25,6${NBSP}%`,
        'a percent row may ask for a decimal',
    );
});

test('formatPostMatchValue survives unknown types and broken rows', () => {
    assert.equal(formatPostMatchValue({ value: 'roh', type: 'nonsense' }), 'roh', 'an unknown type reads as text');
    assert.equal(formatPostMatchValue(null), POST_MATCH_VALUE_PLACEHOLDER, 'no row, no value');
    assert.equal(formatPostMatchValue({ value: Number.NaN, type: 'count' }), POST_MATCH_VALUE_PLACEHOLDER, 'NaN never leaks');
});

test('the number formatter is built once per precision and stays stable', () => {
    assert.equal(
        getPostMatchNumberFormatter(1),
        getPostMatchNumberFormatter(1),
        'the same precision reuses the same Intl.NumberFormat',
    );
    assert.notEqual(getPostMatchNumberFormatter(1), getPostMatchNumberFormatter(2), 'a different precision is its own formatter');
    const first = formatPostMatchValue({ value: 12.5, type: 'duration' });
    const second = formatPostMatchValue({ value: 12.5, type: 'duration' });
    assert.equal(first, second, 'a cached formatter returns the same text every time');
});

// A race result asks for hundredths. The plain minute form "1:15" would hide who was faster, so
// from two decimals on the fraction stays: the five portals board compares times like these.
test('a duration with hundredths keeps them in the minute form', () => {
    assert.equal(formatDuration(75.43, 2), '1:15,43');
    assert.equal(formatDuration(65.04, 2), '1:05,04');
    assert.equal(formatDuration(59.996, 2), '1:00,00');
    assert.equal(formatDuration(12.5, 2), '12,50\u00a0s');
    assert.equal(formatDuration(75.43), '1:15', 'the board default stays the short form');
});
