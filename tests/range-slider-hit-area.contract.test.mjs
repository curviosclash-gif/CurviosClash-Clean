import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function readRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : '';
}

function readPx(rule, property) {
    const match = rule.match(new RegExp(`(^|[;\\s])${property}:\\s*(\\d+(?:\\.\\d+)?)px`));
    return match ? Number(match[2]) : null;
}

test('range sliders offer a hit area of at least 24 px', () => {
    const rule = readRule('input[type="range"]');
    assert.ok(rule, 'base range rule exists');
    assert.ok(readPx(rule, 'height') >= 24, `range height is ${readPx(rule, 'height')}px`);
});

test('the visible track stays slim inside the larger hit area', () => {
    const webkitTrack = readRule('input[type="range"]::-webkit-slider-runnable-track');
    const mozTrack = readRule('input[type="range"]::-moz-range-track');
    for (const [label, rule] of [['webkit', webkitTrack], ['firefox', mozTrack]]) {
        const height = readPx(rule, 'height');
        assert.ok(height !== null && height <= 8, `${label} track is a slim bar (height ${height})`);
    }
});

test('the thumb is at least 20 px', () => {
    const thumb = readRule('input[type="range"]::-webkit-slider-thumb');
    assert.ok(readPx(thumb, 'width') >= 20 && readPx(thumb, 'height') >= 20);
});
