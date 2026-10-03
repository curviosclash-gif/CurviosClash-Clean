// Menu messages ("Seed übernommen", "Seed ungültig", ...) never showed: the toast sat inside #hud,
// and #hud is hidden in the menu. The toast has to be a sibling of #hud, not a child.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { showStatusToast } from '../src/ui/menu/StatusToastOps.js';

function openElementIdsAt(html, id) {
    const target = html.indexOf(`<div id="${id}"`);
    assert.ok(target > 0, `#${id} exists in index.html`);
    const stack = [];
    const tag = /<(\/?)div\b([^>]*)>/g;
    let match;
    while ((match = tag.exec(html)) && match.index < target) {
        if (match[1]) stack.pop();
        else stack.push(/\bid="([^"]+)"/.exec(match[2])?.[1] || '');
    }
    return stack;
}

test('the status toast is not nested in the hidden in-match HUD', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const ancestors = openElementIdsAt(html, 'status-toast');
    assert.ok(!ancestors.includes('hud'), `ancestors: ${ancestors.filter(Boolean).join(' > ')}`);
    // It shares the notice column below the round board with the sandstorm banner; that column is
    // the sibling of #hud, so the toast still shows in the menu.
    assert.deepEqual([...openElementIdsAt(html, 'hud'), 'hud-notice-stack'], ancestors, 'the toast stays next to #hud');
});

test('the status toast stacks above the hunt and player HUD it overlaps at the top', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const zIndexOf = (selector) => Number(new RegExp(`${selector}\\s*\\{[^}]*?z-index:\\s*(\\d+)`).exec(css)?.[1]);
    const toast = zIndexOf('#status-toast');
    assert.ok(toast > 101 && toast > zIndexOf('#message-overlay'), `toast z-index ${toast}`);
});

test('warning status toasts use a dedicated tone while existing tones remain supported', () => {
    const classes = new Set(['hidden']);
    const toast = {
        textContent: '',
        offsetWidth: 1,
        classList: {
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            add: (...names) => names.forEach((name) => classes.add(name)),
        },
    };
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (_callback, durationMs) => ({ durationMs });
    try {
        for (const tone of ['info', 'success', 'error', 'warning']) {
            showStatusToast(toast, tone, 1200, tone);
            assert.equal(classes.has(`toast-${tone}`), true, `${tone} is an accepted toast tone`);
        }
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }

    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /#status-toast\.toast-warning\s*\{/u);
});
