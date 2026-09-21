import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';
import { syncMenuPresetState } from '../src/ui/menu/MenuPresetStateSync.js';
import { findFixedMenuPresetSeedById } from '../src/ui/menu/MenuDefaultsEditorConfig.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the preset chips take their names from the preset catalog, not from the page', () => {
    const chips = Array.from(html.matchAll(/<button[^>]*data-preset-id="([^"]+)"[^>]*>([^<]*)<\/button>/gu));
    assert.ok(chips.length >= 5);
    chips.forEach(([, , text]) => assert.equal(text.trim(), '', 'no second copy of a preset name in the page'));

    const ownerDocument = { createElement: () => ({ className: '', textContent: '' }) };
    const buttons = chips.map(([, presetId]) => ({
        dataset: { presetId }, ownerDocument, children: [], disabled: false,
        classList: { toggle() {} }, setAttribute() {},
        replaceChildren(...nodes) { this.children = nodes; },
    }));
    syncMenuPresetState({ ui: { quickstartPresetButtons: buttons }, settings: { matchSettings: {} } });
    // The chip's first line is its name; the second line says what the preset changes.
    buttons.forEach((button) => assert.equal(button.children[0].textContent, findFixedMenuPresetSeedById(button.dataset.presetId).name));
});

test('the options drawer presets heading comes from the text catalog', () => {
    const heading = /<section id="level4-section-presets"[\s\S]*?<h2[^>]*>([\s\S]*?)<button/u.exec(html)?.[1] || '';
    const textId = /data-menu-text-id="([^"]+)"/u.exec(heading)?.[1];
    assert.ok(textId, 'heading text has a text id');
    assert.ok(Object.hasOwn(MENU_TEXT_CATALOG, textId), textId);
});

test('the start-page reset button and feedback name only the fields they reset', () => {
    assert.equal(MENU_TEXT_CATALOG['menu.level3.reset.label'], 'Karte & Flugzeug zurücksetzen');
    assert.match(html, /id="btn-level3-reset"[^>]*[\s\S]*?>Karte &amp; Flugzeug zurücksetzen<\/button>/u);
    const runtime = readFileSync(new URL('../src/core/runtime/MenuRuntimeSessionService.js', import.meta.url), 'utf8');
    assert.match(runtime, /_showStatusToast\('Karte und Flugzeug zurückgesetzt'/u);
});

test('the menu context and breadcrumb labels come from the text catalog', () => {
    const source = readFileSync(new URL('../src/ui/UINavigationLifecycleController.js', import.meta.url), 'utf8');
    for (const literal of ["'Geteilter Bildschirm'", "'Erweiterte Optionen'", "'Grafik & Kamera'", "'Match vorbereiten'"]) {
        const bare = new RegExp(`(?<!resolveMenuCatalogText\\('[^']+',\\s*)${literal}`, 'u');
        assert.doesNotMatch(source, bare, `${literal} still hard-wired`);
    }
    const ids = Array.from(source.matchAll(/resolveMenuCatalogText\('([^']+)'/gu), (match) => match[1]);
    assert.ok(ids.length >= 10);
    ids.forEach((textId) => assert.ok(Object.hasOwn(MENU_TEXT_CATALOG, textId), textId));
});
