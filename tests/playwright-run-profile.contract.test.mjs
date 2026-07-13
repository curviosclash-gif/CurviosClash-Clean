import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolvePlaywrightCommand } from '../scripts/playwright-run-profile.mjs';

test('playwright profile runner translates legacy -g grep flag', () => {
    const command = resolvePlaywrightCommand([
        'tests/core-targeted-runtime.spec.js',
        '-g',
        'T20al',
        '--timeout=180000',
    ]);

    assert.equal(command.args[1], 'test');
    assert.equal(command.args[2], 'tests/core-targeted-runtime.spec.js');
    assert.equal(command.args[3], '--grep');
    assert.equal(command.args[4], 'T20al');
    assert.equal(command.args[5], '--timeout=180000');
});

test('playwright profile runner translates legacy -g=value grep flag', () => {
    const command = resolvePlaywrightCommand([
        'tests\\core-targeted-surface.spec.js',
        '-g=T20an',
    ]);

    assert.equal(command.args[2], 'tests/core-targeted-surface.spec.js');
    assert.equal(command.args[3], '--grep=T20an');
});
