import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { syncMenuSurfacePolicyUi } from '../src/ui/menu/MenuSurfacePolicyUiSync.js';

function createSection() {
    const classes = new Set();
    return {
        classList: {
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
    };
}

function syncFor(modePath) {
    const sections = [createSection()];
    syncMenuSurfacePolicyUi({
        ui: { arcadeOnlySections: sections },
        settings: { localSettings: { sessionType: 'single', modePath } },
        sessionType: 'single',
        surfacePolicy: null,
    });
    return sections.map((section) => section.classList.contains('hidden'));
}

test('Arcade run options only show for an Arcade run', () => {
    assert.deepEqual(syncFor('fight'), [true]);
    assert.deepEqual(syncFor('normal'), [true]);
    assert.deepEqual(syncFor('arcade'), [false]);
});

test('only the Arcade run section is marked Arcade-only; the ghost duel serves every single player mode', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /class="menu-section menu-arcade-only">\s*<h3[^>]*>Arcade-Lauf</);
    assert.match(html, /class="menu-section">\s*<h3[^>]*>Arcade Selbstduell</);
});
