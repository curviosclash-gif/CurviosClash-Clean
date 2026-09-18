import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('the arcade seed field uses the shared menu field style', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    // The rule that gives text fields their dark background, border and rounded corners.
    const fieldRule = /((?:^|\})[^{}]*input\[type="text"\][^{}]*)\{[^{}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.05\)[^{}]*border-radius:\s*10px/u.exec(css);
    assert.ok(fieldRule, 'shared field rule found');
    assert.match(fieldRule[1], /\.menu-input/, 'menu-input is styled like the other menu fields');
    assert.match(css, /\.menu-input:focus/, 'and gets the same focus ring');
});
