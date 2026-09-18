import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { syncMenuSurfacePolicyUi } from '../src/ui/menu/MenuSurfacePolicyUiSync.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function createSection() {
    const classes = new Set();
    return {
        classList: {
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
    };
}

function sectionTag(innerId) {
    const index = html.indexOf(`id="${innerId}"`);
    const start = html.lastIndexOf('<div class="menu-section', index);
    return html.slice(start, html.indexOf('>', start) + 1);
}

test('the ghost duel stays visible outside arcade because it also plays in single normal and fight', () => {
    // core-targeted-surface T20x2/T20x3 play the self duel outside an arcade run.
    assert.doesNotMatch(sectionTag('arcade-ghost-duel-mode-select'), /\bmenu-arcade-only\b/);
});

test('round wins are marked as a rule the arcade run ignores', () => {
    // The arcade run ends by its sector count; matchWinner stays empty there.
    assert.match(sectionTag('win-count'), /\bmenu-not-arcade\b/);
});

test('the rules block follows the chosen play style', () => {
    for (const [modePath, arcadeHidden, otherHidden] of [
        ['arcade', false, true],
        ['fight', true, false],
        ['normal', true, false],
    ]) {
        const ui = { arcadeOnlySections: [createSection()], nonArcadeSections: [createSection()] };
        syncMenuSurfacePolicyUi({ ui, settings: { localSettings: { modePath } }, sessionType: 'single' });
        assert.equal(ui.arcadeOnlySections[0].classList.contains('hidden'), arcadeHidden, `${modePath}: arcade block`);
        assert.equal(ui.nonArcadeSections[0].classList.contains('hidden'), otherHidden, `${modePath}: round wins`);
    }
});

test('the DOM refs collect the non-arcade sections', () => {
    const source = readFileSync(new URL('../src/ui/dom/GameUiDomRefs.js', import.meta.url), 'utf8');
    assert.match(source, /nonArcadeSections: Array\.from\(doc\.querySelectorAll\('\.menu-not-arcade'\)\)/);
});
