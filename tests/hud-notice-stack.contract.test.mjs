// Playtest 02.10.2026: the status toast ("Grafik automatisch reduziert", "Kollision mit der
// Wand!") and the sandstorm banner sat on top of the round board and hid the score line. They now
// share one column right below the board, and in split screen a death toast says whose ship it was.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatPlayerScopedMessage } from '../src/shared/contracts/PlayerDisplayLabelContract.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const ruleOf = (selector) => new RegExp(`(?:^|\\n)${selector.replace(/[.#>*+]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';

test('the status toast lives in a notice column below the round board, outside the hidden HUD', () => {
    const stack = html.indexOf('<div id="hud-notice-stack"');
    const toast = html.indexOf('<div id="status-toast"');
    assert.ok(stack > 0 && toast > stack, 'the toast sits inside the notice column');
    assert.ok(html.indexOf('</div>', toast) < html.indexOf('</div>', html.indexOf('</div>', toast) + 1), 'well formed');

    const stackRule = ruleOf('#hud-notice-stack');
    const top = /top:\s*calc\(14px\s*\+\s*(\d+)px/.exec(stackRule);
    assert.ok(top && Number(top[1]) >= 62, `the column starts below the 14px + 62px board (${stackRule.trim()})`);
    assert.match(stackRule, /flex-direction:\s*column/);
    assert.doesNotMatch(ruleOf('#status-toast'), /top:\s*18px/, 'the toast no longer pins itself onto the board');
});

test('the toast fades in place inside the column instead of sliding half its width aside', () => {
    const keyframes = /@keyframes toastFade\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
    assert.ok(keyframes.length > 0);
    assert.doesNotMatch(keyframes, /translateX/);
});

test('the sandstorm banner joins the notice column above the toast', () => {
    const rule = ruleOf('#hud-notice-stack > .map-sandstorm-status');
    assert.match(rule, /position:\s*relative/);
    assert.match(rule, /order:\s*-1/);
    const runtime = readFileSync(new URL('../src/ui/HudRuntimeSystem.js', import.meta.url), 'utf8');
    assert.match(runtime, /new MapSandstormHud\(document\.getElementById\('hud-notice-stack'\)/);
});

test('with several local players a death toast names the player, alone it stays short', () => {
    const player = { index: 1, isBot: false };
    assert.equal(formatPlayerScopedMessage(player, 'Kollision mit der Wand!', 3), 'P2: Kollision mit der Wand!');
    assert.equal(formatPlayerScopedMessage(player, 'Kollision mit der Wand!', 1), 'Kollision mit der Wand!');
    assert.equal(formatPlayerScopedMessage(null, 'Kollision mit der Wand!', 3), 'Kollision mit der Wand!');
});
